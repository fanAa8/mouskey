const {execFileSync} = require('node:child_process');
const ue4g = require('./ue4-generic.cjs');
const {existsSync, mkdirSync, readFileSync, readdirSync, copyFileSync, writeFileSync, unlinkSync, watch} = require('node:fs');
const {basename, dirname, join, normalize, resolve} = require('node:path');
const https = require('node:https');

// ─── Types ──────────────────────────────────────────────────────────────────





/** Load Ludusavi game config lookup table (generated from ludusavi-manifest) */
const loadLudusaviData = ()=> {
 try {
 const dataPath = join(join(__dirname, '..'), 'src', 'data', 'ludusavi-games.json')
 if (!existsSync(dataPath)) {
 return { version: '0', source: 'none', generatedAt: '', totalGames: 0, games: {} }
 }
 const content = readFileSync(dataPath, 'utf8')
 return JSON.parse(content)
 } catch {
 return { version: '0', source: 'none', generatedAt: '', totalGames: 0, games: {} }
 }
}

const ludusaviData = loadLudusaviData()

// ─── Global input monitoring (keyboard + mouse) ────────────────────────────

const sseClients= new Set()

const broadcastInputEvent = (event) => {
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
 listener.addListener((e, down) => {
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

 const MOUSE_VKEYS= {
 left: 1, // VK_LBUTTON
 right: 2, // VK_RBUTTON
 middle: 4, // VK_MBUTTON
 x1: 5, // VK_XBUTTON1
 x2: 6, // VK_XBUTTON2
 }

 setInterval(() => {
 let changed = false
 const newState= {}
 for (const [button, vkey] of Object.entries(MOUSE_VKEYS)) {
 const pressed = GetAsyncKeyState(vkey) !== 0
 newState[button] = pressed
 if (pressed !== currentMouseState[button]) {
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


const getCustomAdaptersDir = ()=> {
 const docs = getWindowsDocumentsPath()
 return docs ? join(docs, 'Keyforge', 'adapters') : join(process.env.USERPROFILE ?? 'C:\\Users\\Public', 'Documents', 'Keyforge', 'adapters')
}

const ensureCustomAdaptersDir = ()=> {
 const dir = getCustomAdaptersDir()
 if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
 return dir
}

const listCustomAdapters = ()=> {
 const dir = getCustomAdaptersDir()
 if (!existsSync(dir)) return []
 try {
 return readdirSync(dir, { withFileTypes: true })
 .filter((f) => f.isFile() && f.name.endsWith('.json'))
 .map((f) => {
 try { return JSON.parse(readFileSync(join(dir, f.name), 'utf8'))}
 catch { return null }
 })
 .filter((a)=> a !== null)
 .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
 } catch {
 return []
 }
}

const saveCustomAdapter = (adapter)=> {
 try {
 const dir = ensureCustomAdaptersDir()
 const filePath = join(dir, `${adapter.id}.json`)
 writeFileSync(filePath, JSON.stringify(adapter, null, 2), 'utf8')
 return { success: true, message: `适配器已保存：${adapter.name}`, filePath }
 } catch (err) {
 return { success: false, message: `保存适配器失败：${err instanceof Error ? err.message : String(err)}` }
 }
}

const deleteCustomAdapter = (id)=> {
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
const detectConfigFormat = (filePath)=> {
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
const generateColor = (str)=> {
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
const generateAdapterFromLudusavi = (steamAppId)=> {
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

 const nativeNames= {}
 const defaults= {}
 const supportedActions= []
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
 const foundKeys= []
 for (const line of lines) {
 const match = line.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=/)
 if (match) foundKeys.push(match[1])
 }
 // Map common patterns
 const keyMap= {
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

 const adapter= {
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



// ─── LoL watch state (preserved) ────────────────────────────────────────────

const lolWatchState= { startedAt: null, roots: [], events: [], watchers: [] }

// ─── Utilities ────────────────────────────────────────────────────────────────

const safelyReadJson = (filePath) => {
 try {
 return JSON.parse(readFileSync(filePath, 'utf8'))
 } catch {
 return null
 }
}

const expandEnvironmentReferences = (value) =>
 value.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? `%${name}%`)

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

const parseIni = (content)=> {
 let section = 'General'
 const entries= []
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

const readIni = (filePath) => parseIni(readFileSync(filePath, 'utf8'))

const findSetting = (entries, section, key) =>
 entries.find((entry) => entry.section.toLowerCase() === section.toLowerCase() && entry.key.toLowerCase() === key.toLowerCase())?.value ?? null

const timestamp = () => {
 const d = new Date()
 const pad = (n) => String(n).padStart(2, '0')
 return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** Create a timestamped backup of a file. Returns backup path or null on failure. */
const createBackup = (originalPath, gameId)=> {
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
const getSteamPath = ()=> {
 try {
 const output = execFileSync(
 'reg.exe',
 ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'],
 { encoding: 'utf8', windowsHide: true },
 )
 // Match: SteamPath REG_SZ c:/ruanjian/game/steam
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
const detectCs2 = ()=> {
 const steamPath = getSteamPath()
 if (!steamPath) {
 return { gameId: 'cs2', found: false, configPath: null, message: '未检测到 Steam 安装。' }
 }
 const userdataDir = join(steamPath, 'userdata')
 if (!existsSync(userdataDir)) {
 return { gameId: 'cs2', found: false, configPath: null, message: `Steam 已安装（${steamPath}），但未找到 userdata 目录。` }
 }
 // Find steamid directories and look for 730
 const candidates= []
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
const detectCf = ()=> {
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
const detectDontStarve = ()=> {
 const documentsPath = getWindowsDocumentsPath()
 const candidates= []
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

const detectGame = (gameId)=> {
 switch (gameId) {
 case 'cs2': return detectCs2()
 case 'cf': return detectCf()
 case 'dont-starve': return detectDontStarve()
 default:
 return { gameId, found: false, configPath: null, message: `不支持的游戏：${gameId}` }
 }
}

// ─── Data-driven game detection (uses JSON adapters) ────────────────────────


/** Load all game adapter JSON files from src/games/ */
const loadGameAdapters = ()=> {
 try {
 const gamesDir = join(join(__dirname, '..'), 'src', 'games')
 if (!existsSync(gamesDir)) return []
 const files = readdirSync(gamesDir, { withFileTypes: true })
 .filter((f) => f.isFile() && f.name.endsWith('.json'))
 .map((f) => join(gamesDir, f.name))
 return files
 .map((path) => {
 try { return JSON.parse(readFileSync(path, 'utf8'))}
 catch { return null }
 })
 .filter((g)=> g !== null)
 .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
 } catch {
 return []
 }
}

/** Generic path-scan detection: check installPaths + configRelativePath */
const detectByPathScan = (game)=> {
 const candidates= []
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
const detectByDocuments = (game)=> {
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


/** Find all Steam library folders by checking registry + common paths + libraryfolders.vdf */
const findSteamLibraries = ()=> {
 const libraries= []
 const seen = new Set()

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

 const addLibrary = (libPath) => {
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
const parseSteamManifest = (manifestPath, libraryPath)=> {
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
const scanAllSteamGames = ()=> {
 const libraries = findSteamLibraries()
 const allGames= []
 const seenAppIds = new Set()

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
// ─── UE4/UE5 auto-detection helper ────────────────────────────────────────────

/**
 * Scan %LOCALAPPDATA% for all directories containing Saved/Config/.../Input.ini.
 * Returns a map of directory name → Input.ini full path.
 */
const scanAllUe4Games = ()=> {
 const result = new Map()
 const localAppData = process.env.LOCALAPPDATA || join(process.env.USERPROFILE ?? 'C:\\Users\\Administrator', 'AppData', 'Local')
 try {
 const topDirs = readdirSync(localAppData, { withFileTypes: true })
 for (const d of topDirs) {
 if (!d.isDirectory()) continue
 const savedConfig = join(localAppData, d.name, 'Saved', 'Config')
 if (!existsSync(savedConfig)) continue
 try {
 const best = ue4g.pickInputIni(savedConfig)
 if (best) result.set(d.name.toLowerCase(), best)
 } catch { /* ignore */ }
 }
 } catch { /* ignore */ }
 return result
}

/**
 * Find UE4/UE5 Input.ini for a game.
 * Uses pre-scanned UE4 directory map, Ludusavi config data, and install directory.
 */
const findUe4InputIni = (installPath, gameName, steamAppId, ludusaviEntry, ue4Map)=> {
 // 1. Check Ludusavi data first — most reliable
 if (ludusaviEntry && ludusaviEntry.configFiles) {
 for (const cfg of ludusaviEntry.configFiles) {
 if (cfg.toLowerCase().includes('input.ini') && cfg.toLowerCase().includes('saved')) {
 const resolved = expandEnvironmentReferences(cfg)
 if (existsSync(resolved)) return resolved
 }
 }
 }

 // 2. Check pre-scanned UE4 directory map by name variations
 if (ue4Map && ue4Map.size > 0) {
 const candidates = [gameName]
 const cleanName = gameName.replace(/[^a-zA-Z0-9 ]/g, '').trim()
 if (cleanName) candidates.push(cleanName)
 const firstWord = cleanName.split(' ')[0]
 if (firstWord && firstWord !== cleanName) candidates.push(firstWord)
 // Also try removing common suffixes like "2", "II", "Remastered"
 const noSuffix = cleanName.replace(/\s*(2|ii|remastered|definitive edition|hd)$/i, '').trim()
 if (noSuffix && noSuffix !== cleanName) candidates.push(noSuffix)

 for (const name of candidates) {
 const key = name.toLowerCase()
 if (ue4Map.has(key)) return ue4Map.get(key)
 }
 }

 // 3. Check install directory: <install>/Saved/Config/<platform>/Input.ini
 if (installPath && existsSync(installPath)) {
 const savedConfig = join(installPath, 'Saved', 'Config')
 if (existsSync(savedConfig)) {
 try {
 const platforms = readdirSync(savedConfig, { withFileTypes: true })
 for (const p of platforms) {
 if (p.isDirectory()) {
 const iniPath = join(savedConfig, p.name, 'Input.ini')
 if (existsSync(iniPath)) return iniPath
 }
 }
 } catch { /* ignore */ }
 }
 }

 return null
}

const detectAllGames = ()=> {
 const ue4Map = scanAllUe4Games()
 const matchedUe4Dirs = new Set()
 const adapters = loadGameAdapters().filter((g) => !g.isEngineTemplate)
 const steamGames = scanAllSteamGames()
 const steamAppIdToGame = new Map(steamGames.map((g) => [g.appId, g]))
 const results= []
 let detected = 0

 // 1. Detect games that have adapters
 const detectedAdapterIds = new Set()
 for (const game of adapters) {
 let result
 let source

 // First try Steam match by appId
 if (game.steamAppId && steamAppIdToGame.has(game.steamAppId)) {
 const steamGame = steamAppIdToGame.get(game.steamAppId)
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

 // 2. Add Steam games that don't have adapters (show)
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
 let engineType = null
 let autoAdapter = false

 // ─── UE4/UE5 auto-detection: look for Saved/Config/*/Input.ini ───
 const installPath = join(steamGame.libraryPath, 'common', steamGame.installDir)
 let ue4InputIni = findUe4InputIni(installPath, steamGame.name, steamGame.appId, ludusaviEntry, ue4Map)
 let ue4Install = null
 // P0: detect UE from install dir (<Project>/Content/Paks) even when Input.ini doesn't exist yet
 try {
 const projects = ue4g.findUe4ProjectsInInstall(installPath)
 if (projects.length) {
 ue4Install = projects[0]
 if (!ue4InputIni) {
 const sc = join(process.env.LOCALAPPDATA || '', ue4Install.project, 'Saved', 'Config')
 ue4InputIni = ue4g.pickInputIni(sc) || join(ue4g.ue4ConfigDirs(ue4Install.project)[0], 'Input.ini')
 }
 }
 } catch { /* ignore */ }
 if (ue4InputIni) {
 // Record which UE4 directory was matched
 const localAppData = (process.env.LOCALAPPDATA || '').toLowerCase()
 if (ue4InputIni.toLowerCase().startsWith(localAppData)) {
 const rel = ue4InputIni.substring(localAppData.length).replace(/^[\\/]/, '')
 const dirName = rel.split(/[\\/]/)[0].toLowerCase()
 matchedUe4Dirs.add(dirName)
 }
 engineType = 'ue4'
 autoAdapter = true
 configPath = dirname(ue4InputIni)
 message = `已安装（Steam），自动检测为 UE4/UE5 引擎，可使用通用 Input.ini 适配器。`
 genre = 'UE4 自动适配'
 color = '#4A90D9'
 }

 if (hasLudusaviData && ludusaviEntry && !engineType) {
 // Try to resolve the first config file path to an actual directory
 const firstConfig = ludusaviEntry.configFiles[0]
 const resolvedPath = expandEnvironmentReferences(firstConfig)
 const configDir = dirname(resolvedPath)
 if (existsSync(configDir)) {
 configPath = configDir
 }
 message = `已安装（Steam），检测到配置文件（${ludusaviEntry.configFiles.length}个路径），可尝试通用写入。`
 genre = '可尝试通用写入'
 color = '#7a9ac0'
 }

 // ─── Unity engine detection ───
 if (!engineType) {
 const unityDll = join(installPath, `${steamGame.name}_Data`, 'Managed', 'UnityEngine.dll')
 const unityAlt = join(installPath, 'Battlerite_Data', 'Managed', 'UnityEngine.dll')
 if (existsSync(unityDll) || existsSync(unityAlt)) {
 engineType = 'unity'
 autoAdapter = true
 genre = 'Unity 可尝试'
 color = '#8a7ad0'
 message = `已安装（Steam），检测为 Unity 引擎游戏，可尝试通用配置写入。`

 // 1. Check AppData\Roaming\<GameName> (many Unity games store settings here, e.g. Battlerite)
 const roaming = process.env.APPDATA || (process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Roaming') : null)
 if (roaming) {
 const roamingCandidates = [
 join(roaming, steamGame.name),
 join(roaming, steamGame.name.replace(/[^a-zA-Z0-9]/g, '')),
 ]
 if (steamGame.installDir && steamGame.installDir !== steamGame.name) {
 roamingCandidates.push(join(roaming, steamGame.installDir))
 }
 for (const rc of roamingCandidates) {
 if (existsSync(rc)) {
 try {
 const cfgFiles = readdirSync(rc).filter((f) => /\.(json|ini|cfg|dat|xml)$/i.test(f))
 if (cfgFiles.length > 0) {
 configPath = rc
 const inputFile = cfgFiles.find((f) => /input|key|bind|control/i.test(f))
 message = `已安装（Steam），Unity 引擎，检测到配置目录：${rc}（${cfgFiles.length}个配置文件${inputFile ? `，键位文件：${inputFile}` : ''}），可读取和写入。`
 break
 }
 } catch { /* ignore */ }
 }
 }
 }

 // 2. Fallback: check AppData\LocalLow (standard Unity persistent data path)
 if (configPath === steamGame.libraryPath) {
 const localLow = process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'LocalLow') : null
 if (localLow && existsSync(localLow)) {
 try {
 const companies = readdirSync(localLow, { withFileTypes: true }).filter((d) => d.isDirectory())
 for (const company of companies) {
 const companyDir = join(localLow, company.name)
 try {
 const games = readdirSync(companyDir, { withFileTypes: true }).filter((d) => d.isDirectory())
 for (const g of games) {
 const gName = g.name.toLowerCase().replace(/[^a-z0-9]/g, '')
 const sName = steamGame.name.toLowerCase().replace(/[^a-z0-9]/g, '')
 if (gName === sName || (gName.length > 3 && gName.includes(sName)) || (sName.length > 3 && sName.includes(gName))) {
 const gameDir = join(companyDir, g.name)
 const cfgFiles = readdirSync(gameDir).filter((f) => /\.(json|ini|cfg|dat)$/i.test(f))
 if (cfgFiles.length > 0) {
 configPath = gameDir
 message = `已安装（Steam），Unity 引擎，检测到配置目录：${company.name}/${g.name}（${cfgFiles.length}个配置文件），可尝试通用写入。`
 break
 }
 }
 }
 } catch { /* ignore */ }
 if (engineType === 'unity' && configPath !== steamGame.libraryPath) break
 }
 } catch { /* ignore */ }
 }
 }
 }
 }

 // ─── Fallback: mark all installed games as "可尝试" instead of "不支持" ───
 if (!engineType && !hasLudusaviData) {
 genre = '可尝试通用写入'
 color = '#6a8a9a'
 message = `已安装（Steam），暂无专用适配器，可尝试通用配置写入。`
 }

 // Determine config file name based on engine type and detected config path
 let configFileName = 'settings.ini'
 if (engineType === 'ue4') {
 configFileName = 'Input.ini'
 } else if (engineType === 'unity' && configPath && configPath !== steamGame.libraryPath) {
 // Scan config directory for key-binding files
 try {
 const cfgFiles = readdirSync(configPath).filter((f) => /\.(json|ini|cfg|dat|xml)$/i.test(f))
 const inputFile = cfgFiles.find((f) => /input|key|bind|control|setting/i.test(f))
 if (inputFile) configFileName = inputFile
 else if (cfgFiles.length > 0) configFileName = cfgFiles[0]
 } catch { /* ignore */ }
 }

 results.push({
 gameId: engineType ? `${engineType}-${steamGame.appId}` : `steam-${steamGame.appId}`,
 name: steamGame.name,
 genre,
 color,
 found: true,
 configPath,
 configFileName,
 message,
 hasAdapter: true,
 autoAdapter,
 engineType,
 hasLudusaviData,
 ludusavi: ludusaviEntry ?? null,
 steamAppId: steamGame.appId,
 ue4Project: engineType === 'ue4' ? (ue4Install?.project ?? null) : null,
 installPath,
 source: 'steam',
 })
 detected++
 }

 // 3. Add unmatched UE4 directories (found in %LOCALAPPDATA% but not matched to a Steam game)
 for (const [dirName, iniPath] of ue4Map) {
 if (matchedUe4Dirs.has(dirName)) continue
 results.push({
 gameId: `ue4-local-${dirName}`,
 name: `UE4游戏 (${dirName})`,
 genre: 'UE4 自动适配',
 color: '#4A90D9',
 found: true,
 configPath: dirname(iniPath),
 message: `在 %LOCALAPPDATA% 检测到 UE4/UE5 游戏配置（${dirName}），可使用通用 Input.ini 适配器。`,
 hasAdapter: true,
 autoAdapter: true,
 engineType: 'ue4',
 hasLudusaviData: false,
 ludusavi: null,
 steamAppId: null,
 source: 'ue4-local',
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
const toLolKey = (normalized)=> {
 const k = normalized.trim()
 if (!k || k === '<Unbound>') return '[<Unbound>]'
 const mouseMap= {
 MOUSE1: '[Button 1]', MOUSE2: '[Button 2]', MOUSE3: '[Button 3]',
 MOUSE4: '[Button 4]', MOUSE5: '[Button 5]',
 }
 if (mouseMap[k]) return mouseMap[k]
 const specialMap= {
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
const parseLolSection = (configText, sectionName = 'GameEvents')=> {
 const result= {}
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
const toWasdEvent = (traditionalEvent)=> {
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
const updateIniSection = (content, sectionName, updates)=> {
 const lines = content.split(/\r?\n/)
 let inTargetSection = false
 let updated = 0
 let added = 0
 const remainingUpdates = new Map(Object.entries(updates))

 const newLines= []
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
 const newValue = remainingUpdates.get(key)
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
const findLcuApi = ()=> {
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
const lcuRequest = (port, auth, method, path, body)=> {
 return new Promise((resolve, reject) => {
 const options= {
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
const getLcuConnection = ()=> {
 const lcu = findLcuApi()
 if (!lcu) return null
 const auth = Buffer.from(`riot:${lcu.token}`).toString('base64')
 return { port: lcu.port, auth }
}

/** 获取当前游戏流程阶段：None, Lobby, Matchmaking, ReadyCheck, ChampSelect, InProgress, Reconnect, GameStart, WaitingForStats, EndOfGame */
const getGameflowPhase = async ()=> {
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
const quitGameViaLcu = async ()=> {
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
const waitForGameflowPhase = async (targetPhases, timeoutMs)=> {
 const startTime = Date.now()
 while (Date.now() - startTime < timeoutMs) {
 const phase = await getGameflowPhase()
 if (phase && targetPhases.includes(phase)) return phase
 await new Promise((r) => setTimeout(r, 1000))
 }
 return null
}

/** 开启训练模式（Practice Tool） */
const startPracticeToolViaLcu = async ()=> {
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
const restartGameToApplyConfig = async ()=> {
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
const writeLolViaLcuApi = async (req)=> {
 const lcu = findLcuApi()
 if (!lcu) return null

 const isWasdMode = req.modeId === 'wasd' || req.profileName.toLowerCase().includes('wasd')
 const auth = Buffer.from(`riot:${lcu.token}`).toString('base64')

 try {
 // Parse configText and build updates. WASD previews already contain
 // native WASD event names, while legacy previews may still use evt names.
 const targetSection = isWasdMode ? 'WASD' : 'GameEvents'
 const bindings = parseLolSection(req.configText, targetSection)
 const updates= {}
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

 // Also update input.ini locally (dual-write)
 let inputUpdated = false
 let backupPath
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
 const inputFile = (data.files ?? []).find((f) => f.name === 'Input.ini')
 if (inputFile?.sections) {
 let section = inputFile.sections.find((s) => s.name === targetSection)
 if (!section) {
 section = { name: targetSection, settings: [] }
 inputFile.sections.push(section)
 }
 if (!section.settings) section.settings = []
 for (const [event, value] of Object.entries(updates)) {
 const existing = section.settings.find((s) => s.name === event)
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
const isGameRunning = ()=> {
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
const writePersistedSettingsJson = (persistedPath, targetSectionName, updates)=> {
 const raw = readFileSync(persistedPath, 'utf8')
 const data = JSON.parse(raw)
 const inputFile = (data.files ?? []).find((f) => f.name === 'Input.ini')
 if (!inputFile) throw new Error('PersistedSettings.json 中未找到 Input.ini 文件节点')
 if (!inputFile.sections) inputFile.sections = []

 let targetSection = inputFile.sections.find((s) => s.name === targetSectionName)
 if (!targetSection) {
 targetSection = { name: targetSectionName, settings: [] }
 inputFile.sections.push(targetSection)
 }
 if (!targetSection.settings) targetSection.settings = []

 let updated = 0
 let added = 0
 for (const [event, lolValue] of Object.entries(updates)) {
 const existing = targetSection.settings.find((s) => s.name === event)
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
const writeLolPersistedSettings = async (req)=> {
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
 const updates= {}
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
 let inputBackup= null
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
const writeCiv6Config = (req)=> {
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
 const config = JSON.parse(raw)

 // Parse key=value pairs from configText
 const bindings= {}
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
const writeGameConfig = async (req)=> {
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

 // ─── Generic JSON config (Battlerite KMInput.json, etc.) ───
 // Read existing JSON, merge changes, write back. Preserves all other settings.
 const isJsonFile = req.configFormat === 'json' || (req.fileName && req.fileName.toLowerCase().endsWith('.json'))
 if (isJsonFile && req.gameId !== 'lol' && req.gameId !== 'civilization-vi') {
 try {
 // Prefer the path resolved by the read/detect request. Re-detect only when
 // the caller did not provide one, otherwise a second matching installation
 // can receive the write instead of the file the user just inspected.
 let configPath = req.configPath || null
 let configFileName = req.fileName || 'config.json'
 if (!configPath) {
 try {
 const allGames = detectAllGames()
 const found = allGames.games.find((g) => g.gameId === req.gameId)
 if (found && found.found && found.configPath) {
 configPath = found.configPath
 if (!req.fileName && found.configFileName) configFileName = found.configFileName
 }
 } catch { /* ignore */ }
 }
 if (!req.fileName) {
 try {
 const allGames = detectAllGames()
 const found = allGames.games.find((g) => g.gameId === req.gameId)
 if (found?.configFileName) configFileName = found.configFileName
 } catch { /* ignore */ }
 }
 // Fallback to detectGame
 if (!configPath) {
 const detection = detectGame(req.gameId)
 if (detection.found && detection.configPath) configPath = detection.configPath
 }
 if (!configPath) {
 return { success: false, message: '未找到游戏配置目录。', gameId: req.gameId }
 }
 const targetPath = join(configPath, configFileName)

 // Read existing JSON (or start fresh)
 let existing = {}
 if (existsSync(targetPath)) {
 try {
 existing = JSON.parse(readFileSync(targetPath, 'utf8'))
 } catch { existing = {} }
 }

 // Backup before writing
 let backupPath = null
 if (existsSync(targetPath)) {
 backupPath = createBackup(targetPath, req.gameId)
 }

 // Parse configText (format: nativeKey=presetValue, one per line)
 const changes = []
 for (const line of (req.configText || '').split('\n')) {
 const trimmed = line.trim()
 if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#')) continue
 const eq = trimmed.indexOf('=')
 if (eq > 0) {
 const nativeKey = trimmed.slice(0, eq).trim()
 const presetValue = trimmed.slice(eq + 1).trim()
 changes.push({ nativeKey, presetValue })
 }
 }

 // Convert normalized key to game-native format (Battlerite style: k.x / m.x / b.x)
 const toNativeKey = (normalized) => {
 if (!normalized) return ''
 const upper = normalized.toUpperCase()
 // Mouse keys
 if (upper === 'MOUSE1' || upper === 'MOUSE0' || upper === 'LEFTMOUSE') return 'm.1'
 if (upper === 'MOUSE2' || upper === 'RIGHTMOUSE') return 'm.2'
 if (upper === 'MOUSE3' || upper === 'MIDDLEMOUSE') return 'm.3'
 if (upper.startsWith('MOUSE')) {
 const num = upper.replace('MOUSE', '')
 if (num && !isNaN(parseInt(num))) return `m.${num}`
 }
 // Single letter keys - MUST BE UPPERCASE (Battlerite is case-sensitive: k.S not k.s)
 if (upper.length === 1 && /^[A-Z]$/.test(upper)) return `k.${upper}`
 // Other keys (space, tab, etc.) - keep as-is but lowercase
 return upper.toLowerCase()
 }

 // Apply changes to existing JSON (preserve all other keys)
 let changedCount = 0
 for (const { nativeKey, presetValue } of changes) {
 const nativeKeyFormatted = toNativeKey(presetValue)
 if (nativeKeyFormatted && nativeKey) {
 // Battlerite format: "ActionName": ["k.x"]
 // Preserve existing array if it has multiple keys, otherwise replace
 if (Array.isArray(existing[nativeKey])) {
 existing[nativeKey] = [nativeKeyFormatted, ...existing[nativeKey].slice(1)]
 } else {
 existing[nativeKey] = [nativeKeyFormatted]
 }
 changedCount++
 }
 }

 // Write back JSON (preserve all original keys + updated keys)
 if (!existsSync(dirname(targetPath))) {
 mkdirSync(dirname(targetPath), { recursive: true })
 }
 writeFileSync(targetPath, JSON.stringify(existing, null, 2), 'utf8')

 return {
 success: true,
 message: `已写入 ${configFileName}（JSON 格式，更新 ${changedCount} 个按键，保留其他设置）。${backupPath ? `原文件备份：${backupPath}。` : ''}`,
 gameId: req.gameId,
 writtenPath: targetPath,
 backupPath,
 changedCount,
 }
 } catch (err) {
 return {
 success: false,
 message: `JSON 写入失败：${err instanceof Error ? err.message : String(err)}`,
 gameId: req.gameId,
 }
 }
 }

 let detection = detectGame(req.gameId)
 if (!detection.found || !detection.configPath) {
 // Fallback: check auto-detected games (UE4 auto-adapter, etc.)
 try {
 const allGames = detectAllGames()
 const found = allGames.games.find((g) => g.gameId === req.gameId)
 if (found && found.found && found.configPath) {
 detection = { gameId: req.gameId, found: true, configPath: found.configPath, message: found.message }
 }
 } catch { /* ignore */ }
 }
 if (!detection.found || !detection.configPath) {
 return { success: false, message: detection.message || '未找到游戏配置目录。', gameId: req.gameId }
 }

 // ─── UE4/UE5 Input.ini: merge into existing file (never full-overwrite) ───
 const isUe4Write = req.configFormat === 'ue4-ini'
   || (req.fileName && /input\.ini$/i.test(req.fileName))
 if (isUe4Write) {
 const ue4FileName = req.fileName || 'Input.ini'
 const ue4Path = join(detection.configPath, ue4FileName)
 try {
 return writeUe4InputIniMerged(ue4Path, req.configText || '', req.gameId)
 } catch (err) {
 return {
 success: false,
 message: `UE4 Input.ini 合并写入失败：${err instanceof Error ? err.message : String(err)}`,
 gameId: req.gameId,
 }
 }
 }

 const targetPath = join(detection.configPath, req.fileName)
 let backupPath

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

const buildLolCandidates = ()=> {
 const candidates= []
 const seen = new Set()
 const addCandidate = (source, folder) => {
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
 for (const gameRoot of Object.keys(associated)) {
 const isLeagueInstall = gameRoot.toLowerCase().includes('league') || gameRoot.includes('英雄联盟')
 if (!isLeagueInstall) continue
 // 国际版: <root>/Config
 addCandidate('Riot 安装清单', join(resolve(gameRoot), 'Config'))
 // 国服/WeGame: <root>/Game/Config
 addCandidate('Riot 安装清单(Game)', join(resolve(gameRoot), 'Game', 'Config'))
 }
 }

 // WeGame 安装目录扫描 (D)
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
 ].filter((path)=> Boolean(path && existsSync(path)))
 return paths.filter((path, index) => paths.findIndex((candidate) => candidate.toLowerCase() === path.toLowerCase()) === index)
}

const clearLolSaveWatch = () => {
 for (const watcher of lolWatchState.watchers) watcher.close()
 lolWatchState.watchers = []
 lolWatchState.startedAt = null
}

const isRelevantLolWrite = (filePath) => {
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


/**
 * 解析 PersistedSettings.json 中的键位配置。
 * 文件结构: { files: [{ name: 'Input.ini', sections: [{ name, settings: [{name, value}] }] }] }
 */
const parsePersistedSettings = (filePath)=> {
 if (!existsSync(filePath)) return null
 try {
 const raw = readFileSync(filePath, 'utf-8')
 const data = JSON.parse(raw)
 const inputFile = (data.files ?? []).find((f) => f.name === 'Input.ini')
 if (!inputFile?.sections) return { traditional: [], wasd: [], quickbinds: {}, raw }

 const traditional= []
 const wasd= []
 const quickbinds= {}

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

// ─── Generic game config reader (UE4 Input.ini, etc.) ────────────────────────

/** Parse UE4/UE5 Input.ini AxisMappings and ActionMappings */
const parseUe4InputIni = (filePath) => {
 const entries = readIni(filePath)
 const axisMappings = []
 const actionMappings = []
 for (const entry of entries) {
 if (entry.key === 'AxisMappings') {
 // Parse: (AxisName="MoveForward",Scale=1.000000,Key=W)
 const val = entry.value.replace(/^\(|\)$/g, '')
 const parts = {}
 val.split(',').forEach((p) => {
 const eq = p.indexOf('=')
 if (eq > 0) {
 const k = p.slice(0, eq).trim()
 const v = p.slice(eq + 1).trim().replace(/^"|"$/g, '')
 parts[k] = v
 }
 })
 if (parts.AxisName && parts.Key) {
 axisMappings.push({ axis: parts.AxisName, scale: parseFloat(parts.Scale) || 1, key: parts.Key })
 }
 } else if (entry.key === 'ActionMappings') {
 const val = entry.value.replace(/^\(|\)$/g, '')
 const parts = {}
 val.split(',').forEach((p) => {
 const eq = p.indexOf('=')
 if (eq > 0) {
 const k = p.slice(0, eq).trim()
 const v = p.slice(eq + 1).trim().replace(/^"|"$/g, '')
 parts[k] = v
 }
 })
 if (parts.ActionName && parts.Key) {
 actionMappings.push({ action: parts.ActionName, key: parts.Key })
 }
 }
 }
 return { axisMappings, actionMappings }
}

/** Convert UE4 key name to normalized key format (W, SPACE, MOUSE1, etc.) */
const ue4KeyToNormalized = (ue4Key) => {
 const k = ue4Key.toLowerCase()
 if (k === 'leftmousebutton') return 'MOUSE1'
 if (k === 'rightmousebutton') return 'MOUSE2'
 if (k === 'middlemousebutton') return 'MOUSE3'
 if (k === 'spacebar') return 'SPACE'
 if (k === 'leftshift') return 'LSHIFT'
 if (k === 'rightshift') return 'RSHIFT'
 if (k === 'leftcontrol') return 'LCTRL'
 if (k === 'rightcontrol') return 'RCTRL'
 if (k === 'leftalt') return 'LALT'
 if (k === 'rightalt') return 'RALT'
 if (k === 'tab') return 'TAB'
 if (k === 'escape') return 'ESC'
 if (k === 'enter') return 'ENTER'
 if (k === 'backspace') return 'BACKSPACE'
 return ue4Key.toUpperCase()
}

/** Read game config and return normalized bindings. Supports UE4 Input.ini. */
const readGameConfig = (req) => {
 const gameId = req.gameId
 const configPath = req.configPath
 const fileName = req.fileName || 'Input.ini'

 // Try to find config path from detectAllGames if not provided
 let resolvedPath = configPath
 if (!resolvedPath) {
 try {
 const all = detectAllGames()
 const found = all.games.find((g) => g.gameId === gameId)
 if (found && found.configPath) resolvedPath = found.configPath
 } catch { /* ignore */ }
 }

 if (!resolvedPath) {
 return { success: false, message: '未找到游戏配置目录。', gameId }
 }

 const fullPath = join(resolvedPath, fileName)
 if (!existsSync(fullPath)) {
 return { success: false, message: `配置文件不存在：${fullPath}`, gameId, configPath: fullPath }
 }

 // Determine engine type from gameId prefix
 const isUe4 = gameId.startsWith('ue4-') || gameId.startsWith('ue4-local-')
 const engineType = isUe4 ? 'ue4' : (gameId.startsWith('unity-') ? 'unity' : (req.engineType || 'generic'))

 if (isUe4) {
 try {
 const parsed = parseUe4InputIni(fullPath)
 // Convert to normalized bindings: actionId -> key
 const bindings = {}
 // Axis mappings: forward/back -> same axis, left/right -> same axis
 const axisMap = {
 Axis_MoveForward: { positive: 'forward', negative: 'back' },
 Axis_MoveRight: { positive: 'right', negative: 'left' },
 MoveForward: { positive: 'forward', negative: 'back' },
 MoveRight: { positive: 'right', negative: 'left' },
 }
 for (const am of parsed.axisMappings) {
 const mapping = axisMap[am.axis]
 if (mapping) {
 const actionId = am.scale > 0 ? mapping.positive : mapping.negative
 bindings[actionId] = ue4KeyToNormalized(am.key)
 }
 }
 // Action mappings
 const actionMap = {
 Action_Jump: 'jump', Jump: 'jump',
 Action_Interact: 'interact', Interact: 'interact',
 Action_Sprint: 'sprint', Sprint: 'sprint',
 Action_Crouch: 'crouch', Crouch: 'crouch',
 Action_Attack: 'primary', Attack: 'primary',
 Action_Aim: 'secondary', Aim: 'secondary',
 Action_Reload: 'ability3', Reload: 'ability3',
 Action_Map: 'map', Map: 'map',
 }
 for (const am of parsed.actionMappings) {
 const actionId = actionMap[am.action]
 if (actionId && !bindings[actionId]) {
 bindings[actionId] = ue4KeyToNormalized(am.key)
 }
 }
 return {
 success: true,
 message: `已读取 UE4 Input.ini（${parsed.axisMappings.length} 个轴映射，${parsed.actionMappings.length} 个动作映射）。`,
 gameId,
 configPath: fullPath,
 engineType: 'ue4',
 bindings,
 raw: { axisMappings: parsed.axisMappings.slice(0, 50), actionMappings: parsed.actionMappings.slice(0, 50) },
 }
 } catch (e) {
 return { success: false, message: `解析 UE4 Input.ini 失败：${e.message}`, gameId, configPath: fullPath }
 }
 }

 // ─── JSON format (Battlerite KMInput.json, etc.) ───
 if (fileName.toLowerCase().endsWith('.json')) {
 try {
 const content = readFileSync(fullPath, 'utf8')
 const parsed = JSON.parse(content)
 const bindings = {}
 let keyCount = 0

 // Battlerite format: "Move.X.Neg": ["k.S"], "Move.Y.Pos": ["k.E"], etc.
 const battleriteMap = {
 'Move.X.Neg': 'left',
 'Move.X.Pos': 'right',
 'Move.Y.Neg': 'back',
 'Move.Y.Pos': 'forward',
 'Camera.Move.X.Neg': 'camera_left',
 'Camera.Move.X.Pos': 'camera_right',
 'Camera.Move.Y.Neg': 'camera_back',
 'Camera.Move.Y.Pos': 'camera_forward',
 }
 const battleriteKeyMap = {
 'Ability1': 'ability1',
 'Ability2': 'ability2',
 'Ability3': 'ability3',
 'Ability4': 'ultimate',
 'Ability5': 'ability5',
 'Ability6': 'ability6',
 'Ability7': 'ability7',
 'EX.Modifier': 'ex_modifier',
 'Jump': 'jump',
 'Sprint': 'sprint',
 'Interact': 'interact',
 'UI.Misc': 'ui_misc',
 }

 for (const [action, keys] of Object.entries(parsed)) {
 if (!Array.isArray(keys) || keys.length === 0) continue
 const rawKey = keys[0]
 let normalizedKey = rawKey
 // Battlerite key format: "k.X" = keyboard, "m.X" = mouse, "b.X" = mouse button
 if (typeof rawKey === 'string') {
 if (rawKey.startsWith('k.')) {
 normalizedKey = rawKey.slice(2).toUpperCase()
 } else if (rawKey.startsWith('m.')) {
 const btnNum = rawKey.slice(2)
 normalizedKey = btnNum === '1' ? 'MOUSE1' : btnNum === '2' ? 'MOUSE2' : btnNum === '3' ? 'MOUSE3' : `MOUSE${btnNum}`
 } else if (rawKey.startsWith('b.')) {
 const btnNum = rawKey.slice(2)
 normalizedKey = btnNum === '1' ? 'MOUSE1' : btnNum === '2' ? 'MOUSE2' : btnNum === '3' ? 'MOUSE3' : `MOUSE${btnNum}`
 }
 }

 const actionId = battleriteMap[action] || battleriteKeyMap[action]
 if (actionId) {
 bindings[actionId] = normalizedKey
 keyCount++
 } else if (action.startsWith('Ability') || action.startsWith('Move') || action.startsWith('Camera')) {
 // Store unknown but relevant actions with original name
 bindings[action.toLowerCase().replace(/\./g, '_')] = normalizedKey
 keyCount++
 }
 }

 if (keyCount > 0) {
 // Build nativeNames map: normalized action id -> native action name
 // (GameDefinition.nativeNames expects normalized -> native, not native -> normalized)
 const nativeToNormalized = { ...battleriteMap, ...battleriteKeyMap }
 const nativeNames = {}
 for (const [native, normalized] of Object.entries(nativeToNormalized)) {
 nativeNames[normalized] = native
 }
 return {
 success: true,
 message: `已读取 JSON 键位配置（${keyCount} 个按键映射）。`,
 gameId,
 configPath: fullPath,
 engineType: engineType || 'json',
 bindings,
 nativeNames,
 raw: parsed,
 }
 }
 // If no key bindings found, fall through to generic
 } catch (e) {
 // Not valid JSON or parse error, fall through to generic
 }
 }

 // Generic: just return file content for other formats
 try {
 const content = readFileSync(fullPath, 'utf8')
 return {
 success: true,
 message: `已读取配置文件（${content.length} 字节）。`,
 gameId,
 configPath: fullPath,
 engineType: 'generic',
 bindings: {},
 rawContent: content.slice(0, 5000),
 }
 } catch (e) {
 return { success: false, message: `读取配置文件失败：${e.message}`, gameId, configPath: fullPath }
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
// Presets are stored
// Once saved, a preset can be applied to ANY game without re-reading the source.

const getPresetsDir = ()=> {
 const documentsPath = getWindowsDocumentsPath()
 const base = documentsPath ?? (process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Documents') : process.cwd())
 return join(base, 'Keyforge', 'presets')
}

const ensurePresetsDir = ()=> {
 const dir = getPresetsDir()
 if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
 return dir
}

const sanitizePresetId = (id)=> {
 return id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)
}

const listLocalPresets = () => {
 const dir = getPresetsDir()
 const presets= []

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

const saveLocalPreset = (preset)=> {
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

const loadLocalPreset = (id)=> {
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

const deleteLocalPreset = (id)=> {
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

// ─── Generic ESDF migration (read-modify-write, format-aware) ─────────────────
//
// Core idea for "most games": do NOT guess action names. Read the actual
// config, shift only the KEY VALUES that live in the QAZ keyboard block,
// write the same structure back. This covers default WASD → ESDF for any
// game whose config we can parse, without needing a per-game adapter.

// Full-row right shift (see ue4-generic.cjs). Q/A/Z become empty;
// P/L/M overflow to punctuation, which generic formats skip (reported as warning).
const ESDF_SHIFT_MAP = ue4g.LETTER_SHIFT

/** Shift a single key token if it is a shiftable letter; otherwise return null. */
const shiftKeyToken = (raw) => {
  if (raw == null) return null
  const token = String(raw).trim()
  if (!token) return null
  const lower = token.toLowerCase()
  if (lower in ESDF_SHIFT_MAP) {
    const t = ESDF_SHIFT_MAP[lower]
    return /^[a-z]$/.test(t) ? t : null
  }
  return null
}

/** Detect config format from filename + content (for ESDF migration). */
const detectMigrationFormat = (fileName, content) => {
  const name = (fileName || '').toLowerCase()
  if (name.endsWith('.json')) return 'json'
  if (name.endsWith('.ini') || name === 'input.ini') {
    if (content.includes('AxisMappings=') || content.includes('ActionMappings=') || content.includes('/Script/Engine.InputSettings')) {
      return 'ue4-ini'
    }
    return 'ini'
  }
  if (name.endsWith('.cfg') || name.endsWith('.txt')) {
    if (/\bbind\s+["']/i.test(content)) return 'source-cfg'
    if (content.includes('=') && !content.includes('{')) return 'ini'
    return 'source-cfg'
  }
  if (content.trimStart().startsWith('{')) return 'json'
  if (content.includes('AxisMappings=') || content.includes('ActionMappings=')) return 'ue4-ini'
  if (/\bbind\s+["']/i.test(content)) return 'source-cfg'
  return 'ini'
}

/**
 * UE4 key-name table (both directions). Only letter keys need shifting;
 * special keys stay put.
 */
const shiftUe4KeyName = (keyName) => ue4g.shiftUe4Key(keyName)

/** Migrate UE4 Input.ini: rewrite Key= tokens inside Axis/ActionMappings. */
const migrateUe4InputIni = (content) => {
  let changedCount = 0
  const changes = []
  // Match Key=Something inside mapping tuples
  const next = content.replace(
    /(AxisMappings|ActionMappings)=\(([^)]*)\)/g,
    (full, kind, inner) => {
      const keyMatch = inner.match(/Key=([^,)]+)/)
      if (!keyMatch) return full
      const oldKey = keyMatch[1].trim().replace(/^"|"$/g, '')
      const newKey = shiftUe4KeyName(oldKey)
      if (!newKey || newKey === oldKey) return full
      changedCount++
      changes.push(`${oldKey} → ${newKey}`)
      const replacedInner = inner.replace(/Key=[^,)]+/, `Key=${newKey}`)
      return `${kind}=(${replacedInner})`
    },
  )
  return { content: next, changedCount, changes, format: 'ue4-ini' }
}

/**
 * Generic JSON key migration.
 * Handles:
 *   "Move.Y.Pos": ["k.W"]          → ["k.E"]
 *   "Move.Y.Pos": ["W"]            → ["E"]
 *   "Jump": "Space"                → unchanged
 *   "Forward": "w"                 → "e"
 *   nested objects with key/Key fields
 */
const migrateJsonKeys = (content) => {
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (e) {
    return { success: false, message: `JSON 解析失败：${e.message}` }
  }

  let changedCount = 0
  const changes = []

  const migrateKeyString = (raw) => {
    if (typeof raw !== 'string') return null
    // Battlerite / Unity style: k.W / m.1 / b.2
    if (/^[kmb]\./i.test(raw)) {
      const prefix = raw.slice(0, 2)
      const rest = raw.slice(2)
      const shifted = shiftKeyToken(rest)
      if (!shifted) return null
      // Keep letter case upper for k.X (Battlerite is case-sensitive)
      const nextRest = prefix[0].toLowerCase() === 'k' && shifted.length === 1
        ? shifted.toUpperCase()
        : shifted
      return prefix + nextRest
    }
    // Plain letter / word key
    const shifted = shiftKeyToken(raw)
    if (!shifted) return null
    // Preserve original casing style (upper stays upper)
    if (raw === raw.toUpperCase() && raw.length === 1) return shifted.toUpperCase()
    return shifted
  }

  const walk = (node) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (typeof node[i] === 'string') {
          const next = migrateKeyString(node[i])
          if (next) {
            changes.push(`${node[i]} → ${next}`)
            node[i] = next
            changedCount++
          }
        } else if (node[i] && typeof node[i] === 'object') {
          walk(node[i])
        }
      }
      return
    }
    if (!node || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string') {
        // Only migrate values that look like key tokens, and skip non-key fields
        const skipFields = /^(name|id|type|description|label|path|url|version)$/i
        if (skipFields.test(key)) continue
        // Heuristic: single letter or known key-like tokens, or k.x style
        const looksLikeKey = /^[A-Za-z]$/.test(value.trim())
          || /^[kmb]\./i.test(value.trim())
          || /^(space|tab|esc|escape|enter|shift|ctrl|control|alt|caps|backspace)$/i.test(value.trim())
        if (!looksLikeKey) continue
        const next = migrateKeyString(value)
        if (next && next !== value) {
          changes.push(`${key}: ${value} → ${next}`)
          node[key] = next
          changedCount++
        }
      } else if (Array.isArray(value)) {
        walk(value)
      } else if (value && typeof value === 'object') {
        // Common wrappers: { key: "W" }, { Key: "W" }, { data: "W" }
        const keyField = ['key', 'Key', 'data', 'binding', 'button'].find((f) => typeof value[f] === 'string')
        if (keyField) {
          const next = migrateKeyString(value[keyField])
          if (next) {
            changes.push(`${key}.${keyField}: ${value[keyField]} → ${next}`)
            value[keyField] = next
            changedCount++
          }
        }
        walk(value)
      }
    }
  }

  walk(parsed)
  const nextContent = JSON.stringify(parsed, null, 2)
  return { success: true, content: nextContent, changedCount, changes, format: 'json' }
}

/**
 * Generic INI migration.
 * Handles:  Forward=W   /   MoveForward = w   /   [controls]\nmove_up = W
 * Does NOT touch keys that look like paths, numbers, or booleans.
 */
const migrateIniKeys = (content) => {
  let changedCount = 0
  const changes = []
  const lines = content.split(/\r?\n/)
  const nextLines = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) return line
    const eq = trimmed.indexOf('=')
    if (eq <= 0) return line
    const left = trimmed.slice(0, eq)
    const right = trimmed.slice(eq + 1).trim()
    // Only migrate pure-letter values (case-insensitive) that are in the shift map
    if (!/^[A-Za-z]$/.test(right)) return line
    const shifted = shiftKeyToken(right)
    if (!shifted) return line
    const nextVal = right === right.toUpperCase() ? shifted.toUpperCase() : shifted
    if (nextVal === right) return line
    changedCount++
    changes.push(`${left.trim()}: ${right} → ${nextVal}`)
    // Preserve original indentation and spacing around '='
    const indent = line.match(/^\s*/)[0]
    const mid = line.slice(indent.length, indent.length + left.length + (line.includes(' = ') ? 3 : 1))
    // Simpler: rebuild as `left=nextVal` keeping indent
    const sep = line.includes(' = ') ? ' = ' : '='
    return `${indent}${left.trim()}${sep}${nextVal}`
  })
  return { success: true, content: nextLines.join('\n'), changedCount, changes, format: 'ini' }
}

/**
 * Source-engine CFG migration.
 * Handles:  bind "w" "+forward"  /  bind "W" "+forward"
 */
const migrateSourceCfg = (content) => {
  let changedCount = 0
  const changes = []
  const next = content.replace(
    /(\bbind(?:toggle)?\s+)(["']?)([A-Za-z])\2(\s+)/gi,
    (full, cmd, quote, key, space) => {
      const shifted = shiftKeyToken(key)
      if (!shifted) return full
      changedCount++
      changes.push(`${key} → ${shifted}`)
      // Source binds are lowercase by convention
      return `${cmd}${quote}${shifted}${quote || ''}${space}`
    },
  )
  return { success: true, content: next, changedCount, changes, format: 'source-cfg' }
}

/**
 * Keybind knowledge base (curated from PCGamingWiki / Ludusavi / community).
 * Used as a fallback path resolver when Steam/Ludusavi detection is too coarse.
 */
const loadKeybindKnowledge = () => {
  try {
    const p = join(join(__dirname, '..'), 'src', 'data', 'keybind-knowledge.json')
    if (!existsSync(p)) return { version: '0', games: [], engineDefaults: [], sources: [] }
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    return { version: '0', games: [], engineDefaults: [], sources: [] }
  }
}
const keybindKnowledge = loadKeybindKnowledge()

const expandKnowledgePath = (template) => {
  if (!template) return null
  let p = String(template)
  const envMap = {
    '%USERPROFILE%': process.env.USERPROFILE || '',
    '%LOCALAPPDATA%': process.env.LOCALAPPDATA || '',
    '%APPDATA%': process.env.APPDATA || '',
    '%PROGRAMFILES(X86)%': process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)',
    '%PROGRAMFILES%': process.env.PROGRAMFILES || 'C:\\Program Files',
  }
  for (const [k, v] of Object.entries(envMap)) {
    p = p.split(k).join(v)
  }
  p = p.replace(/\//g, '\\')
  return p
}

/**
 * Try to locate a real keybind/config file from the knowledge base for a game name or appId.
 * Returns { configPath, configFileName, knowledge } or null.
 */
const findKeybindFromKnowledge = (gameId, gameName, steamAppId) => {
  const knowledge = keybindKnowledge
  if (!knowledge?.games?.length) return null

  const nameLower = (gameName || '').toLowerCase()
  const idLower = (gameId || '').toLowerCase()
  const candidates = knowledge.games.filter((g) => {
    if (steamAppId && g.steamAppId === String(steamAppId)) return true
    if (g.name && nameLower && g.name.toLowerCase() === nameLower) return true
    if (g.name && nameLower && (nameLower.includes(g.name.toLowerCase()) || g.name.toLowerCase().includes(nameLower))) return true
    if (idLower && g.steamAppId && idLower.includes(String(g.steamAppId))) return true
    return false
  })

  for (const g of candidates) {
    for (const template of g.paths || []) {
      const expanded = expandKnowledgePath(template)
      if (!expanded) continue
      // Path may be a directory or a file
      if (existsSync(expanded)) {
        try {
          const st = require('node:fs').statSync(expanded)
          if (st.isFile()) {
            return {
              configPath: dirname(expanded),
              configFileName: basename(expanded),
              knowledge: g,
            }
          }
          // Directory: look for keybind-like files
          const files = readdirSync(expanded).filter((f) => /\.(json|ini|cfg|xml|txt|lsx|sii)$/i.test(f))
          const pick = files.find((f) => /input|key|bind|control|setting|config|cvars|KMInput/i.test(f))
            || files.find((f) => /config|setting/i.test(f))
            || files[0]
          if (pick) {
            return {
              configPath: expanded,
              configFileName: pick,
              knowledge: g,
            }
          }
        } catch { /* ignore */ }
      }
      // Parent dir if file path missing
      const parent = dirname(expanded)
      if (existsSync(parent) && parent !== expanded) {
        try {
          const files = readdirSync(parent).filter((f) => /\.(json|ini|cfg|xml|txt)$/i.test(f))
          const base = basename(expanded)
          const hit = files.find((f) => f.toLowerCase() === base.toLowerCase())
            || files.find((f) => /input|key|bind|control|setting/i.test(f))
          if (hit) {
            return {
              configPath: parent,
              configFileName: hit,
              knowledge: g,
            }
          }
        } catch { /* ignore */ }
      }
    }
  }
  return null
}

/**
 * Resolve config file path for a gameId (shared by migrate / custom apply).
 */
const resolveConfigTarget = (req) => {
  let configPath = req.configPath || null
  let configFileName = req.fileName || null
  let knowledgeHit = null
  let foundGame = null

  if (!configPath || !configFileName) {
    try {
      const allGames = detectAllGames()
      const found = allGames.games.find((g) => g.gameId === req.gameId)
      foundGame = found || null
      if (found && found.found && found.configPath) {
        if (!configPath) configPath = found.configPath
        if (!configFileName && found.configFileName) configFileName = found.configFileName
        // Still try knowledge base for a more precise keybind file
        if (!knowledgeHit) {
          knowledgeHit = findKeybindFromKnowledge(req.gameId, found.name, found.steamAppId)
        }
      }
    } catch { /* ignore */ }
  }
  // Fallback: knowledge base by name/appId only
  if (!configPath || !configFileName) {
    if (!knowledgeHit) {
      knowledgeHit = findKeybindFromKnowledge(req.gameId, req.gameName, req.steamAppId)
    }
    if (knowledgeHit) {
      if (!configPath) configPath = knowledgeHit.configPath
      if (!configFileName) configFileName = knowledgeHit.configFileName
    }
  }
  if (!configPath) {
    const detection = detectGame(req.gameId)
    if (detection.found && detection.configPath) configPath = detection.configPath
  }
  if (!configPath) return { success: false, message: '未找到游戏配置目录。' }
  if (!configFileName) configFileName = 'settings.ini'

  // If configPath already points at a file, use it directly
  if (existsSync(configPath) && !require('node:fs').statSync(configPath).isDirectory()) {
    return { success: true, filePath: configPath, configPath: dirname(configPath), configFileName: basename(configPath) }
  }

  const filePath = join(configPath, configFileName)
  const ue4 = configFileName.toLowerCase() === 'input.ini'
    ? { project: req.ue4Project || foundGame?.ue4Project || null, installPath: req.installPath || foundGame?.installPath || null }
    : null
  if (!existsSync(filePath)) {
    // UE: a missing Saved/.../Input.ini is normal (defaults live in the pak) — we create it.
    if (ue4) return { success: true, filePath, configPath, configFileName, missing: true, ue4 }
    // No more guessing an arbitrary json/ini/cfg here: that used to hit unrelated settings files.
    return { success: false, message: `未找到键位配置文件：${filePath}`, status: 'not-found' }
  }
  return { success: true, filePath, configPath, configFileName, ue4 }
}

/**
 * Detect whether the config already looks like WASD or ESDF movement.
 * Returns 'wasd' | 'esdf' | 'unknown'.
 */
const detectMovementLayout = (content, format) => {
  if (format === 'ue4-ini') {
    const hasW = /AxisMappings=\([^)]*Key=W[,)]/.test(content)
    const hasE = /AxisMappings=\([^)]*Key=E[,)]/.test(content)
    const hasA = /AxisMappings=\([^)]*Key=A[,)]/.test(content)
    const hasD = /AxisMappings=\([^)]*Key=D[,)]/.test(content)
    const hasF = /AxisMappings=\([^)]*Key=F[,)]/.test(content)
    // WASD: W and A present as axis keys
    if (hasW && hasA && !hasF) return 'wasd'
    // ESDF: E and S/D/F pattern, W not used as axis (or only as ability)
    if (hasE && hasF && !hasW) return 'esdf'
    if (hasE && hasF && hasW) return 'unknown'
    if (hasW && hasA) return 'wasd'
    if (hasE && hasF) return 'esdf'
    return 'unknown'
  }
  if (format === 'json') {
    // Battlerite-style: look at movement action keys
    let parsed
    try { parsed = JSON.parse(content) } catch { return 'unknown' }
    const getK = (action) => {
      const v = parsed[action]
      if (Array.isArray(v) && typeof v[0] === 'string') {
        const raw = v[0]
        if (raw.startsWith('k.')) return raw.slice(2).toUpperCase()
        if (raw.length === 1) return raw.toUpperCase()
      }
      return null
    }
    const fwd = getK('Move.Y.Pos') || getK('forward') || getK('MoveForward') || getK('move_up')
    const left = getK('Move.X.Neg') || getK('left') || getK('MoveRight') || getK('move_left')
    if (fwd === 'W' && (left === 'A' || left === null)) return 'wasd'
    if (fwd === 'E' && (left === 'S' || left === null)) return 'esdf'
    return 'unknown'
  }
  if (format === 'source-cfg') {
    const hasWForward = /bind\s+["']?w["']?\s+["']?\+forward/i.test(content)
    const hasEForward = /bind\s+["']?e["']?\s+["']?\+forward/i.test(content)
    if (hasWForward && !hasEForward) return 'wasd'
    if (hasEForward && !hasWForward) return 'esdf'
    return 'unknown'
  }
  // Generic INI
  const hasWWasMove = /^\s*(move_?up|forward|moveforward)\s*=\s*w\s*$/im.test(content)
  const hasEAsMove = /^\s*(move_?up|forward|moveforward)\s*=\s*e\s*$/im.test(content)
  if (hasWWasMove && !hasEAsMove) return 'wasd'
  if (hasEAsMove && !hasWWasMove) return 'esdf'
  return 'unknown'
}

/**
 * One-click ESDF migration for any parseable game config.
 * Reads existing file → shifts letter keys → writes back (with backup).
 *
 * req: { gameId, configPath?, fileName?, mode?: 'esdf', customKeys?: Record<string,string>, force?: boolean }
 *
 * When customKeys is provided, those action→key assignments are applied
 * AFTER the ESDF shift for matching native action names found in the file.
 * Set force=true to skip the "already ESDF" safety check.
 */

// ─── P0 helpers: encoding-aware read, UE override planning, verified write ───
const readConfigText = (filePath, missing) => {
  if (missing || !existsSync(filePath)) return { text: '', encoding: 'utf8', bom: false, existed: false }
  const buf = readFileSync(filePath)
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return { text: buf.slice(2).toString('utf16le'), encoding: 'utf16le', bom: true, existed: true }
  }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'utf8', bom: true, existed: true }
  }
  return { text: buf.toString('utf8'), encoding: 'utf8', bom: false, existed: true }
}

const encodeConfigText = (text, enc) => {
  if (enc.encoding === 'utf16le') return Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')])
  return Buffer.from((enc.bom ? '\uFEFF' : '') + text, 'utf8')
}

const UE4_OVERRIDE_MARKER = '; MousKey ESDF override'

/** Get default UE input mappings: pak DefaultInput.ini if readable, else template. */
const getUe4Defaults = (ue4) => {
  if (ue4 && ue4.installPath && ue4.project) {
    try {
      const proj = ue4g.findUe4ProjectsInInstall(ue4.installPath).find((p) => p.project.toLowerCase() === ue4.project.toLowerCase())
      const fromPak = proj ? ue4g.readDefaultInputFromPak(proj) : null
      if (fromPak) return { text: fromPak.text, source: fromPak.source }
    } catch { /* ignore */ }
  }
  return { text: ue4g.TEMPLATE_DEFAULT_INPUT, source: 'template' }
}

/**
 * UE Input.ini without explicit mappings (empty / defaults in pak): generate
 * -/+ override entries. Returns null when not applicable.
 */
const planUe4Override = (content, resolved) => {
  if (!resolved.ue4 && (resolved.configFileName || '').toLowerCase() !== 'input.ini') return null
  if (content.includes(UE4_OVERRIDE_MARKER)) {
    return { skipped: true, result: { success: true, content, changedCount: 0, changes: [], format: 'ue4-override' } }
  }
  const defaults = getUe4Defaults(resolved.ue4)
  const r = ue4g.buildUe4Override(content, defaults.text)
  // Targets: the resolved file plus the sibling Windows/WindowsNoEditor dir when unsure
  const targets = [resolved.filePath]
  const savedConfig = dirname(dirname(resolved.filePath))
  const platform = basename(dirname(resolved.filePath))
  if (/^windows(noeditor)?$/i.test(platform)) {
    const sibling = join(savedConfig, /noeditor/i.test(platform) ? 'Windows' : 'WindowsNoEditor', 'Input.ini')
    const siblingDirExists = existsSync(dirname(sibling))
    const selfDirExists = existsSync(dirname(resolved.filePath))
    if (siblingDirExists === selfDirExists) targets.push(sibling)
  }
  return {
    skipped: false,
    defaultsSource: defaults.source,
    targets,
    result: { success: true, content: r.content, changedCount: r.changedCount, changes: r.changes, added: r.added, format: 'ue4-override' },
  }
}

/** Write, then re-read and verify. For UE overrides, checks every + line is present. */
const writeAndVerify = (filePath, text, enc, expectLines) => {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, encodeConfigText(text, enc))
  const back = readConfigText(filePath, false).text
  if (expectLines && expectLines.length) {
    const missingLines = expectLines.filter((l) => l.startsWith('+') && !back.includes(l))
    return { verified: missingLines.length === 0, missingLines }
  }
  return { verified: back === text, missingLines: [] }
}

const migrateEsdfConfig = (req) => {
  const resolved = resolveConfigTarget(req)
  if (!resolved.success) {
    return { success: false, message: resolved.message, gameId: req.gameId }
  }

  const { filePath, configFileName } = resolved
  let content
  let enc
  try {
    enc = readConfigText(filePath, resolved.missing)
    content = enc.text
  } catch (e) {
    return { success: false, message: `读取配置失败：${e.message}`, gameId: req.gameId, configPath: filePath }
  }

  let format = detectMigrationFormat(configFileName, content)
  if (content.includes(UE4_OVERRIDE_MARKER)) {
    return { success: true, message: `${configFileName} 已含 MousKey 覆盖条目，跳过以免二次右移。`, gameId: req.gameId, configPath: filePath, format: 'ue4-override', changedCount: 0, changes: [], skipped: true }
  }

  // Safety: if already ESDF, do not double-shift (E→R, S→D, D→F, F→G would break layout)
  if (!req.force) {
    const layout = detectMovementLayout(content, format)
    if (layout === 'esdf') {
      return {
        success: true,
        message: `${configFileName} 已检测为 ESDF 布局，跳过迁移以免二次右移。如需强制重写请使用自定义写入。`,
        gameId: req.gameId,
        configPath: filePath,
        format,
        layout,
        changedCount: 0,
        changes: [],
        skipped: true,
      }
    }
  }

  let result
  switch (format) {
    case 'ue4-ini':
      result = migrateUe4InputIni(content)
      break
    case 'json':
      result = migrateJsonKeys(content)
      break
    case 'source-cfg':
      result = migrateSourceCfg(content)
      break
    case 'ini':
    default:
      result = migrateIniKeys(content)
      break
  }

  if (!result || result.success === false) {
    return {
      success: false,
      message: result?.message || `无法解析配置格式（${format}）`,
      gameId: req.gameId,
      configPath: filePath,
      format,
    }
  }

  // P0: UE Input.ini with no explicit mappings → generate -/+ overrides
  let ue4Plan = null
  if ((format === 'ue4-ini' || format === 'ini') && result.changedCount === 0) {
    ue4Plan = planUe4Override(content, resolved)
    if (ue4Plan) {
      if (ue4Plan.skipped) {
        return { success: true, message: `${configFileName} 已含 MousKey 覆盖条目，跳过。`, gameId: req.gameId, configPath: filePath, format: 'ue4-override', changedCount: 0, changes: [], skipped: true }
      }
      result = ue4Plan.result
      format = 'ue4-override'
    }
  }

  // Optional: apply custom action→key overrides on top of the shifted file
  let customApplied = 0
  let nextContent = result.content
  if (req.customKeys && typeof req.customKeys === 'object' && Object.keys(req.customKeys).length > 0) {
    const customResult = applyCustomKeysToContent(nextContent, format, req.customKeys)
    if (customResult.success) {
      nextContent = customResult.content
      customApplied = customResult.appliedCount
      result.changes.push(...customResult.changes)
    }
  }

  if (result.changedCount === 0 && customApplied === 0) {
    return {
      success: true,
      message: `已读取 ${configFileName}（格式：${format}），但未发现可右移的字母键。可能已是 ESDF 布局，或配置中没有 WASD 类字母绑定。`,
      gameId: req.gameId,
      configPath: filePath,
      format,
      changedCount: 0,
      changes: [],
    }
  }

  const backupPath = enc.existed ? createBackup(filePath, req.gameId || 'esdf') : null
  let verification
  const extraWritten = []
  try {
    verification = writeAndVerify(filePath, nextContent, enc, result.added)
    // UE: also write the sibling platform dir when we can't tell which one the game uses
    if (ue4Plan && ue4Plan.targets) {
      for (const t of ue4Plan.targets.slice(1)) {
        const tEnc = readConfigText(t, false)
        if (tEnc.existed) createBackup(t, req.gameId || 'esdf')
        const tPlan = ue4g.buildUe4Override(tEnc.text, getUe4Defaults(resolved.ue4).text)
        if (tPlan.changedCount === 0) continue
        const v = writeAndVerify(t, tPlan.content, tEnc, tPlan.added)
        extraWritten.push({ path: t, verified: v.verified })
      }
    }
  } catch (e) {
    return {
      success: false,
      message: `写入失败：${e.message}`,
      gameId: req.gameId,
      configPath: filePath,
      format,
    }
  }

  const parts = []
  if (result.changedCount > 0) parts.push(`ESDF 右移 ${result.changedCount} 个键`)
  if (customApplied > 0) parts.push(`自定义覆盖 ${customApplied} 项`)
  return {
    success: true,
    message: `已对 ${configFileName} 完成 ESDF 迁移（${parts.join('，')}，格式：${format}）。${backupPath ? `原文件备份：${backupPath}。` : ''}${verification && !verification.verified ? '⚠ 回读校验失败，写入内容可能被拦截。' : '回读校验通过。'}请重启游戏后生效。`,
    gameId: req.gameId,
    configPath: filePath,
    writtenPath: filePath,
    extraWritten,
    verified: verification ? verification.verified : false,
    defaultsSource: ue4Plan?.defaultsSource,
    backupPath,
    format,
    changedCount: result.changedCount + customApplied,
    changes: result.changes.slice(0, 40),
  }
}

/**
 * Dry-run ESDF migration: same parse/shift as migrateEsdfConfig, but does NOT write.
 * Used by the batch workbench preview.
 */
const previewEsdfConfig = (req) => {
  const resolved = resolveConfigTarget(req)
  if (!resolved.success) {
    return {
      success: false,
      gameId: req.gameId,
      name: req.gameName || req.gameId,
      status: 'no-config',
      message: resolved.message,
      changedCount: 0,
      changes: [],
    }
  }

  const { filePath, configFileName } = resolved
  let content
  try {
    content = readConfigText(filePath, resolved.missing).text
  } catch (e) {
    return {
      success: false,
      gameId: req.gameId,
      name: req.gameName || req.gameId,
      status: 'read-error',
      message: `读取配置失败：${e.message}`,
      changedCount: 0,
      changes: [],
    }
  }

  let format = detectMigrationFormat(configFileName, content)
  if (content.includes(UE4_OVERRIDE_MARKER)) {
    return { success: true, gameId: req.gameId, name: req.gameName || req.gameId, status: 'already-esdf', format: 'ue4-override', configPath: filePath, configFileName, message: '已含 MousKey 覆盖条目', changedCount: 0, changes: [] }
  }
  const layout = detectMovementLayout(content, format)

  if (layout === 'esdf' && !req.force) {
    return {
      success: true,
      gameId: req.gameId,
      name: req.gameName || req.gameId,
      status: 'already-esdf',
      layout,
      format,
      configPath: filePath,
      configFileName,
      message: '已是 ESDF 布局，将跳过',
      changedCount: 0,
      changes: [],
    }
  }

  let result
  switch (format) {
    case 'ue4-ini': result = migrateUe4InputIni(content); break
    case 'json': result = migrateJsonKeys(content); break
    case 'source-cfg': result = migrateSourceCfg(content); break
    default: result = migrateIniKeys(content); break
  }
  let ue4Plan = null
  if (result && result.success !== false && (format === 'ue4-ini' || format === 'ini') && result.changedCount === 0) {
    ue4Plan = planUe4Override(content, resolved)
    if (ue4Plan && !ue4Plan.skipped) { result = ue4Plan.result; format = 'ue4-override' }
    else if (ue4Plan && ue4Plan.skipped) {
      return { success: true, gameId: req.gameId, name: req.gameName || req.gameId, status: 'already-esdf', format: 'ue4-override', configPath: filePath, configFileName, message: '已含 MousKey 覆盖条目', changedCount: 0, changes: [] }
    }
  }

  if (!result || result.success === false) {
    return {
      success: false,
      gameId: req.gameId,
      name: req.gameName || req.gameId,
      status: 'unparsed',
      format,
      configPath: filePath,
      configFileName,
      message: result?.message || `无法解析（${format}）`,
      changedCount: 0,
      changes: [],
    }
  }

  if (result.changedCount === 0) {
    return {
      success: true,
      gameId: req.gameId,
      name: req.gameName || req.gameId,
      status: 'no-keys',
      layout,
      format,
      configPath: filePath,
      configFileName,
      message: '未发现可右移的字母键',
      changedCount: 0,
      changes: [],
    }
  }

  return {
    success: true,
    gameId: req.gameId,
    name: req.gameName || req.gameId,
    status: layout === 'wasd' ? 'wasd' : 'shiftable',
    layout,
    format,
    configPath: filePath,
    configFileName,
    message: `可右移 ${result.changedCount} 个键（${format}${ue4Plan?.defaultsSource ? `，默认键来源：${ue4Plan.defaultsSource}` : ''}）`,
    changedCount: result.changedCount,
    changes: result.changes.slice(0, 30),
    missing: !!resolved.missing,
    targets: ue4Plan?.targets,
    defaultsSource: ue4Plan?.defaultsSource,
    added: result.added,
  }
}

/**
 * List ESDF-migration candidates from a full detectAllGames scan.
 * Classifies each installed game so the workbench can show a checklist.
 */
const listEsdfCandidates = () => {
  let all
  try {
    all = detectAllGames()
  } catch (e) {
    return { success: false, message: `扫描失败：${e.message}`, candidates: [] }
  }

  const candidates = []
  for (const g of all.games || []) {
    if (!g.found) continue
    // Skip games with no config path at all
    if (!g.configPath) continue

    const preview = previewEsdfConfig({
      gameId: g.gameId,
      gameName: g.name,
      configPath: g.configPath,
      fileName: g.configFileName,
      steamAppId: g.steamAppId,
    })

    // Attach curated knowledge (path hints / how-to / support level)
    const knowledge = findKeybindFromKnowledge(g.gameId, g.name, g.steamAppId)?.knowledge
      || keybindKnowledge.games.find((k) => k.name && g.name && k.name.toLowerCase() === g.name.toLowerCase())
      || null

    candidates.push({
      gameId: g.gameId,
      name: g.name,
      genre: g.genre,
      color: g.color || '#6a8a9a',
      engineType: g.engineType ?? null,
      steamAppId: g.steamAppId ?? null,
      configPath: preview.configPath || g.configPath,
      configFileName: preview.configFileName || g.configFileName || null,
      format: preview.format || null,
      layout: preview.layout || null,
      status: preview.status,
      changedCount: preview.changedCount || 0,
      changes: preview.changes || [],
      message: preview.message,
      canMigrate: preview.success && (preview.status === 'wasd' || preview.status === 'shiftable'),
      alreadyEsdf: preview.status === 'already-esdf',
      knowledge: knowledge
        ? {
          esdfSupport: knowledge.esdfSupport || null,
          howTo: knowledge.howTo || null,
          confidence: knowledge.confidence || null,
          source: knowledge.source || null,
          paths: knowledge.paths || [],
        }
        : null,
    })
  }

  // Sort: migratable first, then already-esdf, then others; by name
  const rank = (c) => {
    if (c.canMigrate) return 0
    if (c.alreadyEsdf) return 1
    return 2
  }
  candidates.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'zh-CN'))

  const migratable = candidates.filter((c) => c.canMigrate).length
  const already = candidates.filter((c) => c.alreadyEsdf).length

  return {
    success: true,
    message: `扫描完成：${migratable} 款可迁移，${already} 款已是 ESDF，共 ${candidates.length} 款有配置。`,
    total: candidates.length,
    migratable,
    alreadyEsdf: already,
    candidates,
  }
}

/**
 * Batch ESDF migration.
 * req: { gameIds: string[], force?: boolean }
 * Processes each game independently; never aborts the whole batch on one failure.
 */
const batchMigrateEsdf = (req) => {
  const gameIds = Array.isArray(req.gameIds) ? req.gameIds : []
  if (gameIds.length === 0) {
    return { success: false, message: '未选择任何游戏。', results: [] }
  }

  const results = []
  let ok = 0
  let skipped = 0
  let failed = 0
  let totalChanges = 0

  for (const gameId of gameIds) {
    try {
      const r = migrateEsdfConfig({
        gameId,
        force: req.force === true,
      })
      const entry = {
        gameId,
        success: r.success === true,
        skipped: r.skipped === true,
        changedCount: r.changedCount || 0,
        message: r.message,
        configPath: r.configPath || r.writtenPath || null,
        backupPath: r.backupPath || null,
        changes: r.changes || [],
      }
      if (!entry.success) failed++
      else if (entry.skipped || entry.changedCount === 0) skipped++
      else {
        ok++
        totalChanges += entry.changedCount
      }
      results.push(entry)
    } catch (e) {
      failed++
      results.push({
        gameId,
        success: false,
        skipped: false,
        changedCount: 0,
        message: e instanceof Error ? e.message : String(e),
      })
    }
  }

  return {
    success: failed === 0 || ok > 0,
    message: `批量迁移完成：成功 ${ok} 款，跳过 ${skipped} 款，失败 ${failed} 款，共改动 ${totalChanges} 处。请分别重启对应游戏后生效。`,
    ok,
    skipped,
    failed,
    totalChanges,
    results,
  }
}

/**
 * Apply custom ActionId→key mappings onto already-migrated content.
 * Matches action names heuristically (case-insensitive contains / known maps).
 */
const applyCustomKeysToContent = (content, format, customKeys) => {
  const changes = []
  let appliedCount = 0

  // Known ActionId → common native name patterns
  const actionPatterns = {
    forward: [/move.*forward/i, /move.*y.*pos/i, /\+forward/i, /^forward$/i, /move_up/i],
    back: [/move.*back/i, /move.*y.*neg/i, /\+back/i, /^back$/i, /move_down/i],
    left: [/move.*left/i, /move.*x.*neg/i, /\+moveleft/i, /^left$/i],
    right: [/move.*right/i, /move.*x.*pos/i, /\+moveright/i, /^right$/i],
    jump: [/jump/i],
    interact: [/interact/i, /\+use/i, /^use$/i],
    sprint: [/sprint/i, /run/i],
    crouch: [/crouch/i, /duck/i],
    primary: [/attack$/i, /\+attack$/i, /fire/i, /primary/i],
    secondary: [/attack2/i, /aim/i, /alt.?fire/i, /secondary/i],
    ability1: [/ability.?1/i, /spell.?1/i, /slot.?1/i],
    ability2: [/ability.?2/i, /spell.?2/i, /slot.?2/i],
    ability3: [/ability.?3/i, /spell.?3/i, /slot.?3/i],
    ultimate: [/ability.?4/i, /ultimate/i, /ult/i],
    map: [/\bmap\b/i, /showscores/i],
  }

  const entries = Object.entries(customKeys).filter(([, v]) => v && String(v).trim())
  if (entries.length === 0) return { success: true, content, appliedCount: 0, changes }

  if (format === 'ue4-ini') {
    let next = content
    for (const [actionId, keyValue] of entries) {
      const patterns = actionPatterns[actionId]
      if (!patterns) continue
      const ue4Key = normalizeKeyToUe4Backend(String(keyValue))
      // Find Axis/Action mappings whose AxisName/ActionName matches
      next = next.replace(
        /(AxisMappings|ActionMappings)=\(([^)]*)\)/g,
        (full, kind, inner) => {
          const nameMatch = inner.match(/(?:AxisName|ActionName)="([^"]+)"/)
          if (!nameMatch) return full
          const name = nameMatch[1]
          if (!patterns.some((p) => p.test(name))) return full
          if (!/Key=/.test(inner)) return full
          appliedCount++
          changes.push(`${name} → ${ue4Key}`)
          return `${kind}=(${inner.replace(/Key=[^,)]+/, `Key=${ue4Key}`)})`
        },
      )
    }
    return { success: true, content: next, appliedCount, changes }
  }

  if (format === 'json') {
    let parsed
    try { parsed = JSON.parse(content) } catch (e) {
      return { success: false, message: e.message, appliedCount: 0, changes }
    }
    const keyToNativeToken = (raw) => {
      const k = String(raw).trim()
      const upper = k.toUpperCase()
      if (/^MOUSE\s*\d$/i.test(k) || /^MOUSE\d$/i.test(k)) {
        const n = k.replace(/[^0-9]/g, '')
        return n === '1' ? 'm.1' : n === '2' ? 'm.2' : `m.${n}`
      }
      if (upper === 'MOUSE1' || upper === 'MOUSE0') return 'm.1'
      if (upper === 'MOUSE2') return 'm.2'
      if (upper === 'MOUSE3') return 'm.3'
      if (upper.length === 1 && /[A-Z]/.test(upper)) return `k.${upper}`
      return k.toLowerCase()
    }
    const walkApply = (node) => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        node.forEach(walkApply)
        return
      }
      for (const [nativeName, value] of Object.entries(node)) {
        for (const [actionId, keyValue] of entries) {
          const patterns = actionPatterns[actionId]
          if (!patterns) continue
          if (!patterns.some((p) => p.test(nativeName))) continue
          const nativeKey = keyToNativeToken(keyValue)
          if (Array.isArray(value)) {
            node[nativeName] = [nativeKey, ...value.slice(1)]
          } else if (typeof value === 'string') {
            node[nativeName] = nativeKey
          } else if (value && typeof value === 'object' && typeof value.key === 'string') {
            value.key = nativeKey
          } else {
            continue
          }
          appliedCount++
          changes.push(`${nativeName} → ${nativeKey}`)
          break
        }
        if (value && typeof value === 'object') walkApply(value)
      }
    }
    walkApply(parsed)
    return { success: true, content: JSON.stringify(parsed, null, 2), appliedCount, changes }
  }

  // Generic INI / Source: replace value of matching keys
  const lines = content.split(/\r?\n/)
  const nextLines = lines.map((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith(';') || trimmed.startsWith('#') || trimmed.startsWith('[')) return line

    // Source: bind "key" "command"
    if (format === 'source-cfg' || /\bbind\s+/i.test(trimmed)) {
      const bindMatch = trimmed.match(/(\bbind(?:toggle)?\s+)(["']?)([^"'\s]+)\2(\s+)(["'])([^"']+)\5/i)
      if (bindMatch) {
        const command = bindMatch[6]
        for (const [actionId, keyValue] of entries) {
          const patterns = actionPatterns[actionId]
          if (!patterns) continue
          if (!patterns.some((p) => p.test(command))) continue
          const newKey = String(keyValue).trim().toLowerCase().replace(/^mouse\s*/i, 'mouse')
          appliedCount++
          changes.push(`${command} → ${newKey}`)
          const indent = line.match(/^\s*/)[0]
          return `${indent}bind "${newKey}" "${command}"`
        }
      }
      return line
    }

    const eq = trimmed.indexOf('=')
    if (eq <= 0) return line
    const left = trimmed.slice(0, eq).trim()
    for (const [actionId, keyValue] of entries) {
      const patterns = actionPatterns[actionId]
      if (!patterns) continue
      if (!patterns.some((p) => p.test(left))) continue
      const newKey = String(keyValue).trim()
      appliedCount++
      changes.push(`${left} → ${newKey}`)
      const indent = line.match(/^\s*/)[0]
      const sep = line.includes(' = ') ? ' = ' : '='
      return `${indent}${left}${sep}${newKey}`
    }
    return line
  })
  return { success: true, content: nextLines.join('\n'), appliedCount, changes }
}

/** Backend copy of UE4 key normalizer (used by custom-key apply). */
const normalizeKeyToUe4Backend = (key) => {
  const k = String(key).trim()
  const map = {
    'Mouse 1': 'LeftMouseButton', MOUSE1: 'LeftMouseButton',
    'Mouse 2': 'RightMouseButton', MOUSE2: 'RightMouseButton',
    'Mouse 3': 'MiddleMouseButton', MOUSE3: 'MiddleMouseButton',
    'Mouse 4': 'ThumbMouseButton', MOUSE4: 'ThumbMouseButton',
    'Mouse 5': 'ThumbMouseButton2', MOUSE5: 'ThumbMouseButton2',
    Space: 'SpaceBar', SPACE: 'SpaceBar',
    Tab: 'Tab', TAB: 'Tab',
    Esc: 'Escape', ESC: 'Escape', ESCAPE: 'Escape',
    Enter: 'Enter', ENTER: 'Enter',
    Backspace: 'BackSpace', BACKSPACE: 'BackSpace',
    Shift: 'LeftShift', SHIFT: 'LeftShift',
    'Shift R': 'RightShift', RSHIFT: 'RightShift',
    Ctrl: 'LeftControl', CTRL: 'LeftControl',
    'Ctrl R': 'RightControl', RCTRL: 'RightControl',
    Alt: 'LeftAlt', ALT: 'LeftAlt',
    'Alt R': 'RightAlt', RALT: 'RightAlt',
    Caps: 'CapsLock', CAPSLOCK: 'CapsLock',
  }
  if (map[k]) return map[k]
  const upper = k.toUpperCase()
  if (map[upper]) return map[upper]
  if (/^F\d+$/.test(upper)) return upper
  if (upper.length === 1 && /[A-Z]/.test(upper)) return upper
  return k
}

/**
 * Safe UE4 Input.ini write: merge Axis/Action mappings into existing file
 * instead of overwriting the whole file (which destroys other settings).
 */
const writeUe4InputIniMerged = (targetPath, configText, gameId) => {
  let original = existsSync(targetPath) ? readFileSync(targetPath, 'utf8') : '[/Script/Engine.InputSettings]\n'
  const backupPath = existsSync(targetPath) ? createBackup(targetPath, gameId) : null

  // Collect mappings from generated text
  const newAxes = []
  const newActions = []
  for (const line of configText.split(/\r?\n/)) {
    const t = line.trim()
    if (t.startsWith('AxisMappings=')) newAxes.push(t)
    else if (t.startsWith('ActionMappings=')) newActions.push(t)
  }
  if (newAxes.length === 0 && newActions.length === 0) {
    return { success: false, message: '生成的 UE4 配置中没有可用的映射。', gameId }
  }

  // Remove existing AxisMappings / ActionMappings lines, then append new ones
  // under [/Script/Engine.InputSettings]. Preserve all other lines/sections.
  const lines = original.split(/\r?\n/)
  const kept = lines.filter((l) => {
    const t = l.trim()
    return !t.startsWith('AxisMappings=') && !t.startsWith('ActionMappings=')
  })

  // Find or create the InputSettings section
  let insertAt = kept.length
  let sectionIdx = kept.findIndex((l) => l.trim().toLowerCase() === '[/script/engine.inputsettings]')
  if (sectionIdx >= 0) {
    // Insert after the last non-empty line of that section (before next [section])
    insertAt = sectionIdx + 1
    for (let i = sectionIdx + 1; i < kept.length; i++) {
      const t = kept[i].trim()
      if (t.startsWith('[') && t.endsWith(']')) break
      insertAt = i + 1
    }
  } else {
    // Append section at end
    kept.push('')
    kept.push('[/Script/Engine.InputSettings]')
    insertAt = kept.length
  }

  const inject = [...newAxes, ...newActions]
  kept.splice(insertAt, 0, ...inject)

  // Ensure BOM preserved
  const hasBom = original.charCodeAt(0) === 0xFEFF
  const body = kept.join('\n')
  writeFileSync(targetPath, hasBom ? '\uFEFF' + body : body, 'utf8')

  return {
    success: true,
    message: `已合并写入 Input.ini（${newAxes.length} 个轴映射，${newActions.length} 个动作映射，保留其他设置）。${backupPath ? `原文件备份：${backupPath}。` : ''}重启游戏后生效。`,
    gameId,
    writtenPath: targetPath,
    backupPath,
    linesWritten: newAxes.length + newActions.length,
  }
}

// ─── Vite plugin ──────────────────────────────────────────────────────────────


// ─── Exports ────────────────────────────────────────────────────────────────
module.exports = {
  // Game detection
  detectGame,
  detectAllGames,
  // Custom adapters
  getCustomAdaptersDir,
  listCustomAdapters,
  saveCustomAdapter,
  deleteCustomAdapter,
  generateAdapterFromLudusavi,
  // Config write
  writeGameConfig,
  // ESDF one-click migration
  migrateEsdfConfig,
  previewEsdfConfig,
  ue4Generic: ue4g,
  listEsdfCandidates,
  batchMigrateEsdf,
  findKeybindFromKnowledge,
  // LoL
  readLolSettings,
 readGameConfig,
  startLolSaveWatch,
  getLolWatchStatus,
  // Presets
  listLocalPresets,
  saveLocalPreset,
  loadLocalPreset,
  deleteLocalPreset,
};
