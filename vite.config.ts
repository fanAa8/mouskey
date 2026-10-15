import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, unlinkSync, watch as watchFileSystem } from 'node:fs'
import { basename, dirname, join, normalize, resolve } from 'node:path'
import { createRequire } from 'node:module'
import https from 'node:https'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { GlobalKeyboardListener } from 'node-global-key-listener'

// Reuse the production ESDF migration implementation in dev mode
const nodeRequire = createRequire(import.meta.url)
const apiHandlers = nodeRequire('./electron/api-handlers.cjs') as {
  migrateEsdfConfig: (req: Record<string, unknown>) => { success: boolean; message: string; [k: string]: unknown }
  previewEsdfConfig: (req: Record<string, unknown>) => { success: boolean; message: string; [k: string]: unknown }
  listEsdfCandidates: () => { success: boolean; message: string; [k: string]: unknown }
  batchMigrateEsdf: (req: Record<string, unknown>) => { success: boolean; message: string; [k: string]: unknown }
}

// ─── Types ──────────────────────────────────────────────────────────────────

type IniEntry = { section: string; key: string; value: string }
type LolConfigPair = { source: string; gameCfgPath: string; inputPath: string; persistedSettingsPath: string }
type LolWatchEvent = { at: string; change: string; path: string }

type DetectResult = {
  gameId: string
  found: boolean
  configPath: string | null
  message: string
  candidates?: string[]
}

type LudusaviGameEntry = {
  name: string
  installDir: string | null
  configFiles: string[]
  configRegistry: string[]
}

type LudusaviData = {
  version: string
  source: string
  generatedAt: string
  totalGames: number
  games: Record<string, LudusaviGameEntry>
}

/** Load Ludusavi game config lookup table (generated from ludusavi-manifest) */
const loadLudusaviData = (): LudusaviData => {
  try {
    const dataPath = join(import.meta.dirname, 'src', 'data', 'ludusavi-games.json')
    if (!existsSync(dataPath)) {
      return { version: '0', source: 'none', generatedAt: '', totalGames: 0, games: {} }
    }
    const content = readFileSync(dataPath, 'utf8')
    return JSON.parse(content) as LudusaviData
  } catch {
    return { version: '0', source: 'none', generatedAt: '', totalGames: 0, games: {} }
  }
}

const ludusaviData = loadLudusaviData()

// ─── Global input monitoring (keyboard + mouse) ────────────────────────────

type SseClient = { response: any }
const sseClients: Set<SseClient> = new Set()

const broadcastInputEvent = (event: any) => {
  const data = `data: ${JSON.stringify(event)}\n\n`
  for (const client of sseClients) {
    try { client.response.write(data) } catch { /* client disconnected */ }
  }
}

let keyboardListenerStarted = false
const startKeyboardListener = () => {
  if (keyboardListenerStarted) return
  keyboardListenerStarted = true
  try {
    const listener = new GlobalKeyboardListener()
    listener.addListener((e: any, down: any) => {
      const keyName = e.name || e.vKey || String(e.vKey)
      broadcastInputEvent({
        type: 'keyboard',
        key: keyName,
        state: e.state === 'DOWN' ? 'down' : 'up',
        vKey: e.vKey,
        scanCode: e.scanCode,
        timestamp: Date.now(),
      })
    })
    console.log('[Keyforge] Global keyboard listener started')
  } catch (err) {
    console.error('[Keyforge] Failed to start keyboard listener:', err)
  }
}

// Mouse button monitoring via Windows API GetAsyncKeyState polling
let mouseMonitorStarted = false
let currentMouseState = { left: false, right: false, middle: false, x1: false, x2: false }

const startMouseMonitor = () => {
  if (mouseMonitorStarted) return
  mouseMonitorStarted = true
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const GetAsyncKeyState = user32.func('short GetAsyncKeyState(int vKey)')

    const MOUSE_VKEYS: Record<string, number> = {
      left: 1,    // VK_LBUTTON
      right: 2,   // VK_RBUTTON
      middle: 4,  // VK_MBUTTON
      x1: 5,      // VK_XBUTTON1
      x2: 6,      // VK_XBUTTON2
    }

    setInterval(() => {
      let changed = false
      const newState: Record<string, boolean> = {}
      for (const [button, vkey] of Object.entries(MOUSE_VKEYS)) {
        const pressed = GetAsyncKeyState(vkey) !== 0
        newState[button] = pressed
        if (pressed !== currentMouseState[button as keyof typeof currentMouseState]) {
          changed = true
          broadcastInputEvent({
            type: 'mouse',
            button,
            state: pressed ? 'down' : 'up',
            timestamp: Date.now(),
          })
        }
      }
      if (changed) {
        currentMouseState = { ...currentMouseState, ...newState }
      }
    }, 50)
    console.log('[Keyforge] Mouse monitor started (polling at 50ms)')
  } catch (err) {
    console.error('[Keyforge] Failed to start mouse monitor:', err)
  }
}

// ─── Custom (auto-generated) adapters management ───────────────────────────

type CustomAdapter = {
  id: string
  name: string
  genre: string
  color: string
  adapterLabel: string
  configPathLabel: string
  configFormat: string
  configFileName: string
  configRelativePath: string
  detectionType: string
  steamAppId?: string
  installPaths: string[]
  modes: { id: string; name: string; section: string }[]
  defaultMode: string
  supportedActions: string[]
  nativeNames: Record<string, string>
  defaults: Record<string, string>
  canWrite: boolean
  applyMethod: string
  cloudSync: boolean
  source: string
  generatedAt: string
}

const getCustomAdaptersDir = (): string => {
  const docs = getWindowsDocumentsPath()
  return docs ? join(docs, 'Keyforge', 'adapters') : join(process.env.USERPROFILE ?? 'C:\\Users\\Public', 'Documents', 'Keyforge', 'adapters')
}

const ensureCustomAdaptersDir = (): string => {
  const dir = getCustomAdaptersDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const listCustomAdapters = (): CustomAdapter[] => {
  const dir = getCustomAdaptersDir()
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith('.json'))
      .map((f) => {
        try { return JSON.parse(readFileSync(join(dir, f.name), 'utf8')) as CustomAdapter }
        catch { return null }
      })
      .filter((a): a is CustomAdapter => a !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  } catch {
    return []
  }
}

const saveCustomAdapter = (adapter: CustomAdapter): { success: boolean; message: string; filePath?: string } => {
  try {
    const dir = ensureCustomAdaptersDir()
    const filePath = join(dir, `${adapter.id}.json`)
    writeFileSync(filePath, JSON.stringify(adapter, null, 2), 'utf8')
    return { success: true, message: `适配器已保存：${adapter.name}`, filePath }
  } catch (err) {
    return { success: false, message: `保存适配器失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

const deleteCustomAdapter = (id: string): { success: boolean; message: string } => {
  try {
    const dir = getCustomAdaptersDir()
    const filePath = join(dir, `${id}.json`)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
      return { success: true, message: `适配器已删除：${id}` }
    }
    return { success: false, message: `适配器不存在：${id}` }
  } catch (err) {
    return { success: false, message: `删除适配器失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

/** Detect config file format from extension */
const detectConfigFormat = (filePath: string): string => {
  const ext = filePath.toLowerCase().split('.').pop() ?? ''
  switch (ext) {
    case 'ini':
    case 'cfg':
      return 'ini'
    case 'json':
      return 'json'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'txt':
      return 'ini'
    default:
      return 'ini'
  }
}

/** Generate a color from a string (deterministic) */
const generateColor = (str: string): string => {
  const colors = ['#6B8F52', '#527A8F', '#8F526B', '#8F7A52', '#528F7A', '#7A528F', '#8F5252', '#526B8F']
  let hash = 0
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

/** Generic action defaults for generated adapters */
const GENERIC_ACTIONS = [
  { id: 'forward', label: '前进', native: 'forward', default: 'W' },
  { id: 'left', label: '左移', native: 'left', default: 'A' },
  { id: 'back', label: '后退', native: 'back', default: 'S' },
  { id: 'right', label: '右移', native: 'right', default: 'D' },
  { id: 'primary', label: '主操作', native: 'primary', default: 'Mouse 1' },
  { id: 'secondary', label: '副操作', native: 'secondary', default: 'Mouse 2' },
  { id: 'ability1', label: '技能1', native: 'ability1', default: 'Q' },
  { id: 'ability2', label: '技能2', native: 'ability2', default: 'E' },
  { id: 'ability3', label: '技能3', native: 'ability3', default: 'R' },
  { id: 'ultimate', label: '终极技能', native: 'ultimate', default: 'F' },
  { id: 'interact', label: '交互', native: 'interact', default: 'Space' },
  { id: 'inventory1', label: '物品栏1', native: 'inventory1', default: '1' },
  { id: 'map', label: '地图', native: 'map', default: 'Tab' },
]

/** Generate an adapter from Ludusavi data for a Steam AppID */
const generateAdapterFromLudusavi = (steamAppId: string): { success: boolean; message: string; adapter?: CustomAdapter } => {
  const entry = ludusaviData.games[steamAppId]
  if (!entry) {
    return { success: false, message: `Ludusavi 查找表中未找到 AppID ${steamAppId}` }
  }

  if (!entry.configFiles || entry.configFiles.length === 0) {
    return { success: false, message: `${entry.name} 没有配置文件路径数据` }
  }

  // Use the first config file
  const firstConfig = entry.configFiles[0]
  const resolvedPath = expandEnvironmentReferences(firstConfig)
  const configDir = dirname(resolvedPath)
  const configFileName = basename(resolvedPath)
  const configFormat = detectConfigFormat(configFileName)
  const canWrite = configFormat === 'ini' || configFormat === 'json'

  const nativeNames: Record<string, string> = {}
  const defaults: Record<string, string> = {}
  const supportedActions: string[] = []
  for (const action of GENERIC_ACTIONS) {
    nativeNames[action.id] = action.native
    defaults[action.id] = action.default
    supportedActions.push(action.id)
  }

  // Try to read actual config and extract key names if file exists
  if (existsSync(resolvedPath)) {
    try {
      const content = readFileSync(resolvedPath, 'utf8')
      // For INI: extract keys from sections
      if (configFormat === 'ini') {
        const lines = content.split(/\r?\n/)
        const foundKeys: string[] = []
        for (const line of lines) {
          const match = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/)
          if (match) foundKeys.push(match[1])
        }
        // Map common patterns
        const keyMap: Record<string, string> = {
          move_up: 'forward', move_forward: 'forward', forward: 'forward', up: 'forward',
          move_left: 'left', left: 'left', strafe_left: 'left',
          move_down: 'back', move_back: 'back', back: 'back', down: 'back',
          move_right: 'right', right: 'right', strafe_right: 'right',
          attack: 'primary', primary_action: 'primary', primaryfire: 'primary', fire: 'primary',
          attack2: 'secondary', secondary_action: 'secondary', secondaryfire: 'secondary',
          use: 'interact', interact: 'interact', action: 'interact',
          inventory: 'ability2', inv: 'ability2',
          map: 'map', showmap: 'map',
        }
        for (const key of foundKeys.slice(0, 50)) {
          const lower = key.toLowerCase()
          if (keyMap[lower]) {
            nativeNames[keyMap[lower]] = key
          }
        }
      }
    } catch { /* ignore read errors */ }
  }

  const adapter: CustomAdapter = {
    id: `ludusavi-${steamAppId}`,
    name: entry.name,
    genre: '自动生成',
    color: generateColor(entry.name),
    adapterLabel: `Ludusavi 自动生成 · ${configFormat.toUpperCase()}`,
    configPathLabel: firstConfig,
    configFormat,
    configFileName,
    configRelativePath: configFileName,
    detectionType: 'path-scan',
    steamAppId,
    installPaths: [configDir],
    modes: [{ id: 'default', name: '默认', section: 'controls' }],
    defaultMode: 'default',
    supportedActions,
    nativeNames,
    defaults,
    canWrite,
    applyMethod: 'restart',
    cloudSync: false,
    source: 'ludusavi-auto',
    generatedAt: new Date().toISOString(),
  }

  return { success: true, message: `已为 ${entry.name} 生成适配器`, adapter }
}

type WriteRequest = {
  gameId: string
  profileName: string
  modeId?: string
  configText: string
  fileName: string
}

type WriteResponse = {
  success: boolean
  message: string
  gameId: string
  writtenPath?: string
  backupPath?: string
  linesWritten?: number
}

// ─── LoL watch state (preserved) ────────────────────────────────────────────

const lolWatchState: {
  startedAt: string | null
  roots: string[]
  events: LolWatchEvent[]
  watchers: ReturnType<typeof watchFileSystem>[]
} = { startedAt: null, roots: [], events: [], watchers: [] }

// ─── Utilities ────────────────────────────────────────────────────────────────

const safelyReadJson = (filePath: string) => {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

const expandEnvironmentReferences = (value: string) =>
  value.replace(/%([^%]+)%/g, (_, name: string) => process.env[name] ?? `%${name}%`)

const getWindowsDocumentsPath = () => {
  try {
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders', '/v', 'Personal'],
      { encoding: 'utf8', windowsHide: true },
    )
    const match = output.split(/\r?\n/).map((line) => line.match(/^\s*Personal\s+REG_\w+\s+(.+?)\s*$/i)).find(Boolean)
    if (match?.[1]) return expandEnvironmentReferences(match[1])
  } catch {
    // Use the conventional folder only when Windows cannot provide its registered location.
  }
  return process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Documents') : null
}

const parseIni = (content: string): IniEntry[] => {
  let section = 'General'
  const entries: IniEntry[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';') || line.startsWith('#')) continue
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) { section = sectionMatch[1]; continue }
    const separator = line.indexOf('=')
    if (separator < 1) continue
    entries.push({ section, key: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() })
  }
  return entries
}

const readIni = (filePath: string) => parseIni(readFileSync(filePath, 'utf8'))

const findSetting = (entries: IniEntry[], section: string, key: string) =>
  entries.find((entry) => entry.section.toLowerCase() === section.toLowerCase() && entry.key.toLowerCase() === key.toLowerCase())?.value ?? null

const timestamp = () => {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** Create a timestamped backup of a file. Returns backup path or null on failure. */
const createBackup = (originalPath: string, gameId: string): string | null => {
  if (!existsSync(originalPath)) return null
  const backupDir = join(dirname(originalPath), 'keyforge_backups')
  try {
    if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true })
    const backupPath = join(backupDir, `${gameId}_${basename(originalPath)}.${timestamp()}.bak`)
    copyFileSync(originalPath, backupPath)
    return backupPath
  } catch {
    return null
  }
}

// ─── Game detection ───────────────────────────────────────────────────────────

/** Detect Steam installation path from registry */
const getSteamPath = (): string | null => {
  try {
    const output = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
      { encoding: 'utf8', windowsHide: true },
    )
    // Match: SteamPath    REG_SZ    c:/ruanjian/game/steam
    const match = output.match(/SteamPath\s+REG_\w+\s+(.+?)(?:\r?\n|$)/i)
    if (match?.[1]) {
      let path = match[1].trim()
      // Convert forward slashes to backslashes (Steam registry uses forward slashes)
      path = path.replace(/\//g, '\\')
      // Expand environment variables if any
      path = expandEnvironmentReferences(path)
      if (existsSync(path)) return path
    }
  } catch { /* Steam not found via registry */ }
  // Fallback: common install paths
  const candidates = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'D:\\Program Files (x86)\\Steam',
    'E:\\Steam',
  ]
  return candidates.find((p) => existsSync(p)) ?? null
}

/** Find CS2 config directory: Steam/userdata/<steamid>/730/local/cfg */
const detectCs2 = (): DetectResult => {
  const steamPath = getSteamPath()
  if (!steamPath) {
    return { gameId: 'cs2', found: false, configPath: null, message: '未检测到 Steam 安装。' }
  }
  const userdataDir = join(steamPath, 'userdata')
  if (!existsSync(userdataDir)) {
    return { gameId: 'cs2', found: false, configPath: null, message: `Steam 已安装（${steamPath}），但未找到 userdata 目录。` }
  }
  // Find steamid directories and look for 730
  const candidates: string[] = []
  try {
    const entries = readdirSync(userdataDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const cfgDir = join(userdataDir, entry.name, '730', 'local', 'cfg')
      if (existsSync(cfgDir)) candidates.push(cfgDir)
    }
  } catch { /* ignore */ }

  if (candidates.length > 0) {
    return {
      gameId: 'cs2',
      found: true,
      configPath: candidates[0],
      message: `已检测到 CS2 配置目录（${candidates.length} 个 Steam 账号）。`,
      candidates,
    }
  }
  return {
    gameId: 'cs2',
    found: false,
    configPath: null,
    message: 'Steam 已安装，但未找到 CS2（730）配置目录。请先启动一次 CS2。',
  }
}

/** Detect CF (穿越火线) config directory */
const detectCf = (): DetectResult => {
  const candidates = [
    'C:\\Program Files (x86)\\CF\\UserData',
    'C:\\Program Files\\CF\\UserData',
    'D:\\CF\\UserData',
    'D:\\Program Files (x86)\\CF\\UserData',
    'D:\\WeGameApps\\CF\\UserData',
    'C:\\Users\\Administrator\\Documents\\CF',
  ]
  const found = candidates.filter((p) => existsSync(p))
  // Look for KeySettings.ini
  for (const dir of found) {
    const iniPath = join(dir, 'KeySettings.ini')
    if (existsSync(iniPath)) {
      return { gameId: 'cf', found: true, configPath: dir, message: `已检测到 CF 配置目录。`, candidates: found }
    }
  }
  if (found.length > 0) {
    return { gameId: 'cf', found: true, configPath: found[0], message: '已检测到 CF 目录，但未找到 KeySettings.ini（将在写入时创建）。', candidates: found }
  }
  return { gameId: 'cf', found: false, configPath: null, message: '未检测到 CF 安装目录。', candidates }
}

/** Detect 饥荒 (Don't Starve) config directory */
const detectDontStarve = (): DetectResult => {
  const documentsPath = getWindowsDocumentsPath()
  const candidates: string[] = []
  if (documentsPath) {
    candidates.push(join(documentsPath, 'Klei', 'DoNotStarve'))
    candidates.push(join(documentsPath, 'Klei', 'DoNotStarveTogether'))
  }
  const found = candidates.filter((p) => existsSync(p))
  for (const dir of found) {
    const iniPath = join(dir, 'settings.ini')
    if (existsSync(iniPath)) {
      return { gameId: 'dont-starve', found: true, configPath: dir, message: '已检测到饥荒配置目录。', candidates: found }
    }
  }
  if (found.length > 0) {
    return { gameId: 'dont-starve', found: true, configPath: found[0], message: '已检测到饥荒目录，但未找到 settings.ini（将在写入时创建）。', candidates: found }
  }
  return { gameId: 'dont-starve', found: false, configPath: null, message: '未检测到饥荒配置目录。', candidates }
}

const detectGame = (gameId: string): DetectResult => {
  switch (gameId) {
    case 'cs2': return detectCs2()
    case 'cf': return detectCf()
    case 'dont-starve': return detectDontStarve()
    default:
      return { gameId, found: false, configPath: null, message: `不支持的游戏：${gameId}` }
  }
}

// ─── Data-driven game detection (uses JSON adapters) ────────────────────────

type GameAdapterJson = {
  id: string
  name: string
  genre: string
  color: string
  installPaths?: string[]
  configRelativePath?: string
  detectionType?: string
  steamAppId?: string
  documentsSubPath?: string
  configFileName?: string
}

/** Load all game adapter JSON files from src/games/ */
const loadGameAdapters = (): GameAdapterJson[] => {
  try {
    const gamesDir = join(import.meta.dirname, 'src', 'games')
    if (!existsSync(gamesDir)) return []
    const files = readdirSync(gamesDir, { withFileTypes: true })
      .filter((f) => f.isFile() && f.name.endsWith('.json'))
      .map((f) => join(gamesDir, f.name))
    return files
      .map((path) => {
        try { return JSON.parse(readFileSync(path, 'utf8')) as GameAdapterJson }
        catch { return null }
      })
      .filter((g): g is GameAdapterJson => g !== null)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
  } catch {
    return []
  }
}

/** Generic path-scan detection: check installPaths + configRelativePath */
const detectByPathScan = (game: GameAdapterJson): DetectResult => {
  const candidates: string[] = []
  const paths = game.installPaths ?? []
  for (const rawPath of paths) {
    const installPath = expandEnvironmentReferences(rawPath)
    if (!existsSync(installPath)) continue
    // Check if config file exists at relative path
    if (game.configRelativePath) {
      const configPath = join(installPath, game.configRelativePath)
      if (existsSync(configPath)) {
        candidates.push(dirname(configPath))
      } else if (existsSync(dirname(configPath))) {
        // Config directory exists but file doesn't (will be created on write)
        candidates.push(dirname(configPath))
      }
    } else {
      candidates.push(installPath)
    }
  }
  if (candidates.length > 0) {
    return {
      gameId: game.id,
      found: true,
      configPath: candidates[0],
      message: `已检测到 ${game.name} 安装。`,
      candidates,
    }
  }
  return { gameId: game.id, found: false, configPath: null, message: `未检测到 ${game.name} 安装。`, candidates: paths }
}

/** Documents-based detection: check Documents + documentsSubPath */
const detectByDocuments = (game: GameAdapterJson): DetectResult => {
  const documentsPath = getWindowsDocumentsPath()
  if (!documentsPath || !game.documentsSubPath) {
    return { gameId: game.id, found: false, configPath: null, message: `无法定位 Documents 目录。` }
  }
  const gameDir = join(documentsPath, game.documentsSubPath)
  if (!existsSync(gameDir)) {
    return { gameId: game.id, found: false, configPath: null, message: `未找到 ${game.name} 配置目录（${gameDir}）。` }
  }
  const configFile = game.configRelativePath ? join(gameDir, game.configRelativePath) : join(gameDir, game.configFileName ?? 'settings.ini')
  if (existsSync(configFile)) {
    return { gameId: game.id, found: true, configPath: gameDir, message: `已检测到 ${game.name} 配置。` }
  }
  return { gameId: game.id, found: true, configPath: gameDir, message: `已检测到 ${game.name} 目录，但未找到配置文件（将在写入时创建）。` }
}

// ─── Full Steam library scanner (detect ALL installed Steam games) ────────

type SteamGameInfo = {
  appId: string
  name: string
  installDir: string
  libraryPath: string
}

/** Find all Steam library folders by checking registry + common paths + libraryfolders.vdf */
const findSteamLibraries = (): string[] => {
  const libraries: string[] = []
  const seen = new Set<string>()

  // Common Steam install paths
  const steamRoots = [
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'D:\\Program Files\\Steam',
    'D:\\Games\\Steam',
    'E:\\Steam',
    'E:\\Program Files\\Steam',
    'C:\\ruanjian\\game\\steam',
  ]

  const addLibrary = (libPath: string) => {
    const normalized = libPath.replace(/[\\/]+$/, '')
    if (normalized && !seen.has(normalized.toLowerCase()) && existsSync(normalized)) {
      seen.add(normalized.toLowerCase())
      libraries.push(normalized)
    }
  }

  for (const root of steamRoots) {
    if (!existsSync(root)) continue
    // Default library is steamapps under the root
    addLibrary(join(root, 'steamapps'))
    // Read libraryfolders.vdf for additional libraries
    const vdfPath = join(root, 'steamapps', 'libraryfolders.vdf')
    if (existsSync(vdfPath)) {
      try {
        const content = readFileSync(vdfPath, 'utf8')
        // Parse "path"		"D:\\SteamLibrary" entries
        const pathMatches = content.match(/"path"\s+"([^"]+)"/g)
        if (pathMatches) {
          for (const match of pathMatches) {
            const libPath = match.replace(/"path"\s+"/, '').replace(/"$/, '')
            addLibrary(join(libPath, 'steamapps'))
          }
        }
      } catch { /* ignore parse errors */ }
    }
  }

  // Also scan common drive roots for steamapps directories (shallow scan)
  const drives = ['C:', 'D:', 'E:', 'F:']
  for (const drive of drives) {
    const candidates = [
      join(drive, 'SteamLibrary', 'steamapps'),
      join(drive, 'Games', 'steamapps'),
      join(drive, 'Game', 'steamapps'),
    ]
    for (const c of candidates) addLibrary(c)
  }

  return libraries
}

/** Parse a single appmanifest_*.acf file */
const parseSteamManifest = (manifestPath: string, libraryPath: string): SteamGameInfo | null => {
  try {
    const content = readFileSync(manifestPath, 'utf8')
    const appIdMatch = content.match(/"appid"\s+"(\d+)"/)
    const nameMatch = content.match(/"name"\s+"([^"]+)"/)
    const dirMatch = content.match(/"installdir"\s+"([^"]+)"/)
    if (!appIdMatch || !nameMatch) return null
    return {
      appId: appIdMatch[1],
      name: nameMatch[1],
      installDir: dirMatch ? dirMatch[1] : '',
      libraryPath,
    }
  } catch {
    return null
  }
}

/** Scan all Steam libraries and return every installed game */
const scanAllSteamGames = (): SteamGameInfo[] => {
  const libraries = findSteamLibraries()
  const allGames: SteamGameInfo[] = []
  const seenAppIds = new Set<string>()

  for (const libraryPath of libraries) {
    try {
      const files = readdirSync(libraryPath, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.startsWith('appmanifest_') && f.name.endsWith('.acf'))
      for (const file of files) {
        const game = parseSteamManifest(join(libraryPath, file.name), libraryPath)
        if (game && !seenAppIds.has(game.appId)) {
          seenAppIds.add(game.appId)
          allGames.push(game)
        }
      }
    } catch { /* ignore unreadable libraries */ }
  }

  return allGames.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

/** Detect all installed games: full Steam scan + adapter-specific detection */
const detectAllGames = (): {
  games: { gameId: string; name: string; genre: string; color: string; found: boolean; configPath: string | null; message: string; hasAdapter: boolean; steamAppId?: string; source: string }[]
  total: number
  detected: number
  steamGames: SteamGameInfo[]
} => {
  const adapters = loadGameAdapters()
  const steamGames = scanAllSteamGames()
  const steamAppIdToGame = new Map(steamGames.map((g) => [g.appId, g]))
  const results: { gameId: string; name: string; genre: string; color: string; found: boolean; configPath: string | null; message: string; hasAdapter: boolean; hasLudusaviData: boolean; ludusavi: LudusaviGameEntry | null; steamAppId?: string; source: string }[] = []
  let detected = 0

  // 1. Detect games that have adapters
  const detectedAdapterIds = new Set<string>()
  for (const game of adapters) {
    let result: DetectResult
    let source: string

    // First try Steam match by appId
    if (game.steamAppId && steamAppIdToGame.has(game.steamAppId)) {
      const steamGame = steamAppIdToGame.get(game.steamAppId)!
      const installPath = join(dirname(steamGame.libraryPath), 'common', steamGame.installDir)
      result = {
        gameId: game.id,
        found: true,
        configPath: existsSync(installPath) ? installPath : steamGame.libraryPath,
        message: `已检测到 ${game.name}（Steam，${steamGame.name}）。`,
      }
      source = 'steam'
    } else {
      // Fall back to adapter-specific detection
      switch (game.detectionType) {
        case 'lol-special': {
          const lolCandidates = buildLolCandidates()
          const lolLocated = lolCandidates.find((c) => existsSync(c.persistedSettingsPath) || existsSync(c.inputPath))
          result = lolLocated
            ? { gameId: game.id, found: true, configPath: dirname(lolLocated.persistedSettingsPath || lolLocated.inputPath), message: `已检测到 ${game.name} 配置（${lolLocated.source}）。` }
            : { gameId: game.id, found: false, configPath: null, message: `未检测到 ${game.name} 配置。` }
          source = 'lol-special'
          break
        }
        case 'steam':
          result = detectCs2()
          source = 'steam-legacy'
          break
        case 'documents':
          result = detectByDocuments(game)
          source = 'documents'
          break
        case 'path-scan':
        default:
          result = detectByPathScan(game)
          source = 'path-scan'
          break
      }
    }

    if (result.found) {
      detected++
      detectedAdapterIds.add(game.id)
    }
    results.push({
      ...result,
      name: game.name,
      genre: game.genre,
      color: game.color,
      hasAdapter: true,
      hasLudusaviData: false,
      ludusavi: null,
      steamAppId: game.steamAppId,
      source,
    })
  }

  // 2. Add Steam games that don't have adapters (show as "未适配" or "Ludusavi数据")
  const adapterAppIds = new Set(adapters.map((g) => g.steamAppId).filter(Boolean))
  for (const steamGame of steamGames) {
    if (adapterAppIds.has(steamGame.appId)) continue
    // Skip common redistributables and non-game apps
    if (steamGame.appId === '228980') continue // Steamworks Common Redistributables
    if (steamGame.name.toLowerCase().includes('redistributable')) continue
    if (steamGame.name.toLowerCase().includes('sdk')) continue

    // Check if Ludusavi has config data for this game
    const ludusaviEntry = ludusaviData.games[steamGame.appId]
    const hasLudusaviData = Boolean(ludusaviEntry && ludusaviEntry.configFiles.length > 0)

    // Resolve config path from Ludusavi data if available
    let configPath = steamGame.libraryPath
    let message = `已安装（Steam），暂无键位适配器。`
    let genre = '未适配'
    let color = '#8a9a92'

    if (hasLudusaviData && ludusaviEntry) {
      // Try to resolve the first config file path to an actual directory
      const firstConfig = ludusaviEntry.configFiles[0]
      const resolvedPath = expandEnvironmentReferences(firstConfig)
      const configDir = dirname(resolvedPath)
      if (existsSync(configDir)) {
        configPath = configDir
      }
      message = `已安装（Steam），Ludusavi 配置数据可用（${ludusaviEntry.configFiles.length}个配置路径）。`
      genre = 'Ludusavi数据'
      color = '#6a8ab0'
    }

    results.push({
      gameId: `steam-${steamGame.appId}`,
      name: steamGame.name,
      genre,
      color,
      found: true,
      configPath,
      message,
      hasAdapter: false,
      hasLudusaviData,
      ludusavi: ludusaviEntry ?? null,
      steamAppId: steamGame.appId,
      source: 'steam',
    })
    detected++
  }

  // Sort: adapted games first (by name), then unadapted Steam games
  results.sort((a, b) => {
    if (a.hasAdapter !== b.hasAdapter) return a.hasAdapter ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })

  return { games: results, total: results.length, detected, steamGames }
}

// ─── LoL PersistedSettings.json writer ────────────────────────────────────────

/** Convert normalizeKey format (MOUSE1, SPACE, Q) to LoL bracket format ([Button 1], [Space], [q]) */
const toLolKey = (normalized: string): string => {
  const k = normalized.trim()
  if (!k || k === '<Unbound>') return '[<Unbound>]'
  const mouseMap: Record<string, string> = {
    MOUSE1: '[Button 1]', MOUSE2: '[Button 2]', MOUSE3: '[Button 3]',
    MOUSE4: '[Button 4]', MOUSE5: '[Button 5]',
  }
  if (mouseMap[k]) return mouseMap[k]
  const specialMap: Record<string, string> = {
    SPACE: '[Space]', TAB: '[Tab]', ESCAPE: '[Esc]', ENTER: '[Enter]',
    SHIFT: '[Shift]', RSHIFT: '[R Shift]', LSHIFT: '[L Shift]',
    CTRL: '[Ctrl]', RCTRL: '[R Ctrl]', LCTRL: '[L Ctrl]',
    ALT: '[Alt]', RALT: '[R Alt]', LALT: '[L Alt]',
    BACKSPACE: '[Backspace]', DELETE: '[Delete]', INSERT: '[Insert]',
    HOME: '[Home]', END: '[End]', PAGEUP: '[Page Up]', PAGEDOWN: '[Page Down]',
    UP: '[Up Arrow]', DOWN: '[Down Arrow]', LEFT: '[Left Arrow]', RIGHT: '[Right Arrow]',
  }
  if (specialMap[k]) return specialMap[k]
  if (/^F\d+$/.test(k)) return `[${k}]`
  if (k.length === 1) return `[${k.toLowerCase()}]`
  return `[${k}]`
}

/** Parse a section from the generated LoL Input.ini format text. */
const parseLolSection = (configText: string, sectionName = 'GameEvents'): Record<string, string> => {
  const result: Record<string, string> = {}
  let inTargetSection = false
  for (const rawLine of configText.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith(';')) continue
    if (line.startsWith('[')) {
      inTargetSection = line.toLowerCase() === `[${sectionName}]`.toLowerCase()
      continue
    }
    if (!inTargetSection) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const event = line.slice(0, eq).trim()
    const value = line.slice(eq + 1).trim()
    if (event && value) result[event] = value
  }
  return result
}

/** WASD mode supported event names (without evt prefix) */
const wasdSupportedEvents = new Set([
  'CastSpell1', 'CastSpell2', 'CastSpell3', 'CastSpell4',
  'CastAvatarSpell1', 'CastAvatarSpell2', 'CastRoleBound',
  'UseItem1', 'UseItem2', 'UseItem3', 'UseItem4', 'UseItem5', 'UseItem6',
  'UseVisionItem', 'PlayerPingCursor', 'CameraSnap', 'CancelCurrentActions',
])

/** Convert traditional evtXxx event name to WASD mode event name */
const toWasdEvent = (traditionalEvent: string): string | null => {
  if (!traditionalEvent.startsWith('evt')) return null
  // evtCastSpell1 -> CastSpell1
  const withoutEvt = traditionalEvent.slice(3)
  const wasdName = withoutEvt.charAt(0).toUpperCase() + withoutEvt.slice(1)
  return wasdSupportedEvents.has(wasdName) ? wasdName : null
}

/**
 * Update key-value pairs in a specific section of an INI file.
 * Preserves existing formatting and other sections.
 */
const updateIniSection = (content: string, sectionName: string, updates: Record<string, string>): { content: string; updated: number; added: number } => {
  const lines = content.split(/\r?\n/)
  let inTargetSection = false
  let updated = 0
  let added = 0
  const remainingUpdates = new Map(Object.entries(updates))

  const newLines: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    // Section header
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      // If we were in the target section and leaving it, add remaining new keys
      if (inTargetSection && remainingUpdates.size > 0) {
        for (const [key, value] of remainingUpdates) {
          newLines.push(`${key}=${value}`)
          added++
        }
        remainingUpdates.clear()
      }
      inTargetSection = sectionMatch[1] === sectionName
      newLines.push(line)
      continue
    }
    if (inTargetSection && trimmed && !trimmed.startsWith(';') && !trimmed.startsWith('#')) {
      const eq = trimmed.indexOf('=')
      if (eq > 0) {
        const key = trimmed.slice(0, eq).trim()
        if (remainingUpdates.has(key)) {
          const newValue = remainingUpdates.get(key)!
          newLines.push(`${key}=${newValue}`)
          remainingUpdates.delete(key)
          updated++
          continue
        }
      }
    }
    newLines.push(line)
  }
  // If file ends while still in target section, add remaining
  if (inTargetSection && remainingUpdates.size > 0) {
    for (const [key, value] of remainingUpdates) {
      newLines.push(`${key}=${value}`)
      added++
    }
  }
  return { content: newLines.join('\n'), updated, added }
}

/**
 * Find LCU API port and auth token from running LeagueClientUx process.
 * Returns null if LoL client is not running.
 */
const findLcuApi = (): { port: string; token: string } | null => {
  try {
    const output = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='LeagueClientUx.exe'" | Select-Object -ExpandProperty CommandLine`
    ], { encoding: 'utf8', timeout: 5000 })
    const portMatch = output.match(/--app-port=(\d+)/)
    const tokenMatch = output.match(/--remoting-auth-token=([^\s"']+)/)
    if (portMatch && tokenMatch) {
      return { port: portMatch[1], token: tokenMatch[1] }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Make an HTTPS request to LCU API with self-signed cert verification disabled.
 */
const lcuRequest = (port: string, auth: string, method: string, path: string, body?: string): Promise<{ status: number; data: string }> => {
  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: '127.0.0.1',
      port: parseInt(port),
      path,
      method,
      headers: {
        Authorization: `Basic ${auth}`,
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
      },
      rejectUnauthorized: false,
    }
    const req = https.request(options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => resolve({ status: res.statusCode || 0, data }))
    })
    req.on('error', reject)
    if (body) req.write(body)
    req.end()
  })
}

// ─── LCU API 游戏控制（退出/重启/开训练模式）──────────────────────────────

/** 获取 LCU API 连接信息和 auth header */
const getLcuConnection = (): { port: string; auth: string } | null => {
  const lcu = findLcuApi()
  if (!lcu) return null
  const auth = Buffer.from(`riot:${lcu.token}`).toString('base64')
  return { port: lcu.port, auth }
}

/** 获取当前游戏流程阶段：None, Lobby, Matchmaking, ReadyCheck, ChampSelect, InProgress, Reconnect, GameStart, WaitingForStats, EndOfGame */
const getGameflowPhase = async (): Promise<string | null> => {
  const conn = getLcuConnection()
  if (!conn) return null
  try {
    const { status, data } = await lcuRequest(conn.port, conn.auth, 'GET', '/lol-gameflow/v1/gameflow-phase')
    if (status === 200) return data.replace(/"/g, '').trim()
    return null
  } catch {
    return null
  }
}

/** 退出当前游戏（回到客户端大厅） */
const quitGameViaLcu = async (): Promise<boolean> => {
  const conn = getLcuConnection()
  if (!conn) return false
  try {
    const { status } = await lcuRequest(conn.port, conn.auth, 'POST', '/lol-gameflow/v1/quit-game')
    return status === 200 || status === 204
  } catch {
    return false
  }
}

/** 等待游戏流程进入指定阶段（超时毫秒） */
const waitForGameflowPhase = async (targetPhases: string[], timeoutMs: number): Promise<string | null> => {
  const startTime = Date.now()
  while (Date.now() - startTime < timeoutMs) {
    const phase = await getGameflowPhase()
    if (phase && targetPhases.includes(phase)) return phase
    await new Promise((r) => setTimeout(r, 1000))
  }
  return null
}

/** 开启训练模式（Practice Tool） */
const startPracticeToolViaLcu = async (): Promise<boolean> => {
  const conn = getLcuConnection()
  if (!conn) return false
  try {
    // 创建训练模式自定义房间
    const lobbyBody = JSON.stringify({
      customGameLobby: {
        configuration: {
          gameMode: 'PRACTICETOOL',
          gameMutator: '',
          gameServerRegion: '',
          mapId: 11,
          mutators: { id: 1 },
          spectatorPolicy: 'AllAllowed',
          teamSize: 1,
        },
        lobbyName: 'Keyforge Practice',
        lobbyPassword: '',
      },
      isCustom: true,
    })
    const { status: lobbyStatus } = await lcuRequest(conn.port, conn.auth, 'POST', '/lol-lobby/v2/lobby', lobbyBody)
    if (lobbyStatus !== 200 && lobbyStatus !== 204) return false

    // 等待房间创建完成
    await new Promise((r) => setTimeout(r, 2000))

    // 开始匹配（训练模式会直接进入游戏）
    const { status: matchStatus } = await lcuRequest(conn.port, conn.auth, 'POST', '/lol-lobby/v2/lobby/matchmaking/search')
    return matchStatus === 200 || matchStatus === 204
  } catch {
    return false
  }
}

/**
 * 自动重启游戏以应用新配置。
 * 流程：退出当前游戏 → 等待回到大厅 → 开启训练模式 → 等待游戏启动
 * 游戏进程重启时会读取更新后的 PersistedSettings.json，新键位即生效。
 * 返回 { success, message }
 */
const restartGameToApplyConfig = async (): Promise<{ success: boolean; message: string }> => {
  const conn = getLcuConnection()
  if (!conn) {
    return { success: false, message: '未检测到英雄联盟客户端运行，无法自动重启游戏。请手动重启游戏。' }
  }

  const currentPhase = await getGameflowPhase()
  if (!currentPhase) {
    return { success: false, message: '无法获取游戏状态。请手动重启游戏。' }
  }

  // 如果已经在大厅或不在游戏中，直接开训练模式
  if (currentPhase === 'None' || currentPhase === 'Lobby') {
    const started = await startPracticeToolViaLcu()
    if (started) {
      return { success: true, message: '已自动开启训练模式，新键位将在游戏启动后生效。' }
    }
    return { success: false, message: '开启训练模式失败。请手动开始一局游戏。' }
  }

  // 如果在游戏中，先退出
  if (currentPhase === 'InProgress' || currentPhase === 'Reconnect' || currentPhase === 'ChampSelect' || currentPhase === 'WaitingForStats' || currentPhase === 'EndOfGame') {
    const quitOk = await quitGameViaLcu()
    if (!quitOk) {
      return { success: false, message: '退出游戏失败。请手动退出游戏后重新开始。' }
    }

    // 等待回到大厅（最多 30 秒）
    const phase = await waitForGameflowPhase(['None', 'Lobby'], 30000)
    if (!phase) {
      return { success: false, message: '等待退出游戏超时（30秒）。请手动重启游戏。' }
    }

    // 开启训练模式
    const started = await startPracticeToolViaLcu()
    if (started) {
      return { success: true, message: '已自动退出游戏并重新开启训练模式，新键位将在游戏启动后生效。' }
    }
    return { success: false, message: '已退出游戏，但开启训练模式失败。请手动开始一局游戏。' }
  }

  return { success: false, message: `当前游戏状态（${currentPhase}）不支持自动重启。请手动重启游戏。` }
}

/**
 * Write LoL keybindings via LCU API (real-time, auto cloud-sync).
 * Works for both traditional mode (GameEvents) and WASD mode (WASD field).
 * Returns null if LCU API is not available (game not running).
 */
const writeLolViaLcuApi = async (req: WriteRequest): Promise<WriteResponse | null> => {
  const lcu = findLcuApi()
  if (!lcu) return null

  const isWasdMode = req.modeId === 'wasd' || req.profileName.toLowerCase().includes('wasd')
  const auth = Buffer.from(`riot:${lcu.token}`).toString('base64')

  try {
    // Parse configText and build updates. WASD previews already contain
    // native WASD event names, while legacy previews may still use evt names.
    const targetSection = isWasdMode ? 'WASD' : 'GameEvents'
    const bindings = parseLolSection(req.configText, targetSection)
    const updates: Record<string, string> = {}
    let skipped = 0
    for (const [event, normalizedKey] of Object.entries(bindings)) {
      const targetEvent = isWasdMode
        ? (wasdSupportedEvents.has(event) ? event : toWasdEvent(event))
        : event
      if (!targetEvent) { skipped++; continue }
      updates[targetEvent] = toLolKey(normalizedKey)
    }

    if (Object.keys(updates).length === 0) {
      return { success: false, message: `没有可写入的键位${skipped > 0 ? `（跳过 ${skipped} 个不支持的动作）` : ''}。`, gameId: req.gameId }
    }

    // PATCH the appropriate section (LCU API supports PATCH, not PUT)
    const patchBody = JSON.stringify({ [targetSection]: updates })
    const { status: patchStatus } = await lcuRequest(lcu.port, auth, 'PATCH', '/lol-game-settings/v1/input-settings', patchBody)
    if (patchStatus !== 200 && patchStatus !== 204) throw new Error(`LCU PATCH failed: HTTP ${patchStatus}`)

    // Also update input.ini locally (dual-write: cloud + local)
    let inputUpdated = false
    let backupPath: string | undefined
    try {
      const candidates = buildLolCandidates()
      const located = candidates.find((c) => existsSync(c.inputPath))
      if (located) {
        const bp = createBackup(located.inputPath, req.gameId)
        if (bp) backupPath = bp
        const inputContent = readFileSync(located.inputPath, 'utf8')
        const iniResult = updateIniSection(inputContent, targetSection, updates)
        writeFileSync(located.inputPath, iniResult.content, 'utf8')
        inputUpdated = true

        // Also update PersistedSettings.json
        if (existsSync(located.persistedSettingsPath)) {
          try {
            const raw = readFileSync(located.persistedSettingsPath, 'utf8')
            const data = JSON.parse(raw)
            const inputFile = (data.files ?? []).find((f: { name?: string }) => f.name === 'Input.ini')
            if (inputFile?.sections) {
              let section = inputFile.sections.find((s: { name?: string }) => s.name === targetSection)
              if (!section) {
                section = { name: targetSection, settings: [] }
                inputFile.sections.push(section)
              }
              if (!section.settings) section.settings = []
              for (const [event, value] of Object.entries(updates)) {
                const existing = section.settings.find((s: { name?: string }) => s.name === event)
                if (existing) existing.value = value
                else section.settings.push({ name: event, value })
              }
              writeFileSync(located.persistedSettingsPath, JSON.stringify(data, null, 2), 'utf8')
            }
          } catch { /* PersistedSettings update failed, not critical */ }
        }
      }
    } catch { /* input.ini update failed, LCU API still succeeded */ }

    const updatedCount = Object.keys(updates).length
    const modeLabel = isWasdMode ? 'WASD模式' : '传统模式'
    const skipNote = skipped > 0 ? `（跳过 ${skipped} 个${isWasdMode ? 'WASD模式不支持的' : ''}动作）` : ''
    const dualNote = inputUpdated ? ' 已同步更新本地 input.ini。' : ''
    return {
      success: true,
      message: `已通过 LCU API 实时写入 ${modeLabel}（更新 ${updatedCount} 个键位）${skipNote}。已自动同步到云端。${dualNote}注意：游戏内可能需要切换设置页面或重新进入才能看到变化。`,
      gameId: req.gameId,
      writtenPath: `LCU API (port ${lcu.port})`,
      backupPath: backupPath,
      linesWritten: updatedCount,
    }
  } catch (err) {
    return {
      success: false,
      message: `LCU API 写入失败：${err instanceof Error ? err.message : String(err)}。将尝试文件写入方式。`,
      gameId: req.gameId,
    }
  }
}

/**
 * 检查游戏是否正在运行（用于判断写入后是否需要提示用户重启游戏）
 */
const isGameRunning = (): boolean => {
  try {
    const procs = execFileSync('powershell.exe', [
      '-NoProfile', '-Command',
      `Get-Process -Name 'League of Legends' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id`
    ], { encoding: 'utf8', timeout: 3000 })
    return procs.trim().length > 0
  } catch {
    return false
  }
}

/**
 * 将键位更新写入 PersistedSettings.json（游戏实际读取的文件）。
 * 这是主写入目标，必须成功。
 * 支持传统模式（GameEvents section）和 WASD 模式（WASD section）。
 * 对于默认值字段（如 WASD 模式的 CastSpell1），如果不存在会自动添加。
 */
const writePersistedSettingsJson = (persistedPath: string, targetSectionName: string, updates: Record<string, string>): { updated: number; added: number } => {
  const raw = readFileSync(persistedPath, 'utf8')
  const data = JSON.parse(raw)
  const inputFile = (data.files ?? []).find((f: { name?: string }) => f.name === 'Input.ini')
  if (!inputFile) throw new Error('PersistedSettings.json 中未找到 Input.ini 文件节点')
  if (!inputFile.sections) inputFile.sections = []

  let targetSection = inputFile.sections.find((s: { name?: string }) => s.name === targetSectionName)
  if (!targetSection) {
    targetSection = { name: targetSectionName, settings: [] }
    inputFile.sections.push(targetSection)
  }
  if (!targetSection.settings) targetSection.settings = []

  let updated = 0
  let added = 0
  for (const [event, lolValue] of Object.entries(updates)) {
    const existing = targetSection.settings.find((s: { name?: string }) => s.name === event)
    if (existing) {
      existing.value = lolValue
      updated++
    } else {
      targetSection.settings.push({ name: event, value: lolValue })
      added++
    }
  }

  // 写回文件（无 BOM，保持与原文件一致的编码）
  writeFileSync(persistedPath, JSON.stringify(data, null, 2), 'utf8')
  return { updated, added }
}

/**
 * 英雄联盟键位写入主函数。
 *
 * 写入策略（已验证）：
 * 1. 主目标：PersistedSettings.json（游戏启动时实际读取的文件）
 * 2. 次目标：input.ini（保持兼容，供参考）
 * 3. 可选：LCU API（仅传统模式支持实时写入和云同步；WASD 模式 LCU API 不持久化）
 *
 * 生效条件：
 * - 游戏未运行：写入后下次启动游戏即生效
 * - 游戏运行中：写入后需退出当前对局回到大厅再重新进入（游戏进程重启读取配置）
 * - 云同步：传统模式可通过 LCU API 实时同步到云；WASD 模式需在游戏内打开设置并保存一次触发云同步
 */
const writeLolPersistedSettings = async (req: WriteRequest): Promise<WriteResponse> => {
  // 定位配置目录
  const candidates = buildLolCandidates()
  const located = candidates.find((c) => existsSync(c.persistedSettingsPath) || existsSync(c.inputPath))
  if (!located) {
    return { success: false, message: '未找到英雄联盟配置目录。已扫描 Riot 安装清单、WeGame 目录、Documents 和 LocalAppData。', gameId: req.gameId }
  }

  const persistedPath = located.persistedSettingsPath
  const inputIniPath = located.inputPath
  const isWasdMode = req.modeId === 'wasd' || req.profileName.toLowerCase().includes('wasd')
  const targetSectionName = isWasdMode ? 'WASD' : 'GameEvents'
  const modeLabel = isWasdMode ? 'WASD模式' : '传统模式'

  // 解析配置文本
  const bindings = parseLolSection(req.configText, targetSectionName)
  if (Object.keys(bindings).length === 0) {
    return { success: false, message: `配置文本中未找到 [${targetSectionName}] 键位。`, gameId: req.gameId }
  }

    // 构建更新映射（转换事件名和键位格式）
    const updates: Record<string, string> = {}
    let skipped = 0
    for (const [event, normalizedKey] of Object.entries(bindings)) {
    const targetEvent = isWasdMode
      ? (wasdSupportedEvents.has(event) ? event : toWasdEvent(event))
      : event
    if (!targetEvent) { skipped++; continue }
    updates[targetEvent] = toLolKey(normalizedKey)
  }

  if (Object.keys(updates).length === 0) {
    return { success: false, message: `没有可写入的键位${skipped > 0 ? `（跳过 ${skipped} 个不支持的动作）` : ''}。`, gameId: req.gameId }
  }

  try {
    // ── 步骤1：备份 PersistedSettings.json（主文件）──
    const persistedBackup = existsSync(persistedPath) ? createBackup(persistedPath, `${req.gameId}_persisted`) : null

    // ── 步骤2：写入 PersistedSettings.json（主目标，必须成功）──
    if (!existsSync(persistedPath)) {
      return { success: false, message: `未找到 PersistedSettings.json（${persistedPath}）。请先启动一次英雄联盟客户端。`, gameId: req.gameId }
    }
    const psResult = writePersistedSettingsJson(persistedPath, targetSectionName, updates)

    // ── 步骤3：写入 input.ini（次目标，尽力而为）──
    let inputUpdated = false
    let inputBackup: string | null = null
    if (existsSync(inputIniPath)) {
      try {
        inputBackup = createBackup(inputIniPath, `${req.gameId}_input`)
        const inputContent = readFileSync(inputIniPath, 'utf8')
        const iniResult = updateIniSection(inputContent, targetSectionName, updates)
        writeFileSync(inputIniPath, iniResult.content, 'utf8')
        inputUpdated = true
      } catch { /* input.ini 更新失败不影响主功能 */ }
    }

    // ── 步骤4：游戏运行时自动重启以应用新配置 ──
    const lcuSynced = false
    const lcuMessage = ''
    const gameRunning = isGameRunning()
    let restartNote = ''
    if (gameRunning && !lcuSynced) {
      // WASD 模式或传统模式 LCU 失败时，自动重启游戏
      const restartResult = await restartGameToApplyConfig()
      restartNote = ` ${restartResult.message}`
      if (!restartResult.success) {
        restartNote += ' 配置已写入本地文件，手动重启游戏后即生效。'
      }
    } else if (gameRunning && lcuSynced) {
      restartNote = ' 游戏运行中，LCU API 已实时生效，无需重启。'
    } else {
      restartNote = ' 游戏未运行，下次启动游戏即生效。'
    }

    // WASD 模式云同步提示
    const cloudNote = isWasdMode
      ? ' WASD 模式如需同步到云端（换电脑可用），请在游戏内按 ESC 打开设置 → 热键 → 点击"已完成"保存一次，即自动同步到云。'
      : ''

    const skipNote = skipped > 0 ? `（跳过 ${skipped} 个${isWasdMode ? 'WASD模式不支持的' : ''}动作）` : ''
    const inputNote = inputUpdated ? ' input.ini 已同步更新。' : ''

    return {
      success: true,
      message: `已写入 PersistedSettings.json ${modeLabel} [${targetSectionName}]（更新 ${psResult.updated} 个，新增 ${psResult.added} 个）${skipNote}。${persistedBackup ? `备份：${persistedBackup}。` : ''}${inputNote}${lcuMessage}${restartNote}${cloudNote}`,
      gameId: req.gameId,
      writtenPath: persistedPath,
      backupPath: persistedBackup ?? undefined,
      linesWritten: psResult.updated + psResult.added,
    }
  } catch (err) {
    return {
      success: false,
      message: `写入 PersistedSettings.json 失败：${err instanceof Error ? err.message : String(err)}`,
      gameId: req.gameId,
    }
  }
}

// ─── Civilization VI JSON config writer ──────────────────────────────────────

/**
 * Write Civilization VI keybindings by reading the existing InputSettings.json,
 * modifying the relevant KBMouse entries, and writing back.
 * This preserves all other game settings (graphics, audio, etc.).
 */
const writeCiv6Config = (req: WriteRequest): WriteResponse => {
  // Detect Civ6 config path
  const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE ?? 'C:\\Users\\Administrator', 'AppData', 'Local')
  const civ6Dir = join(localAppData, 'Firaxis Games', 'Sid Meier\'s Civilization VI')
  const targetPath = join(civ6Dir, 'InputSettings.json')

  if (!existsSync(targetPath)) {
    return { success: false, message: `未找到文明6配置文件：${targetPath}`, gameId: req.gameId }
  }

  try {
    // Read and parse existing config
    const raw = readFileSync(targetPath, 'utf8')
    const config = JSON.parse(raw) as Record<string, any>

    // Parse key=value pairs from configText
    const bindings: Record<string, string> = {}
    for (const line of req.configText.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) continue
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim()
        const value = trimmed.slice(eqIdx + 1).trim()
        if (key && value) bindings[key] = value
      }
    }

    // Apply each binding to the JSON config
    let modifiedCount = 0
    for (const [actionName, keyValue] of Object.entries(bindings)) {
      if (config[actionName] && Array.isArray(config[actionName])) {
        // Find the first KBMouse entry and update its data field
        for (const entry of config[actionName]) {
          if (entry && entry.type === 'KBMouse') {
            const keyUpper = keyValue.toUpperCase()
            entry.data = `LOC_OPTIONS_KEY_${keyUpper}`
            modifiedCount++
            break
          }
        }
      }
    }

    if (modifiedCount === 0) {
      return { success: false, message: '未找到可修改的键位条目（配置格式可能已变更）', gameId: req.gameId }
    }

    // Backup original file
    const backupPath = createBackup(targetPath, req.gameId)

    // Write back
    const jsonOutput = JSON.stringify(config, null, 2)
    writeFileSync(targetPath, jsonOutput, 'utf8')

    return {
      success: true,
      message: `已写入文明6配置（修改 ${modifiedCount} 个键位）。${backupPath ? `原文件备份：${backupPath}。` : ''}重启游戏后生效。`,
      gameId: req.gameId,
      writtenPath: targetPath,
      backupPath: backupPath ?? undefined,
      linesWritten: modifiedCount,
    }
  } catch (err) {
    return {
      success: false,
      message: `写入文明6配置失败：${err instanceof Error ? err.message : String(err)}`,
      gameId: req.gameId,
    }
  }
}

// ─── Write config ─────────────────────────────────────────────────────────────

/**
 * Write config to a game's config directory.
 * For CS2: writes keyforge.cfg to the cfg directory (safe, doesn't overwrite config.cfg)
 * For CF/饥荒: writes the config file directly, with backup first
 * For Civ6: reads existing JSON, modifies keybindings, writes back
 */
const writeGameConfig = async (req: WriteRequest): Promise<WriteResponse> => {
  // LoL is primarily written through the running client's LCU API so the
  // account/cloud settings are updated even when no local input file exists.
  if (req.gameId === 'lol') {
    const lcuResult = await writeLolViaLcuApi(req)
    if (lcuResult?.success) return lcuResult
    const localResult = await writeLolPersistedSettings(req)
    if (localResult.success || !lcuResult) return localResult
    return lcuResult
  }

  // Civilization VI: JSON format, read-modify-write to preserve other settings
  if (req.gameId === 'civilization-vi') {
    return writeCiv6Config(req)
  }

  const detection = detectGame(req.gameId)
  if (!detection.found || !detection.configPath) {
    return { success: false, message: detection.message || '未找到游戏配置目录。', gameId: req.gameId }
  }

  const targetPath = join(detection.configPath, req.fileName)
  let backupPath: string | undefined

  // For CS2, we write a separate keyforge.cfg — no need to backup (it's a new file)
  // But if the file already exists, back it up
  if (existsSync(targetPath)) {
    const bp = createBackup(targetPath, req.gameId)
    if (bp) backupPath = bp
  }

  try {
    // Ensure directory exists
    if (!existsSync(dirname(targetPath))) {
      mkdirSync(dirname(targetPath), { recursive: true })
    }
    writeFileSync(targetPath, req.configText, 'utf8')
    const lineCount = req.configText.split('\n').length

    // For CS2, also offer to add exec to autoexec.cfg if it exists
    let extraMessage = ''
    if (req.gameId === 'cs2') {
      const autoexecPath = join(detection.configPath, 'autoexec.cfg')
      if (existsSync(autoexecPath)) {
        const content = readFileSync(autoexecPath, 'utf8')
        if (!content.includes('keyforge')) {
          try {
            const bp = createBackup(autoexecPath, 'cs2_autoexec')
            writeFileSync(autoexecPath, content + `\n// Keyforge: load custom binds\nexec keyforge.cfg\n`, 'utf8')
            extraMessage = ` 已自动在 autoexec.cfg 中添加 exec keyforge.cfg（备份：${bp ?? '已创建'}）。`
          } catch { /* autoexec modification failed, not critical */ }
        }
      } else {
        extraMessage = ' 如需自动加载，请在 autoexec.cfg 中添加 exec keyforge.cfg。'
      }
    }

    return {
      success: true,
      message: `已写入 ${req.fileName}（${lineCount} 行）。${backupPath ? `原文件备份：${backupPath}。` : ''}${extraMessage}`,
      gameId: req.gameId,
      writtenPath: targetPath,
      backupPath,
      linesWritten: lineCount,
    }
  } catch (err) {
    return {
      success: false,
      message: `写入失败：${err instanceof Error ? err.message : String(err)}`,
      gameId: req.gameId,
    }
  }
}

// ─── LoL reader (preserved from original) ─────────────────────────────────────

const buildLolCandidates = (): LolConfigPair[] => {
  const candidates: LolConfigPair[] = []
  const seen = new Set<string>()
  const addCandidate = (source: string, folder: string) => {
    if (!folder) return
    const configFolder = normalize(folder)
    const identity = configFolder.toLowerCase()
    if (seen.has(identity)) return
    seen.add(identity)
    candidates.push({
      source,
      gameCfgPath: join(configFolder, 'game.cfg'),
      inputPath: join(configFolder, 'input.ini'),
      persistedSettingsPath: join(configFolder, 'PersistedSettings.json'),
    })
  }

  const programData = process.env.ProgramData ?? 'C:\\ProgramData'
  const installs = safelyReadJson(join(programData, 'Riot Games', 'RiotClientInstalls.json'))
  const associated = installs?.associated_client
  if (associated && typeof associated === 'object') {
    for (const gameRoot of Object.keys(associated as Record<string, unknown>)) {
      const isLeagueInstall = gameRoot.toLowerCase().includes('league') || gameRoot.includes('英雄联盟')
      if (!isLeagueInstall) continue
      // 国际版: <root>/Config
      addCandidate('Riot 安装清单', join(resolve(gameRoot), 'Config'))
      // 国服/WeGame: <root>/Game/Config
      addCandidate('Riot 安装清单(Game)', join(resolve(gameRoot), 'Game', 'Config'))
    }
  }

  // WeGame 安装目录扫描 (D:\WeGameApps\英雄联盟\Game\Config)
  const weGameRoots = ['D:\\WeGameApps', 'C:\\WeGameApps', 'E:\\WeGameApps', 'D:\\Program Files\\WeGameApps']
  for (const root of weGameRoots) {
    if (!existsSync(root)) continue
    try {
      const dirs = readdirSync(root, { withFileTypes: true })
      for (const dir of dirs) {
        if (!dir.isDirectory()) continue
        const name = dir.name.toLowerCase()
        if (name.includes('league') || name.includes('英雄') || name === 'lol') {
          addCandidate('WeGame 安装目录', join(root, dir.name, 'Game', 'Config'))
        }
      }
    } catch { /* ignore permission errors */ }
  }

  const documentsPath = getWindowsDocumentsPath()
  const localAppData = process.env.LOCALAPPDATA
  if (documentsPath) addCandidate('Windows Documents', join(documentsPath, 'League of Legends', 'Config'))
  if (localAppData) addCandidate('Riot LocalAppData', join(localAppData, 'Riot Games', 'League of Legends', 'Config'))

  return candidates
}

const getLolWatchRoots = () => {
  const documentsPath = getWindowsDocumentsPath()
  const appData = process.env.APPDATA
  const paths = [
    ...buildLolCandidates().map((candidate) => dirname(candidate.inputPath)),
    documentsPath ? join(documentsPath, 'League of Legends') : null,
    appData ? join(appData, 'Tencent', 'WeGame') : null,
    appData ? join(appData, 'Tencent', 'TGP') : null,
  ].filter((path): path is string => Boolean(path && existsSync(path)))
  return paths.filter((path, index) => paths.findIndex((candidate) => candidate.toLowerCase() === path.toLowerCase()) === index)
}

const clearLolSaveWatch = () => {
  for (const watcher of lolWatchState.watchers) watcher.close()
  lolWatchState.watchers = []
  lolWatchState.startedAt = null
}

const isRelevantLolWrite = (filePath: string) => {
  const name = basename(filePath)
  if (/\.(log|lock|tmp)$/i.test(name)) return false
  return /\.(cfg|ini|yaml|json|dat)$/i.test(name) || /(input|key|hotkey|bind|setting|config)/i.test(name)
}

const getLolWatchStatus = () => ({
  status: lolWatchState.startedAt ? (lolWatchState.events.length ? 'captured' : 'watching') : 'idle',
  message: lolWatchState.events.length
    ? `已捕捉到 ${lolWatchState.events.length} 次相关文件写入。`
    : lolWatchState.startedAt
      ? '正在监测下一次本地保存。'
      : '尚未启动保存位置监测。',
  startedAt: lolWatchState.startedAt,
  roots: lolWatchState.roots,
  events: lolWatchState.events,
})

const startLolSaveWatch = () => {
  clearLolSaveWatch()
  lolWatchState.roots = getLolWatchRoots()
  lolWatchState.events = []
  lolWatchState.startedAt = new Date().toISOString()
  for (const root of lolWatchState.roots) {
    try {
      const watcher = watchFileSystem(root, { recursive: true }, (change, fileName) => {
        if (!fileName) return
        const path = join(root, fileName.toString())
        if (!isRelevantLolWrite(path)) return
        lolWatchState.events.unshift({ at: new Date().toISOString(), change, path })
        lolWatchState.events = lolWatchState.events.slice(0, 80)
      })
      watcher.on('error', () => undefined)
      lolWatchState.watchers.push(watcher)
    } catch { /* A missing or locked directory should not prevent watching the other known locations. */ }
  }
  return getLolWatchStatus()
}

// ─── PersistedSettings.json parser ────────────────────────────────────────────

type LolBinding = { event: string; key: string; section: string }

/**
 * 解析 PersistedSettings.json 中的键位配置。
 * 文件结构: { files: [{ name: 'Input.ini', sections: [{ name, settings: [{name, value}] }] }] }
 */
const parsePersistedSettings = (filePath: string): { traditional: LolBinding[]; wasd: LolBinding[]; quickbinds: Record<string, string>; raw: string } | null => {
  if (!existsSync(filePath)) return null
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const data = JSON.parse(raw)
    const inputFile = (data.files ?? []).find((f: { name?: string }) => f.name === 'Input.ini')
    if (!inputFile?.sections) return { traditional: [], wasd: [], quickbinds: {}, raw }

    const traditional: LolBinding[] = []
    const wasd: LolBinding[] = []
    const quickbinds: Record<string, string> = {}

    for (const section of inputFile.sections) {
      const sectionName = section.name ?? ''
      const settings = section.settings ?? []
      for (const setting of settings) {
        const event = setting.name ?? ''
        const value = setting.value
        const key = value === null || value === undefined ? '' : String(value)
        if (sectionName === 'GameEvents') {
          traditional.push({ event, key, section: sectionName })
        } else if (sectionName === 'WASD') {
          wasd.push({ event, key, section: sectionName })
        } else if (sectionName === 'Quickbinds') {
          quickbinds[event] = key
        }
      }
    }

    return { traditional, wasd, quickbinds, raw }
  } catch {
    return null
  }
}

const readLolSettings = () => {
  const candidates = buildLolCandidates()
  // 优先找 PersistedSettings.json（包含完整键位），其次找 Input.ini / game.cfg
  const located = candidates.find((c) => existsSync(c.persistedSettingsPath) || existsSync(c.inputPath) || existsSync(c.gameCfgPath))
  if (!located) {
    return {
      status: 'not_found',
      message: '未发现本机英雄联盟配置文件。已扫描 Riot 安装清单、WeGame 安装目录、Documents 和 LocalAppData。',
      candidates: candidates.map((c) => ({ source: c.source, gameCfgPath: c.gameCfgPath, inputPath: c.inputPath, persistedSettingsPath: c.persistedSettingsPath })),
    }
  }

  const hasPersisted = existsSync(located.persistedSettingsPath)
  const hasInput = existsSync(located.inputPath)
  const hasGameCfg = existsSync(located.gameCfgPath)

  const persisted = hasPersisted ? parsePersistedSettings(located.persistedSettingsPath) : null
  const gameEntries = hasGameCfg ? readIni(located.gameCfgPath) : []
  const inputEntries = hasInput ? readIni(located.inputPath) : []

  return {
    status: hasPersisted ? 'found' : hasInput ? 'partial' : 'gamecfg_only',
    message: hasPersisted
      ? '已读取本机英雄联盟 PersistedSettings.json（含传统模式和 WASD 模式键位）。'
      : hasInput
        ? '已读取 Input.ini（未发现 PersistedSettings.json，键位可能不完整）。'
        : '只发现 game.cfg，尚未发现键位文件。',
    source: located.source,
    persistedSettingsPath: hasPersisted ? located.persistedSettingsPath : null,
    inputPath: hasInput ? located.inputPath : null,
    gameCfgPath: hasGameCfg ? located.gameCfgPath : null,
    wasd: {
      movementRotation: findSetting(gameEntries, 'General', 'WASDMovementRotation'),
      cameraMode: findSetting(gameEntries, 'General', 'CameraModeWASD'),
      bindings: persisted?.wasd ?? [],
    },
    traditional: {
      bindings: persisted?.traditional ?? [],
      quickbinds: persisted?.quickbinds ?? {},
    },
    bindings: (persisted?.traditional ?? []).slice(0, 200),
    inputIniEntries: inputEntries.slice(0, 100),
    candidates: candidates.map((c) => ({ source: c.source, gameCfgPath: c.gameCfgPath, inputPath: c.inputPath, persistedSettingsPath: c.persistedSettingsPath })),
  }
}

// ─── Local preset management (universal middle layer) ───────────────────────
//
// Flow: A账号游戏 → 读取 → 保存为本地预设文件 → B账号/C游戏 从本地预设应用
// Presets are stored as JSON files in %USERPROFILE%\Documents\Keyforge\presets\
// Once saved, a preset can be applied to ANY game without re-reading the source.

const getPresetsDir = (): string => {
  const documentsPath = getWindowsDocumentsPath()
  const base = documentsPath ?? (process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Documents') : process.cwd())
  return join(base, 'Keyforge', 'presets')
}

const ensurePresetsDir = (): string => {
  const dir = getPresetsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

const sanitizePresetId = (id: string): string => {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
}

const listLocalPresets = () => {
  const dir = getPresetsDir()
  const presets: Array<Record<string, unknown> & { bindingCount: number; filePath: string }> = []

  if (!existsSync(dir)) {
    return { success: true, message: '预设目录不存在（将在首次保存时创建）。', presets, presetsDir: dir }
  }

  try {
    const files = readdirSync(dir, { withFileTypes: true })
      .filter((f) => f.isFile() && (f.name.endsWith('.keyforge.json') || f.name.endsWith('.json')))
      .map((f) => join(dir, f.name))

    for (const filePath of files) {
      try {
        const raw = readFileSync(filePath, 'utf8')
        const preset = JSON.parse(raw)
        const bindings = preset.bindings ?? {}
        presets.push({
          id: preset.id ?? 'unknown',
          name: preset.name ?? '未命名预设',
          category: preset.category,
          note: preset.note ?? '',
          sourceGame: preset.sourceGame,
          sourceMode: preset.sourceMode,
          createdAt: preset.createdAt,
          updatedAt: preset.updatedAt,
          bindingCount: Object.keys(bindings).length,
          filePath,
        })
      } catch { /* skip invalid files */ }
    }

    presets.sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    return { success: true, message: `找到 ${presets.length} 个本地预设。`, presets, presetsDir: dir }
  } catch (err) {
    return { success: false, message: `读取预设目录失败：${err instanceof Error ? err.message : String(err)}`, presets, presetsDir: dir }
  }
}

const saveLocalPreset = (preset: Record<string, unknown>): { success: boolean; message: string; presetId?: string; filePath?: string } => {
  try {
    const dir = ensurePresetsDir()
    const id = sanitizePresetId(String(preset.id ?? `preset-${Date.now()}`))
    const now = new Date().toISOString()

    const presetToSave = {
      version: '1.0',
      id,
      name: String(preset.name ?? '未命名预设'),
      category: preset.category,
      note: preset.note,
      sourceGame: preset.sourceGame,
      sourceMode: preset.sourceMode,
      createdAt: preset.createdAt ?? now,
      updatedAt: now,
      bindings: preset.bindings ?? {},
    }

    const filePath = join(dir, `${id}.keyforge.json`)
    writeFileSync(filePath, JSON.stringify(presetToSave, null, 2), 'utf8')
    return { success: true, message: `预设已保存到本地：${filePath}`, presetId: id, filePath }
  } catch (err) {
    return { success: false, message: `保存预设失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

const loadLocalPreset = (id: string): { success: boolean; message: string; preset?: Record<string, unknown>; filePath?: string } => {
  try {
    const dir = getPresetsDir()
    const safeId = sanitizePresetId(id)
    // Try both .keyforge.json and .json extensions
    const candidates = [join(dir, `${safeId}.keyforge.json`), join(dir, `${safeId}.json`)]
    const filePath = candidates.find((p) => existsSync(p))

    if (!filePath) {
      return { success: false, message: `未找到预设：${id}` }
    }

    const raw = readFileSync(filePath, 'utf8')
    const preset = JSON.parse(raw)
    return { success: true, message: `预设已加载：${preset.name ?? id}`, preset, filePath }
  } catch (err) {
    return { success: false, message: `加载预设失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

const deleteLocalPreset = (id: string): { success: boolean; message: string; presetId?: string } => {
  try {
    const dir = getPresetsDir()
    const safeId = sanitizePresetId(id)
    const candidates = [join(dir, `${safeId}.keyforge.json`), join(dir, `${safeId}.json`)]
    const filePath = candidates.find((p) => existsSync(p))

    if (!filePath) {
      return { success: false, message: `未找到预设：${id}`, presetId: id }
    }

    unlinkSync(filePath)
    return { success: true, message: `预设已删除：${id}`, presetId: id }
  } catch (err) {
    return { success: false, message: `删除预设失败：${err instanceof Error ? err.message : String(err)}` }
  }
}

// ─── Vite plugin ──────────────────────────────────────────────────────────────

const keyforgeAdapterPlugin = (): Plugin => ({
  name: 'keyforge-native-adapter',
  configureServer(server) {
    console.log('[Keyforge] Plugin configureServer called - registering API endpoints')
    // ── Game detection (single) ──
    server.middlewares.use('/api/adapters/detect', (request, response, next) => {
      if (request.method !== 'GET') { next(); return }
      try {
        const url = new URL(request.url ?? '', 'http://localhost')
        const gameId = url.searchParams.get('gameId') ?? ''
        const result = detectGame(gameId)
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(result))
      } catch {
        response.statusCode = 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ success: false, message: '检测游戏安装时发生错误。' }))
      }
    })

    // ── Detect all installed games (data-driven) ──
    server.middlewares.use('/api/adapters/detect-all', (request, response, next) => {
      if (request.method !== 'GET') { next(); return }
      try {
        const result = detectAllGames()
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(result))
      } catch (err) {
        response.statusCode = 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ success: false, message: `检测所有游戏时发生错误：${err instanceof Error ? err.message : String(err)}` }))
      }
    })

    // ── List custom (auto-generated) adapters ──
    server.middlewares.use('/api/adapters/custom/list', (request, response, next) => {
      if (request.method !== 'GET') { next(); return }
      try {
        const adapters = listCustomAdapters()
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify({ success: true, adapters, count: adapters.length, dir: getCustomAdaptersDir() }))
      } catch (err) {
        response.statusCode = 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ success: false, message: `列出自定义适配器失败：${err instanceof Error ? err.message : String(err)}` }))
      }
    })

    // ── Generate adapter from Ludusavi data ──
    server.middlewares.use('/api/adapters/generate', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        try {
          const req = JSON.parse(body) as { steamAppId: string }
          if (!req.steamAppId) {
            response.statusCode = 400
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ success: false, message: '缺少 steamAppId 参数' }))
            return
          }
          const result = generateAdapterFromLudusavi(req.steamAppId)
          if (result.success && result.adapter) {
            const saveResult = saveCustomAdapter(result.adapter)
            response.statusCode = saveResult.success ? 200 : 400
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.setHeader('Cache-Control', 'no-store')
            response.end(JSON.stringify({ ...saveResult, adapter: result.adapter }))
          } else {
            response.statusCode = 400
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ success: false, message: result.message }))
          }
        } catch (err) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ success: false, message: `生成适配器失败：${err instanceof Error ? err.message : String(err)}` }))
        }
      })
    })

    // ── Delete custom adapter ──
    server.middlewares.use('/api/adapters/custom/delete', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        try {
          const req = JSON.parse(body) as { id: string }
          if (!req.id) {
            response.statusCode = 400
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ success: false, message: '缺少 id 参数' }))
            return
          }
          const result = deleteCustomAdapter(req.id)
          response.statusCode = result.success ? 200 : 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify(result))
        } catch (err) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ success: false, message: `删除适配器失败：${err instanceof Error ? err.message : String(err)}` }))
        }
      })
    })

    // ── Write config (with automatic backup) ──
    server.middlewares.use('/api/adapters/write', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', async () => {
        try {
          const req = JSON.parse(body) as WriteRequest
          const result = await writeGameConfig(req)
          response.statusCode = result.success ? 200 : 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify(result))
        } catch {
          response.statusCode = 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ success: false, message: '无效的写入请求。' }))
        }
      })
    })

    // ── One-click ESDF migration (shared with electron/api-handlers.cjs) ──
    server.middlewares.use('/api/adapters/esdf-migrate', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        try {
          const req = body ? JSON.parse(body) : {}
          const result = apiHandlers.migrateEsdfConfig(req)
          response.statusCode = result.success ? 200 : 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify(result))
        } catch (err) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ success: false, message: `ESDF 迁移失败：${err instanceof Error ? err.message : String(err)}` }))
        }
      })
    })

    server.middlewares.use('/api/adapters/esdf-candidates', (request, response, next) => {
      if (request.method !== 'GET') { next(); return }
      try {
        const result = apiHandlers.listEsdfCandidates()
        response.statusCode = result.success ? 200 : 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(result))
      } catch (err) {
        response.statusCode = 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ success: false, message: String(err) }))
      }
    })

    server.middlewares.use('/api/adapters/esdf-batch', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        try {
          const req = body ? JSON.parse(body) : {}
          const result = apiHandlers.batchMigrateEsdf(req)
          response.statusCode = result.success ? 200 : 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify(result))
        } catch (err) {
          response.statusCode = 500
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ success: false, message: String(err) }))
        }
      })
    })

    // ── LoL reader (preserved) ──
    server.middlewares.use('/api/adapters/lol/read', (request, response, next) => {
      if (request.method !== 'GET') { next(); return }
      try {
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(readLolSettings()))
      } catch {
        response.statusCode = 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ status: 'error', message: '读取本机英雄联盟设置时发生错误。' }))
      }
    })

    // ── LoL watch start (preserved) ──
    server.middlewares.use('/api/adapters/lol/watch/start', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.end(JSON.stringify(startLolSaveWatch()))
    })

    // ── LoL watch status (preserved) ──
    server.middlewares.use('/api/adapters/lol/watch/status', (request, response, next) => {
      if (request.method !== 'GET') { next(); return }
      response.statusCode = 200
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.setHeader('Cache-Control', 'no-store')
      response.end(JSON.stringify(getLolWatchStatus()))
    })

    // ── Local presets: list all saved presets ──
    server.middlewares.use('/api/presets/list', (request, response, next) => {
      if (request.method !== 'GET') { next(); return }
      try {
        const result = listLocalPresets()
        response.statusCode = result.success ? 200 : 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(result))
      } catch (err) {
        response.statusCode = 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ success: false, message: `列出预设失败：${err instanceof Error ? err.message : String(err)}` }))
      }
    })

    // ── Local presets: save a preset ──
    server.middlewares.use('/api/presets/save', (request, response, next) => {
      if (request.method !== 'POST') { next(); return }
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        try {
          const preset = JSON.parse(body)
          const result = saveLocalPreset(preset)
          response.statusCode = result.success ? 200 : 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify(result))
        } catch (err) {
          response.statusCode = 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ success: false, message: `无效的预设数据：${err instanceof Error ? err.message : String(err)}` }))
        }
      })
    })

    // ── Local presets: load a preset ──
    server.middlewares.use('/api/presets/load', (request, response, next) => {
      if (request.method !== 'GET') { next(); return }
      try {
        const url = new URL(request.url ?? '', 'http://localhost')
        const id = url.searchParams.get('id') ?? ''
        if (!id) {
          response.statusCode = 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ success: false, message: '缺少预设 ID。' }))
          return
        }
        const result = loadLocalPreset(id)
        response.statusCode = result.success ? 200 : 404
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.setHeader('Cache-Control', 'no-store')
        response.end(JSON.stringify(result))
      } catch (err) {
        response.statusCode = 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(JSON.stringify({ success: false, message: `加载预设失败：${err instanceof Error ? err.message : String(err)}` }))
      }
    })

    // ── Local presets: delete a preset ──
    server.middlewares.use('/api/presets/delete', (request, response, next) => {
      if (request.method !== 'POST' && request.method !== 'DELETE') { next(); return }
      let body = ''
      request.on('data', (chunk) => { body += chunk })
      request.on('end', () => {
        try {
          const data = body ? JSON.parse(body) : {}
          const id = data.id ?? new URL(request.url ?? '', 'http://localhost').searchParams.get('id') ?? ''
          if (!id) {
            response.statusCode = 400
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ success: false, message: '缺少预设 ID。' }))
            return
          }
          const result = deleteLocalPreset(id)
          response.statusCode = result.success ? 200 : 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.setHeader('Cache-Control', 'no-store')
          response.end(JSON.stringify(result))
        } catch (err) {
          response.statusCode = 400
          response.setHeader('Content-Type', 'application/json; charset=utf-8')
          response.end(JSON.stringify({ success: false, message: `删除预设失败：${err instanceof Error ? err.message : String(err)}` }))
        }
      })

      // ─── Real-time input monitoring SSE ───────────────────────────────
      server.middlewares.use('/api/input/events', (request, response, next) => {
        if (request.method !== 'GET') { next(); return }
        // Start keyboard and mouse listeners on first SSE connection
        startKeyboardListener()
        startMouseMonitor()
        // SSE headers
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        response.write(': connected\n\n')
        const client: SseClient = { response }
        sseClients.add(client)
        // Send current connected count
        response.write(`data: ${JSON.stringify({ type: 'system', event: 'connected', clients: sseClients.size, timestamp: Date.now() })}\n\n`)
        // Heartbeat
        const heartbeat = setInterval(() => {
          try { response.write(': heartbeat\n\n') } catch { clearInterval(heartbeat) }
        }, 15000)
        request.on('close', () => {
          clearInterval(heartbeat)
          sseClients.delete(client)
        })
      })

      // Endpoint to receive input events from Electron main process
      server.middlewares.use('/api/input/emit', (request, response, next) => {
        if (request.method !== 'POST') { next(); return }
        let body = ''
        request.on('data', (chunk: Buffer) => { body += chunk.toString() })
        request.on('end', () => {
          try {
            const data = JSON.parse(body || '{}')
            if (data.type === 'keyboard') {
              broadcastInputEvent({
                type: 'keyboard',
                key: data.key || 'Unknown',
                state: data.state || 'down',
                vKey: data.vKey || 0,
                scanCode: data.scanCode || 0,
                timestamp: Date.now(),
              })
            } else if (data.type === 'mouse') {
              broadcastInputEvent({
                type: 'mouse',
                button: data.button || 'left',
                state: data.state || 'down',
                timestamp: Date.now(),
              })
            }
            response.statusCode = 200
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
            response.end(JSON.stringify({ success: true }))
          } catch (err) {
            response.statusCode = 500
            response.end(JSON.stringify({ success: false, error: String(err) }))
          }
        })
      })
    })
  },
})

export default defineConfig({
  base: './',
  plugins: [react(), keyforgeAdapterPlugin()],
})
