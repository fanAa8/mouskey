import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ArchiveRestore,
  Activity,
  ArrowRightLeft,
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleDot,
  CloudOff,
  Crosshair,
  FileCog,
  FileOutput,
  FolderClock,
  Gamepad2,
  Gauge,
  Keyboard,
  Layers3,
  Mouse,
  Plus,
  RotateCcw,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Undo2,
  Upload,
  X,
  AlertTriangle,
  Download,
  Wrench,
  Info,
  UserRound,
} from 'lucide-react'
import {
  type ActionId,
  type Category,
  type ControlAction,
  type Device,
  type Profile,
  type GameDefinition,
  type LocalPreset,
  type LolReadResult,
  type LolWatchResult,
  type PatchSet,
  type RestorePoint,
  actionTemplate,
  createBindings,
  games,
  getGame,
  profileSeeds,
  universalKeys,
  wasdKeys,
  generatePatchSet,
  formatNativeConfig,
  getConfigFileName,
} from './adapters'
import { KeyboardMap, MouseMap } from './components/InputMaps'
import { BatchPage } from './pages/BatchPage'
import { PersonalProfilePage } from './pages/PersonalProfilePage'
import { applyEsdfMigration, isEmptyKey, shouldShiftKey, getShiftTarget, detectKeyConflicts } from './lib/esdfMigration'

const categories: { id: Category | 'all'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'movement', label: '移动' },
  { id: 'combat', label: '操作' },
  { id: 'abilities', label: '技能' },
  { id: 'summoner', label: '召唤师' },
  { id: 'items', label: '物品' },
  { id: 'system', label: '系统' },
]

// 104-key keyboard layout: 3 sections (main, nav, numpad)
const keyboardSections = {
  main: [
    ['Esc', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'],
    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace'],
    ['Tab', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\'],
    ['Caps', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter'],
    ['Shift', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'Shift R'],
    ['Ctrl', 'Win', 'Alt', 'Space', 'Alt R', 'Menu', 'Ctrl R'],
  ],
  nav: [
    ['Print', 'Scroll', 'Pause'],
    ['Insert', 'Home', 'PageUp'],
    ['Delete', 'End', 'PageDown'],
    [],
    ['↑'],
    ['←', '↓', '→'],
  ],
  numpad: [
    ['NumLock', '/', '*', '-'],
    ['7', '8', '9', '+'],
    ['4', '5', '6', '+'],
    ['1', '2', '3', 'Enter'],
    ['0', '0', '.', 'Enter'],
  ],
}


// For backward compatibility - flatten main section
const keyboardRows = keyboardSections.main

const keyWidth = (key: string, rowIndex: number) => {
  if (rowIndex === 0) return key === 'Esc' ? 1.18 : 1
  const wideKeys: Record<string, number> = {
    Backspace: 2,
    Tab: 1.55,
    Caps: 1.9,
    Enter: 2.15,
    Shift: 2.35,
    'Shift R': 2.65,
    Ctrl: 1.55,
    'Ctrl R': 1.55,
    Win: 1.25,
    Alt: 1.35,
    'Alt R': 1.35,
    Space: 5.15,
    Menu: 1.25,
  }
  return wideKeys[key] ?? 1
}

// 固定按键宽度（像素），不随分辨率拉伸
const BASE_KEY_WIDTH = 38
const keyPixelWidth = (key: string, rowIndex: number) => Math.round(keyWidth(key, rowIndex) * BASE_KEY_WIDTH)

const categoryLabels: Record<Category, string> = {
  movement: '移动',
  combat: '操作',
  abilities: '技能',
  summoner: '召唤师',
  items: '物品',
  system: '系统',
}

const cloneBindings = (bindings: ControlAction[]) => bindings.map((binding) => ({ ...binding }))

// Key name to asset file mapping
const KEY_ASSET_MAP: Record<string, string> = {
  // Letters
  'A': 'a_white.png', 'B': 'b_white.png', 'C': 'c_white.png', 'D': 'd_white.png',
  'E': 'e_white.png', 'F': 'f_white.png', 'G': 'g_white.png', 'H': 'h_white.png',
  'I': 'i_white.png', 'J': 'j_white.png', 'K': 'k_white.png', 'L': 'l_white.png',
  'M': 'm_white.png', 'N': 'n_white.png', 'O': 'o_white.png', 'P': 'p_white.png',
  'Q': 'q_white.png', 'R': 'r_white.png', 'S': 's_white.png', 'T': 't_white.png',
  'U': 'u_white.png', 'V': 'v_white.png', 'W': 'w_white.png', 'X': 'x_white.png',
  'Y': 'y_white.png', 'Z': 'z_white.png',
  // Numbers
  '0': '0_white.png', '1': '1_white.png', '2': '2_white.png', '3': '3_white.png',
  '4': '4_white.png', '5': '5_white.png', '6': '6_white.png', '7': '7_white.png',
  '8': '8_white.png', '9': '9_white.png',
  // Function keys
  'F1': 'f1_white.png', 'F2': 'f2_white.png', 'F3': 'f3_white.png', 'F4': 'f4_white.png',
  'F5': 'f5_white.png', 'F6': 'f6_white.png', 'F7': 'f7_white.png', 'F8': 'f8_white.png',
  'F9': 'f9_white.png', 'F10': 'f10_white.png', 'F11': 'f11_white.png', 'F12': 'f12_white.png',
  // Special keys
  'Space': 'space_lg_white.png',
  'Enter': 'enter_white.png',
  'Backspace': 'backspace_white.png',
  'Tab': 'tab_white.png',
  'Esc': 'escape_white.png',
  'Escape': 'escape_white.png',
  'Shift': 'shift_white.png', 'LShift': 'shift_white.png', 'RShift': 'shift_white.png',
  'Ctrl': 'ctrl_white.png', 'LCtrl': 'ctrl_white.png', 'RCtrl': 'ctrl_white.png',
  'Alt': 'alt_white.png', 'LAlt': 'alt_white.png', 'RAlt': 'alt_white.png',
  'LWin': 'windows_white.png', 'RWin': 'windows_white.png',
  // Arrow keys
  'ArrowLeft': 'arrow-left_white.png', 'ArrowUp': 'arrow-up_white.png',
  'ArrowRight': 'arrow-right_white.png', 'ArrowDown': 'arrow-down_white.png',
  // Navigation
  'Delete': 'delete_white.png', 'Insert': 'insert_white.png',
  'Home': 'home_white.png', 'End': 'end_white.png',
  'PageUp': 'page-up_white.png', 'PageDown': 'page-down_white.png',
  'CapsLock': 'caps_white.png', 'Caps': 'caps_white.png',
  // Symbols
  ';': 'semicolon_white.png', '=': 'equals_white.png', ',': 'comma_white.png',
  '-': 'minus_white.png', '.': 'period_white.png', '/': 'slash_white.png',
  '`': 'backtick_white.png', '[': 'bracket-open_white.png',
  '\\': 'backslash_white.png', ']': 'bracket-close_white.png',
}

const getKeyAsset = (key: string): string | null => {
  const fileName = KEY_ASSET_MAP[key]
  return fileName ? `${import.meta.env.BASE_URL}keyboard-assets/keys/${fileName}` : null
}

// Mouse button to asset file mapping
const MOUSE_ASSET_MAP: Record<string, string> = {
  'left': 'LeftClick_White.png',
  'right': 'RightClick_White.png',
  'middle': 'MiddleClick_White.png',
  'x1': 'Mouse_White.png',
  'x2': 'Mouse_White.png',
}

const getMouseAsset = (button: string): string | null => {
  const fileName = MOUSE_ASSET_MAP[button]
  return fileName ? `${import.meta.env.BASE_URL}keyboard-assets/mouse/${fileName}` : null
}

const getMouseBadge = (button: string): string | null => {
  if (button === 'x1') return '1'
  if (button === 'x2') return '2'
  return null
}

// API base: dev mode uses vite dev server (relative path), production uses Electron HTTP server on 4175
const API_BASE = import.meta.env.DEV ? '' : 'http://127.0.0.1:4175'

function App() {
  const [profiles, setProfiles] = useState<Profile[]>(profileSeeds)
  const [activeProfileId, setActiveProfileId] = useState(profileSeeds[0].id)
  const [selectedActionId, setSelectedActionId] = useState<ActionId>('forward')
  const [activeCategory, setActiveCategory] = useState<Category | 'all'>('all')
  const [activeGameId, setActiveGameId] = useState('cs2')
  const [showPreview, setShowPreview] = useState(true)
  const [showNativeText, setShowNativeText] = useState(false)
  const [toast, setToast] = useState('')
  const [isWriting, setIsWriting] = useState(false)
  const [isMigratingEsdf, setIsMigratingEsdf] = useState(false)
  const [writeResult, setWriteResult] = useState<{ success: boolean; message: string } | null>(null)

  // ─── Real-time input monitoring ────────────────────────────────────────────
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set())
  const [pressedMouseButtons, setPressedMouseButtons] = useState<Set<string>>(new Set())
  const [inputMonitorConnected, setInputMonitorConnected] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [overlayPosition, setOverlayPosition] = useState('bottom-left')
  const [overlayMode, setOverlayMode] = useState('keys-only')
  const [showMouse, setShowMouse] = useState(false)
  const [overlayLocked, setOverlayLocked] = useState(false)
  const [mouseSettings, setMouseSettings] = useState({ x: 0, y: 40, width: 200, height: 220 })
  const [showMouseAdjust, setShowMouseAdjust] = useState(true)
  const [customKeySets, setCustomKeySets] = useState<Record<string, string[]>>({
    custom1: ['W', 'A', 'S', 'D', 'Space'],
    custom2: ['Q', 'W', 'E', 'R', 'Space'],
    custom3: ['E', 'S', 'D', 'F', 'Space'],
  })
  const [customKeys, setCustomKeys] = useState<string[]>(['W', 'A', 'S', 'D', 'Space'])
  const [isEditingCustom, setIsEditingCustom] = useState(false)
  const [showMouseForMode, setShowMouseForMode] = useState<Record<string, boolean>>({
    'keys-only': false,
    'game': true,
    'full': true,
    'custom1': false,
    'custom2': false,
    'custom3': false,
  })
  const [historyExpanded, setHistoryExpanded] = useState(true)
  const [keyboardScale, setKeyboardScale] = useState(100)
  const [keyboardOpacity, setKeyboardOpacity] = useState(100)
  const [keyboardHighlightColor, setKeyboardHighlightColor] = useState('#00d4ff')
  const [keyboardHighlightOpacity, setKeyboardHighlightOpacity] = useState(100)
  const [overlayTheme, setOverlayTheme] = useState('white')
  const [showFull104, setShowFull104] = useState(false)
  const [showAdjustPanel, setShowAdjustPanel] = useState(false)
  const [showKeyboardAdjust, setShowKeyboardAdjust] = useState(true)
  const [lastInputEvent, setLastInputEvent] = useState<{ key: string; state: string; time: number } | null>(null)
  const [inputHistory, setInputHistory] = useState<Array<{ key: string; state: string; time: number }>>([])
  const [totalKeyPresses, setTotalKeyPresses] = useState(0)
  const [isEsdfActive, setIsEsdfActive] = useState(true)
  const [activePage, setActivePage] = useState<'config' | 'personal' | 'games' | 'sync'>('personal')

  // LoL optional read/watch (preserved as optional enhancement, not blocking)
  const [lolRead, setLolRead] = useState<LolReadResult | null>(null)
  // Generic game config read (UE4 Input.ini, etc.)
  const [gameConfigRead, setGameConfigRead] = useState<{ success: boolean; message: string; bindings?: Record<string, string>; configPath?: string } | null>(null)
  const [isReadingGameConfig, setIsReadingGameConfig] = useState(false)
  const [isReadingLol, setIsReadingLol] = useState(false)
  const [lolWatch, setLolWatch] = useState<LolWatchResult | null>(null)
  const [isStartingLolWatch, setIsStartingLolWatch] = useState(false)
  const [showLolBindings, setShowLolBindings] = useState(false)

  const [restorePoints, setRestorePoints] = useState<RestorePoint[]>([
    { id: 'restore-1', gameId: 'lol', gameName: '英雄联盟', profileName: '通用方案', timestamp: '今天 11:42', backupPath: '', originalPath: '' },
    { id: 'restore-2', gameId: 'cs2', gameName: 'CS2', profileName: '射击优先', timestamp: '昨天 20:18', backupPath: '', originalPath: '' },
    { id: 'restore-3', gameId: 'dont-starve', gameName: '饥荒', profileName: '生存轻量', timestamp: '8 月 30 日', backupPath: '', originalPath: '' },
  ])

  // ─── Detected games (auto-detect installed games) ───────────────────────
  type LudusaviInfo = { name: string; installDir: string | null; configFiles: string[]; configRegistry: string[] }
  type DetectedGame = { gameId: string; name: string; genre: string; color: string; found: boolean; configPath: string | null; configFileName?: string; message: string; hasAdapter: boolean; hasLudusaviData: boolean; ludusavi: LudusaviInfo | null; steamAppId?: string; source: string; autoAdapter?: boolean; engineType?: string }
  const [detectedGames, setDetectedGames] = useState<DetectedGame[]>([])
  const [isDetectingGames, setIsDetectingGames] = useState(false)
  const [hasDetectedGames, setHasDetectedGames] = useState(false)
  const [detectedCount, setDetectedCount] = useState(0)
  const [expandedGameId, setExpandedGameId] = useState<string | null>(null)
  const [isGeneratingAdapter, setIsGeneratingAdapter] = useState(false)

  // ─── Batch ESDF migration workbench ──────────────────────────────────────
  type EsdfCandidate = {
    gameId: string
    name: string
    genre?: string
    color?: string
    engineType?: string | null
    configPath?: string | null
    configFileName?: string | null
    format?: string | null
    layout?: string | null
    status: string
    changedCount: number
    changes: string[]
    message: string
    canMigrate: boolean
    alreadyEsdf: boolean
    knowledge?: {
      esdfSupport?: string | null
      howTo?: string | null
      confidence?: string | null
      source?: string | null
      paths?: string[]
    } | null
  }
  const [showEsdfWorkbench, setShowEsdfWorkbench] = useState(false)
  const [esdfCandidates, setEsdfCandidates] = useState<EsdfCandidate[]>([])
  const [esdfSelected, setEsdfSelected] = useState<Set<string>>(new Set())
  const [esdfSummary, setEsdfSummary] = useState<string>('')
  const [isLoadingEsdf, setIsLoadingEsdf] = useState(false)
  const [isBatchMigrating, setIsBatchMigrating] = useState(false)
  const [esdfBatchResult, setEsdfBatchResult] = useState<{ message: string; results: Array<{ gameId: string; success: boolean; skipped?: boolean; changedCount: number; message: string; backupPath?: string | null }> } | null>(null)
  const [expandedEsdfId, setExpandedEsdfId] = useState<string | null>(null)

  // Custom (auto-generated) adapters
  const [customAdapters, setCustomAdapters] = useState<GameDefinition[]>([])
  // Auto-detected engine-template adapters (UE4, etc.)
  const [autoAdapterGames, setAutoAdapterGames] = useState<GameDefinition[]>([])
  const allGames = useMemo(() => [...games.filter((g) => !g.isEngineTemplate), ...customAdapters, ...autoAdapterGames], [customAdapters, autoAdapterGames])
  const getAnyGame = (id: string): GameDefinition => allGames.find((g) => g.id === id) ?? allGames[0]

  // ─── Local presets (universal middle layer: save/load/delete) ───────────
  type LocalPresetSummary = { id: string; name: string; category?: string; note?: string; sourceGame?: string; sourceMode?: string; createdAt: string; updatedAt: string; bindingCount: number; filePath: string }
  const [localPresets, setLocalPresets] = useState<LocalPresetSummary[]>([])
  const [isLoadingPresets, setIsLoadingPresets] = useState(false)
  const [showPresetManager, setShowPresetManager] = useState(false)
  const [presetsDir, setPresetsDir] = useState('')

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]
  const [isEditingProfileName, setIsEditingProfileName] = useState(false)
  const [editingProfileName, setEditingProfileName] = useState('')
  const activeGame = getAnyGame(activeGameId)
  const supportedSet = activeGame.supportedActions ? new Set(activeGame.supportedActions) : null
  const supportedBindings = activeProfile.bindings.filter(
    (action) => !supportedSet || supportedSet.has(action.id),
  )
  const activeAction = supportedBindings.find((action) => action.id === selectedActionId) ?? supportedBindings[0] ?? activeProfile.bindings[0]
  const isLol = activeGame.id === 'lol'
  const activeModeId = isLol && (activeProfile.category === 'wasd' || activeProfile.name.toLowerCase().includes('wasd'))
    ? 'wasd'
    : activeGame.defaultMode

  // Write strategy selection (for games with multiple write strategies)
  const writeStrategies = activeGame.writeStrategies ?? []
  const hasMultipleStrategies = writeStrategies.length > 1
  const [activeStrategyId, setActiveStrategyId] = useState<string>('')
  // Reset strategy when game changes
  useEffect(() => {
    const defaultStrat = activeGame.defaultStrategy ?? (writeStrategies[0]?.id ?? '')
    setActiveStrategyId(defaultStrat)
  }, [activeGameId, activeGame.defaultStrategy, writeStrategies])
  const activeStrategy = writeStrategies.find((s) => s.id === activeStrategyId) ?? writeStrategies[0] ?? null
  // Use strategy's configFormat/fileName if available, otherwise fall back to game-level
  const activeConfigFormat = activeStrategy?.configFormat ?? activeGame.configFormat ?? 'ini'
  const activeConfigFileName = activeStrategy?.configFileName ?? activeGame.configFileName ?? 'config.ini'

  // ─── Preset-first patch generation ──────────────────────────────────────
  // This is the core change: patches are ALWAYS generated from the user's
  // own profile, regardless of whether the game's current config can be read.
  const patchSet: PatchSet = useMemo(
    () => generatePatchSet(activeGame, activeProfile.bindings, activeModeId),
    [activeGame, activeProfile.bindings, activeModeId],
  )

  const nativeConfigText = useMemo(() => formatNativeConfig(patchSet, activeConfigFormat), [patchSet, activeConfigFormat])

  const changedItems = useMemo(
    () => patchSet.patches.filter((p) => p.changed),
    [patchSet],
  )

  const previewLines = useMemo(
    () => patchSet.patches.slice(0, 8).map((patch) => ({
      name: patch.nativeKey,
      value: patch.presetValue,
      changed: patch.changed,
      label: patch.actionLabel,
    })),
    [patchSet],
  )

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  // ─── Real-time input monitoring SSE ────────────────────────────────────────
  useEffect(() => {
    const normalizeInputKey = (raw: string): string => {
      const k = raw.toUpperCase().trim()
      const map: Record<string, string> = {
        'SPACE': 'Space', ' ': 'Space',
        'LEFT CTRL': 'Ctrl', 'RIGHT CTRL': 'Ctrl R', 'LCONTROL': 'Ctrl', 'RCONTROL': 'Ctrl R',
        'LEFT SHIFT': 'Shift', 'RIGHT SHIFT': 'Shift R', 'LSHIFT': 'Shift', 'RSHIFT': 'Shift R',
        'LEFT ALT': 'Alt', 'RIGHT ALT': 'Alt R', 'LALT': 'Alt', 'RALT': 'Alt R',
        'TAB': 'Tab', 'CAPS LOCK': 'Caps', 'CAPSLOCK': 'Caps', 'CAPITAL': 'Caps',
        'RETURN': 'Enter', 'ENTER': 'Enter',
        'BACKSPACE': 'Backspace', 'BACK': 'Backspace',
        'ESCAPE': 'Esc', 'ESC': 'Esc',
        'LEFT WINDOWS': 'Win', 'RIGHT WINDOWS': 'Win', 'LWIN': 'Win', 'RWIN': 'Win',
        'APPS': 'Menu', 'APPLICATION': 'Menu',
        'UP': '↑', 'DOWN': '↓', 'LEFT': '←', 'RIGHT': '→',
      }
      if (map[k]) return map[k]
      // Single char keys (letters, numbers, symbols) - capitalize first letter
      if (k.length === 1) return k.toUpperCase()
      // F1-F12
      if (/^F\d{1,2}$/.test(k)) return k
      return raw
    }

    let eventSource: EventSource | null = null
    try {
      eventSource = new EventSource('http://127.0.0.1:4175/api/input/events')
      eventSource.onopen = () => setInputMonitorConnected(true)
      eventSource.onerror = () => setInputMonitorConnected(false)
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'keyboard') {
            const key = normalizeInputKey(data.key)
            setPressedKeys((prev) => {
              const next = new Set(prev)
              if (data.state === 'down') next.add(key)
              else next.delete(key)
              return next
            })
            const event = { key, state: data.state, time: data.timestamp }
            setLastInputEvent(event)
            setInputHistory((prev) => [event, ...prev].slice(0, 20))
            if (data.state === 'down') setTotalKeyPresses((prev) => prev + 1)
          } else if (data.type === 'mouse') {
            const buttonLabel = data.button === 'left' ? '左键' : data.button === 'right' ? '右键' : data.button === 'middle' ? '中键' : data.button === 'x1' ? '侧键1' : '侧键2'
            setPressedMouseButtons((prev) => {
              const next = new Set(prev)
              if (data.state === 'down') next.add(data.button)
              else next.delete(data.button)
              return next
            })
            const event = { key: buttonLabel, state: data.state, time: data.timestamp }
            setLastInputEvent(event)
            setInputHistory((prev) => [event, ...prev].slice(0, 20))
            if (data.state === 'down') setTotalKeyPresses((prev) => prev + 1)
          } else if (data.type === 'system' && data.event === 'connected') {
            setInputMonitorConnected(true)
          }
        } catch { /* ignore parse errors */ }
      }
    } catch {
      setInputMonitorConnected(false)
    }
    return () => {
      if (eventSource) eventSource.close()
      setInputMonitorConnected(false)
      setPressedKeys(new Set())
      setPressedMouseButtons(new Set())
    }
  }, [])

  const updateProfileBindings = (nextBindings: ControlAction[]) => {
    setProfiles((currentProfiles) => currentProfiles.map((profile) => (
      profile.id === activeProfileId ? { ...profile, bindings: nextBindings } : profile
    )))
  }

  const assignKey = (nextKey: string) => {
    if (nextKey === activeAction.key) return
    const previousKey = activeAction.key
    const nextBindings = activeProfile.bindings.map((action) => {
      if (action.id === activeAction.id) {
        return { ...action, key: nextKey, device: nextKey.startsWith('Mouse') ? 'mouse' as Device : 'keyboard' as Device }
      }
      if (action.key === nextKey) {
        return { ...action, key: previousKey, device: previousKey.startsWith('Mouse') ? 'mouse' as Device : 'keyboard' as Device }
      }
      return action
    })
    updateProfileBindings(nextBindings)
    setToast(`${activeAction.label} 已设为 ${nextKey}`)
  }

  const clearBinding = (key: string) => {
    const action = activeProfile.bindings.find((a) => a.key === key)
    if (!action) {
      setToast(`该按键未绑定任何动作`)
      return
    }
    const nextBindings = activeProfile.bindings.map((a) => {
      if (a.id === action.id) {
        return { ...a, key: '', device: 'keyboard' as Device }
      }
      return a
    })
    updateProfileBindings(nextBindings)
    setToast(`已清除 ${action.label} 的 ${key} 绑定`)
  }

  // ─── 整体右移键位（WASD → ESDF 规则）───────────────────────────────────
  // 使用已有的 esdfMigration 模块，支持各种键名格式（Q/q/KeyQ 等）
  const shiftBindingsRight = () => {
    const current = activeProfile.bindings
    let shiftedCount = 0
    // First pass: apply shift using the existing esdfMigration module
    const nextBindings = current.map((binding) => {
      if (!binding.key) return binding
      if (shouldShiftKey(binding.key)) {
        shiftedCount++
        return { ...binding, key: getShiftTarget(binding.key) }
      }
      return binding
    })
    if (shiftedCount === 0) {
      setToast('当前配置中没有可右移的字母键（QAZ 区域）')
      return
    }
    // Resolve conflicts: if two actions end up on the same key, keep first, clear rest
    const conflicts = detectKeyConflicts(nextBindings)
    let conflictCount = 0
    for (const [key, actionIds] of Object.entries(conflicts)) {
      for (let i = 1; i < actionIds.length; i++) {
        const idx = nextBindings.findIndex((b) => b.id === actionIds[i])
        if (idx >= 0) {
          nextBindings[idx] = { ...nextBindings[idx], key: '' }
          conflictCount++
        }
      }
    }
    updateProfileBindings(nextBindings)
    setIsEsdfActive(true)
    setToast(`已整体右移 ${shiftedCount} 个字母键（WASD→ESDF），QAZ 已空出${conflictCount > 0 ? `，解决 ${conflictCount} 个冲突` : ''}`)
  }

  const applyEsdfToProfile = () => {
    // 直接应用标准 ESDF 预设布局，避免在当前配置上右移导致冲突和错乱
    const esdfBindings = createBindings(universalKeys)
    updateProfileBindings(esdfBindings)
    setIsEsdfActive(true)
    setToast('已应用标准 ESDF 布局（移动 E S D F · 技能 W R T · QAZ 空出）')
  }

  const applyWasdToProfile = () => {
    // 直接应用标准 WASD 预设布局
    const wasdBindings = createBindings(wasdKeys)
    updateProfileBindings(wasdBindings)
    setIsEsdfActive(false)
    setToast('已应用标准 WASD 布局（移动 W A S D · 技能 Q E R）')
  }

  const addProfile = () => {
    const number = profiles.filter((profile) => profile.id.startsWith('custom-')).length + 1
    const newProfile: Profile = {
      id: `custom-${number}`,
      name: `自定义方案 ${number}`,
      note: '刚刚创建 · 14 个动作',
      bindings: cloneBindings(activeProfile.bindings),
    }
    setProfiles((currentProfiles) => [...currentProfiles, newProfile])
    setActiveProfileId(newProfile.id)
    setToast('已新建个人配置档')
  }

  const deleteProfile = () => {
    if (profiles.length <= 1) {
      setToast('至少保留一个配置档')
      return
    }
    if (!window.confirm(`确认删除配置档「${activeProfile.name}」吗？`)) return
    const currentIndex = profiles.findIndex((p) => p.id === activeProfileId)
    const newProfiles = profiles.filter((p) => p.id !== activeProfileId)
    setProfiles(newProfiles)
    // Switch to adjacent profile
    const nextIndex = Math.min(currentIndex, newProfiles.length - 1)
    setActiveProfileId(newProfiles[nextIndex].id)
    setToast(`已删除配置档「${activeProfile.name}」`)
  }

  const renameProfile = (newName: string) => {
    if (!newName.trim()) return
    setProfiles((currentProfiles) => currentProfiles.map((profile) => (
      profile.id === activeProfileId ? { ...profile, name: newName.trim() } : profile
    )))
    setToast(`方案已重命名为「${newName.trim()}」`)
  }

  const resetProfile = () => {
    const seed = profileSeeds.find((profile) => profile.id === activeProfileId)
    if (!seed) {
      updateProfileBindings(createBindings({
        forward: 'E', left: 'S', back: 'D', right: 'F',
        primary: 'Mouse 1', secondary: 'Mouse 2',
        ability1: 'W', ability2: 'R', ability3: 'T', ultimate: 'V',
        interact: 'G', jump: 'Space', inventory1: '1', map: 'Tab',
      }))
    } else {
      updateProfileBindings(cloneBindings(seed.bindings))
    }
    setToast('当前配置档已重置')
  }

  const createRestorePoint = () => {
    const now = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date())
    const point: RestorePoint = {
      id: `restore-${Date.now()}`,
      gameId: activeGame.id,
      gameName: activeGame.name,
      profileName: activeProfile.name,
      timestamp: `今天 ${now}`,
      backupPath: '',
      originalPath: '',
    }
    setRestorePoints((points) => [point, ...points])
    setToast(`已为 ${activeGame.name} 创建恢复点`)
  }

  // ─── LoL optional read/watch (not blocking) ─────────────────────────────

  /** Map LoL traditional mode event names to ActionId */
  const lolTraditionalEventToActionId: Record<string, ActionId> = {
    evtCastSpell1: 'ability1', evtCastSpell2: 'ability2',
    evtCastSpell3: 'ability3', evtCastSpell4: 'ultimate',
    evtCastAvatarSpell1: 'summoner1', evtCastAvatarSpell2: 'summoner2',
    evtUseItem1: 'inventory1', evtUseItem2: 'inventory2',
    evtUseItem3: 'inventory3', evtUseItem4: 'inventory4',
    evtUseItem5: 'inventory5', evtUseItem6: 'inventory6',
    evtUseVisionItem: 'trinket', evtCastRoleBound: 'role_quest',
    evtPlayerPingCursor: 'ping', evtOpenShop: 'shop',
    evtCameraSnap: 'camera_snap', evtCameraLockToggle: 'camera_lock',
    evtShowScoreBoard: 'map', evtPlayerStopPosition: 'stop',
    evtPlayerHoldPosition: 'hold_position', evtPlayerAttackMoveClick: 'attack_move',
    evtPlayerMoveClick: 'secondary',
  }

  /** Map LoL WASD mode event names to ActionId */
  const lolWasdEventToActionId: Record<string, ActionId> = {
    MoveUp: 'forward', MoveLeft: 'left', MoveDown: 'back', MoveRight: 'right',
    CastSpell1: 'ability1', CastSpell2: 'ability2',
    CastSpell3: 'ability3', CastSpell4: 'ultimate',
    CastAvatarSpell1: 'summoner1', CastAvatarSpell2: 'summoner2',
    CastRoleBound: 'role_quest',
    UseItem1: 'inventory1', UseItem2: 'inventory2',
    UseVisionItem: 'trinket',
    PlayerPingCursor: 'ping',
    CameraSnap: 'camera_snap',
    CancelCurrentActions: 'cancel_cast',
  }

  /** Convert LoL bracket format ([q], [Button 1], [Space]) to app format (Q, Mouse 1, Space) */
  const fromLolKey = (lolKey: string): string => {
    if (!lolKey || lolKey === 'null' || lolKey.includes('<Unbound>')) return ''
    const inner = lolKey.replace(/\[|\]/g, '').trim()
    if (!inner) return ''
    if (inner.startsWith('Button ')) return `Mouse ${inner.replace('Button ', '')}`
    const map: Record<string, string> = {
      Space: 'Space', Tab: 'Tab', Esc: 'Esc', Enter: 'Enter',
      'L Shift': 'Shift', 'R Shift': 'Shift', Shift: 'Shift',
      'L Ctrl': 'Ctrl', 'R Ctrl': 'Ctrl', Ctrl: 'Ctrl',
      'L Alt': 'Alt', 'R Alt': 'Alt', Alt: 'Alt',
      'Up Arrow': '↑', 'Down Arrow': '↓', 'Left Arrow': '←', 'Right Arrow': '→',
    }
    if (map[inner]) return map[inner]
    if (/^F\d+$/.test(inner)) return inner
    if (inner.length === 1) return inner.toUpperCase()
    return inner
  }

  /** Apply read LoL bindings to current profile, based on profile type */
  const applyLolReadToProfile = (result: LolReadResult) => {
    // Determine which mode to sync based on current profile name
    const profileName = activeProfile.name.toLowerCase()
    const isWasdProfile = profileName.includes('wasd')
    const wasdBindings = result.wasd?.bindings ?? []
    const traditionalBindings = result.traditional?.bindings ?? result.bindings ?? []

    // Strictly respect profile type: WASD profile -> WASD mode, otherwise -> traditional mode
    const bindings = isWasdProfile ? wasdBindings : traditionalBindings
    const eventMap = isWasdProfile ? lolWasdEventToActionId : lolTraditionalEventToActionId
    const modeLabel = isWasdProfile ? 'WASD模式' : '传统模式'

    if (bindings.length === 0) return modeLabel

    const keyMap = new Map<string, string>()
    for (const b of bindings) {
      const actionId = eventMap[b.event]
      if (!actionId) continue
      const key = fromLolKey(b.key)
      if (key) keyMap.set(actionId, key)
    }
    if (keyMap.size === 0) return

    // Update current profile bindings
    setProfiles((prev) => prev.map((profile) => {
      if (profile.id !== activeProfileId) return profile
      const newBindings = profile.bindings.map((action) => {
        const newKey = keyMap.get(action.id)
        return newKey !== undefined ? { ...action, key: newKey, device: newKey.startsWith('Mouse') ? 'mouse' as const : 'keyboard' as const } : action
      })
      return { ...profile, bindings: newBindings }
    }))

    return modeLabel
  }

  const readLocalLolSettings = async () => {
    setIsReadingLol(true)
    try {
      const response = await fetch(API_BASE + '/api/adapters/lol/read', { cache: 'no-store' })
      const result = await response.json() as LolReadResult
      setLolRead(result)
      // Sync read bindings to current profile
      if (result.status === 'found' || result.status === 'partial') {
        const modeLabel = applyLolReadToProfile(result)
        const tradCount = result.traditional?.bindings?.length ?? result.bindings?.length ?? 0
        const wasdCount = result.wasd?.bindings?.length ?? 0
        setToast(`已读取英雄联盟键位（传统${tradCount}条 / WASD${wasdCount}条），已同步${modeLabel ? `「${modeLabel}」` : ''}到当前配置档`)
      } else {
        setToast(result.message)
      }
    } catch {
      setLolRead({ status: 'error', message: '无法连接本机设置读取服务。' })
      setToast('读取本机英雄联盟设置失败')
    } finally {
      setIsReadingLol(false)
    }
  }

  const readGameCurrentConfig = async () => {
    setIsReadingGameConfig(true)
    setGameConfigRead(null)
    try {
      const response = await fetch(API_BASE + '/api/adapters/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: activeGame.id,
          configPath: activeGame.configPathLabel || undefined,
          fileName: activeConfigFileName,
        }),
      })
      const result = await response.json()
      setGameConfigRead(result)
      if (result.success && result.bindings && Object.keys(result.bindings).length > 0) {
        // Apply read bindings to current profile
        setProfiles((prev) => prev.map((profile) => {
          if (profile.id !== activeProfileId) return profile
          const newBindings = profile.bindings.map((binding) => {
            const readKey = result.bindings[binding.id]
            if (readKey) {
              return { ...binding, key: readKey }
            }
            return binding
          })
          return { ...profile, bindings: newBindings }
        }))
        // Update the game definition's nativeNames with the read mapping
        // This ensures generatePatchSet uses the correct native action names (e.g. Move.Y.Pos instead of Axis_MoveForward)
        if (result.nativeNames && typeof result.nativeNames === 'object') {
          setAutoAdapterGames((prev) => prev.map((g) => {
            if (g.id !== activeGame.id) return g
            return { ...g, nativeNames: { ...g.nativeNames, ...result.nativeNames } }
          }))
        }
        const count = Object.keys(result.bindings).length
        setToast(`已读取 ${activeGame.name} 当前键位（${count} 项），已同步到当前配置档`)
      } else if (result.success) {
        setToast(result.message || '已读取配置文件，但未解析到键位映射')
      } else {
        setToast(`读取失败：${result.message}`)
      }
    } catch {
      setGameConfigRead({ success: false, message: '无法连接配置读取服务。' })
      setToast('读取游戏配置失败')
    } finally {
      setIsReadingGameConfig(false)
    }
  }

  const refreshLolSaveWatch = useCallback(async () => {
    const response = await fetch(API_BASE + '/api/adapters/lol/watch/status', { cache: 'no-store' })
    const result = await response.json() as LolWatchResult
    setLolWatch(result)
    return result
  }, [])

  const startLolSaveWatch = async () => {
    setIsStartingLolWatch(true)
    try {
      const response = await fetch(API_BASE + '/api/adapters/lol/watch/start', { method: 'POST', cache: 'no-store' })
      const result = await response.json() as LolWatchResult
      setLolWatch(result)
      setToast('已开始监测下一次本地保存')
    } catch {
      setToast('无法启动本地保存监测')
    } finally {
      setIsStartingLolWatch(false)
    }
  }

  useEffect(() => {
    if (lolWatch?.status !== 'watching') return
    const interval = window.setInterval(() => { void refreshLolSaveWatch() }, 1200)
    return () => window.clearInterval(interval)
  }, [lolWatch?.status, refreshLolSaveWatch])

  // ─── LoL keybinding display helpers ───────────────────────────────────────

  const formatLolKey = (raw: string): string => {
    if (!raw || raw === 'null' || raw.includes('<Unbound>')) return '未绑定'
    // Handle multiple bindings separated by comma: [Shift][Button 2],[a] -> "Shift+右键, A"
    const parts = raw.split(',').map((p) => p.trim()).filter(Boolean)
    const formatSingle = (part: string): string => {
      // Extract all bracket contents: [Ctrl][q] -> ['Ctrl', 'q']
      const matches = part.match(/\[([^\]]+)\]/g)
      if (!matches) return part
      const keys = matches.map((m) => m.replace(/\[|\]/g, '').trim())
      return keys.map((k) => {
        if (k.startsWith('Button ')) return `Mouse${k.replace('Button ', '')}`
        const map: Record<string, string> = {
          'Space': 'Space', 'Tab': 'Tab', 'Esc': 'Esc', 'Enter': 'Enter',
          'L Shift': 'Shift', 'R Shift': 'Shift', 'Shift': 'Shift',
          'L Ctrl': 'Ctrl', 'R Ctrl': 'Ctrl', 'Ctrl': 'Ctrl',
          'L Alt': 'Alt', 'R Alt': 'Alt', 'Alt': 'Alt',
          'Up Arrow': '↑', 'Down Arrow': '↓', 'Left Arrow': '←', 'Right Arrow': '→',
        }
        if (map[k]) return map[k]
        if (/^F\d+$/.test(k)) return k
        if (k.length === 1) return k.toUpperCase()
        return k
      }).join('+')
    }
    return parts.map(formatSingle).join(', ')
  }

  const lolEventLabels: Record<string, string> = {
    // 技能
    evtCastSpell1: '技能 1', evtCastSpell2: '技能 2',
    evtCastSpell3: '技能 3', evtCastSpell4: '终极技能',
    // 召唤师技能
    evtCastAvatarSpell1: '召唤师技能 1', evtCastAvatarSpell2: '召唤师技能 2',
    // 物品
    evtUseItem1: '物品栏 1', evtUseItem2: '物品栏 2', evtUseItem3: '物品栏 3',
    evtUseItem4: '物品栏 4', evtUseItem5: '物品栏 5', evtUseItem6: '物品栏 6',
    evtUseItem7: '物品栏 7', evtUseVisionItem: '饰品',
    evtCastRoleBound: '角色任务',
    // 移动/攻击
    evtPlayerMoveClick: '移动 (右键)', evtPlayerAttackMoveClick: '攻击移动',
    evtPlayerAttackMove: '攻击移动(按住)', evtPlayerStopPosition: '停止',
    evtPlayerHoldPosition: '原地待命',
    // 视角
    evtCameraSnap: '镜头回中', evtCameraLockToggle: '锁定视角',
    evtScrollUp: '视角上移', evtScrollDown: '视角下移',
    evtScrollLeft: '视角左移', evtScrollRight: '视角右移',
    // 系统
    evtPlayerPingCursor: '标记', evtOpenShop: '商店',
    evtShowScoreBoard: '计分板(切换)', evtHoldShowScoreBoard: '计分板(按住)',
    evtShowCharacterMenu: '英雄面板', evtSysMenu: '系统菜单',
    evtChampionOnly: '仅选中英雄', evtChatHistory: '聊天记录',
    // 升级技能
    evtLevelSpell1: '升级技能 1', evtLevelSpell2: '升级技能 2',
    evtLevelSpell3: '升级技能 3', evtLevelSpell4: '升级终极技能',
    // 表情
    evtEmoteToggle: '表情轮盘', evtEmoteJoke: '笑话', evtEmoteTaunt: '嘲讽',
    evtEmoteDance: '跳舞', evtEmoteLaugh: '大笑',
    evtChampMasteryDisplay: '英雄成就',
    // 队友视角
    evtSelectSelf: '视角自己', evtSelectAlly1: '视角队友1',
    evtSelectAlly2: '视角队友2', evtSelectAlly3: '视角队友3',
    evtSelectAlly4: '视角队友4',
    // 标记/信号
    evntPlayerPing: '标记(Alt+左键)', evtPlayerPingDanger: '危险标记(Ctrl+左键)',
    evtPlayerPingCursorDanger: '危险标记(光标)', evtPlayerPingAllIn: '集合信号',
    evtPlayerPingAreaIsWarded: '此处有眼', evtPlayerPingComeHere: '请求协助',
    evtPlayerPingMIA: '敌人消失', evtPlayerPingOMW: '正在路上',
    evtPlayerPingPush: '推进信号', evtPlayerPingVisionNeeded: '需要视野',
    evtPlayerPingRadialDanger: '径向危险标记',
    // 其他
    evtOnUIMouse4Pan: '鼠标中键平移', evtPetMoveClick: '宠物移动',
    evtPushToTalk: '按键说话', evtPushToTalkTeam: '队伍语音',
    evtReciprocityTrigger: '感谢队友', evtReciprocityMyBadTrigger: '我的锅',
    evtRadialEmoteInstantOpen: '快捷表情', evtRadialEmoteOpen: '表情轮盘(打开)',
    evtShowVoicePanel: '语音面板', evtShowSummonerNames: '显示召唤师名',
    evtShowHealthBars: '显示血条', evtToggleMinionHealthBars: '小兵血条',
    evtDragScrollLock: '拖动视角锁定',
    evtDrawHud: '显示HUD', evtEnableDirectedCamera: '导演视角',
    evtToggleDeathRecapShowcase: '死亡回放',
    evtToggleFPSAndLatency: '显示FPS', evtToggleMouseClip: '鼠标锁定',
    evtTogglePlayerStats: '玩家统计', evtTFTPlaceUnit: '云顶放置单位',
    evtTFTRerollShop: '云顶刷新商店', evtTFTSellUnit: '云顶出售单位',
    evtTFTToggleCombatRecapOpponent: '云顶战斗回顾',
    evtToggleScoreboardGoldDisplay: '计分板金币显示',
    // WASD 模式
    MoveUp: '上移', MoveDown: '下移', MoveLeft: '左移', MoveRight: '右移',
    CastSpell1: '技能 1', CastSpell2: '技能 2', CastSpell3: '技能 3', CastSpell4: '终极技能',
    CastAvatarSpell1: '召唤师技能 1', CastAvatarSpell2: '召唤师技能 2',
    CastRoleBound: '角色任务', UseItem1: '物品栏 1', UseItem2: '物品栏 2',
    UseVisionItem: '饰品', PlayerPingCursor: '标记', CameraSnap: '镜头回中',
    CancelCurrentActions: '取消当前动作', ChatHistory: '聊天记录',
    EmoteLaugh: '大笑', FreeDynamicCameraToggle: '自由动态视角',
    OnUIMouse4Pan: '鼠标4键平移', PlayerPingCursorDanger: '危险标记',
    QuickOpenEmoteWheel: '快捷表情轮盘',
  }

  const lolEventLabel = (event: string): string => lolEventLabels[event] ?? event

  const isRelevantLolBinding = (b: { event: string; key: string }): boolean => {
    if (!b.key || b.key === 'null' || b.key.includes('<Unbound>')) return false
    // Skip smart/normal cast variants and self-cast variants (they are modifiers, not primary binds)
    if (b.event.startsWith('evtSmartCast') || b.event.startsWith('evtNormalCast')
      || b.event.startsWith('evtSelfCast') || b.event.startsWith('evtSmartPlusSelfCast')
      || b.event.startsWith('evtSmartCastWithIndicator')) return false
    return true
  }

  // ─── Generate change set (preset-first, never blocked) ──────────────────

  // ─── Game auto-detection ─────────────────────────────────────────────────

  const detectAllGames = async () => {
    setIsDetectingGames(true)
    try {
      const response = await fetch(API_BASE + '/api/adapters/detect-all', { cache: 'no-store' })
      const result = await response.json()
      if (result.games) {
        setDetectedGames(result.games)
        setHasDetectedGames(true)
        setDetectedCount(result.detected ?? 0)
        const adaptedCount = result.games.filter((g: DetectedGame) => g.hasAdapter && g.found).length
        const steamCount = result.steamGames?.length ?? 0
        setToast(`已检测到 ${result.detected} 个已安装游戏（${adaptedCount} 个已适配 / Steam库 ${steamCount} 个）`)

        // Dynamically generate GameDefinition for all selectable games without dedicated adapters
        const ue4Template = games.find((g) => g.id === '_engine-ue4')
        if (ue4Template) {
          const newAutoGames: GameDefinition[] = []
          const existingIds = new Set([...games.map((g) => g.id), ...customAdapters.map((g) => g.id), ...autoAdapterGames.map((g) => g.id)])
          for (const g of result.games) {
            if (g.hasAdapter && g.found && !existingIds.has(g.gameId)) {
              const isUe4 = g.engineType === 'ue4'
              const isUnity = g.engineType === 'unity'
              const adapterLabel = isUe4
                ? 'UE4 Input.ini (自动检测)'
                : isUnity
                  ? 'Unity 通用配置 (自动检测)'
                  : '通用配置 (可尝试)'
              const correctConfigFileName = g.configFileName || (isUe4 ? 'Input.ini' : 'settings.ini')
              const correctConfigFormat = isUe4 ? 'ue4-ini' : (correctConfigFileName.endsWith('.json') ? 'json' : 'ini')
              // For non-UE4 games, override writeStrategies configFileName to use the correct file
              let gameWriteStrategies = undefined
              if (!isUe4 && ue4Template.writeStrategies) {
                gameWriteStrategies = ue4Template.writeStrategies.map((s) => ({
                  ...s,
                  configFileName: correctConfigFileName,
                  configFormat: correctConfigFormat,
                  name: s.name.replace('Input.ini', correctConfigFileName),
                }))
              }
              // Set correct nativeNames for known games (avoid relying on post-read update)
              let gameNativeNames = { ...ue4Template.nativeNames }
              if (correctConfigFileName === 'KMInput.json') {
                // Battlerite native action names (only use valid ActionId keys)
                gameNativeNames = {
                  ...ue4Template.nativeNames,
                  forward: 'Move.Y.Pos',
                  back: 'Move.Y.Neg',
                  left: 'Move.X.Neg',
                  right: 'Move.X.Pos',
                  ability1: 'Ability1',
                  ability2: 'Ability2',
                  ability3: 'Ability3',
                  ultimate: 'Ability4',
                  summoner1: 'EX.Modifier',
                  interact: 'UI.Misc',
                  jump: 'Jump',
                  map: 'TopDownCamera.NextTarget',
                }
              }
              newAutoGames.push({
                ...ue4Template,
                id: g.gameId,
                name: g.name,
                color: g.color,
                configPathLabel: g.configPath ?? '',
                adapterLabel,
                configFormat: correctConfigFormat,
                configFileName: correctConfigFileName,
                writeStrategies: gameWriteStrategies,
                nativeNames: gameNativeNames,
                canWrite: true,
                notes: `${isUe4 ? '自动检测为 UE4/UE5 引擎游戏。' : isUnity ? '自动检测为 Unity 引擎游戏。' : '通用配置适配。'}${g.message} 动作名为标准命名，不同游戏可能不同，请在游戏内确认。如写入不生效，请尝试其他方案或在游戏内手动设置。`,
              } as GameDefinition)
            }
          }
          if (newAutoGames.length > 0) {
            setAutoAdapterGames((prev) => [...prev, ...newAutoGames])
          }
        }
      }
    } catch {
      setToast('检测已安装游戏失败')
    } finally {
      setIsDetectingGames(false)
    }
  }

  // ─── Custom (auto-generated) adapters ────────────────────────────────────

  const loadCustomAdapters = async () => {
    try {
      const response = await fetch(API_BASE + '/api/adapters/custom/list', { cache: 'no-store' })
      const result = await response.json()
      if (result.success && result.adapters) {
        setCustomAdapters(result.adapters)
      }
    } catch { /* silent fail */ }
  }

  const generateAdapter = async (steamAppId: string, gameName: string) => {
    setIsGeneratingAdapter(true)
    try {
      const response = await fetch(API_BASE + '/api/adapters/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ steamAppId }),
      })
      const result = await response.json()
      if (result.success) {
        setToast(`已为 ${gameName} 生成适配器，可在游戏选择器中选择`)
        void loadCustomAdapters()
        setExpandedGameId(null)
      } else {
        setToast(`生成适配器失败：${result.message}`)
      }
    } catch {
      setToast('生成适配器失败')
    } finally {
      setIsGeneratingAdapter(false)
    }
  }

  // Load custom adapters on mount
  useEffect(() => { void loadCustomAdapters() }, [])

  // ─── Local preset management (universal middle layer) ───────────────────

  const refreshLocalPresets = async () => {
    setIsLoadingPresets(true)
    try {
      const response = await fetch(API_BASE + '/api/presets/list', { cache: 'no-store' })
      const result = await response.json()
      if (result.presets) {
        setLocalPresets(result.presets)
        setPresetsDir(result.presetsDir ?? '')
      }
    } catch {
      // Silent fail - presets are optional
    } finally {
      setIsLoadingPresets(false)
    }
  }

  const saveProfileToLocal = async () => {
    const bindingsMap: Partial<Record<ActionId, string>> = {}
    for (const binding of activeProfile.bindings) {
      if (binding.key) bindingsMap[binding.id] = binding.key
    }
    const preset = {
      id: activeProfile.id,
      name: activeProfile.name,
      category: activeProfile.category ?? 'universal',
      note: activeProfile.note,
      sourceGame: activeGame.id,
      sourceMode: activeProfile.name.toLowerCase().includes('wasd') ? 'wasd' : 'traditional',
      bindings: bindingsMap,
    }
    try {
      const response = await fetch(API_BASE + '/api/presets/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(preset),
      })
      const result = await response.json()
      if (result.success) {
        setToast(`已保存到本地预设：${result.filePath ?? activeProfile.name}`)
        void refreshLocalPresets()
      } else {
        setToast(`保存失败：${result.message}`)
      }
    } catch {
      setToast('保存本地预设失败')
    }
  }

  const loadLocalPreset = async (presetId: string) => {
    try {
      const response = await fetch(`/api/presets/load?id=${encodeURIComponent(presetId)}`, { cache: 'no-store' })
      const result = await response.json()
      if (result.success && result.preset) {
        const preset = result.preset as LocalPreset
        const newBindings = createBindings(preset.bindings)
        const newProfile: Profile = {
          id: `local-${preset.id}`,
          name: preset.name,
          note: preset.note ?? `从本地预设加载 · ${preset.sourceGame ?? '未知来源'}`,
          category: preset.category,
          bindings: newBindings,
        }
        setProfiles((prev) => {
          const existing = prev.find((p) => p.id === newProfile.id)
          if (existing) {
            return prev.map((p) => p.id === newProfile.id ? newProfile : p)
          }
          return [...prev, newProfile]
        })
        setActiveProfileId(newProfile.id)
        setToast(`已加载本地预设「${preset.name}」（${preset.bindings ? Object.keys(preset.bindings).length : 0} 个绑定）`)
      } else {
        setToast(`加载失败：${result.message}`)
      }
    } catch {
      setToast('加载本地预设失败')
    }
  }

  const deleteLocalPreset = async (presetId: string, presetName: string) => {
    try {
      const response = await fetch(API_BASE + '/api/presets/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: presetId }),
      })
      const result = await response.json()
      if (result.success) {
        setToast(`已删除本地预设「${presetName}」`)
        void refreshLocalPresets()
      } else {
        setToast(`删除失败：${result.message}`)
      }
    } catch {
      setToast('删除本地预设失败')
    }
  }

  const exportPresetFile = () => {
    const bindingsMap: Partial<Record<ActionId, string>> = {}
    for (const binding of activeProfile.bindings) {
      if (binding.key) bindingsMap[binding.id] = binding.key
    }
    const preset = {
      version: '1.0',
      id: activeProfile.id,
      name: activeProfile.name,
      category: activeProfile.category ?? 'universal',
      note: activeProfile.note,
      sourceGame: activeGame.id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      bindings: bindingsMap,
    }
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeProfile.name.replace(/\s+/g, '_')}.keyforge.json`
    a.click()
    URL.revokeObjectURL(url)
    setToast(`已导出预设文件：${a.download}`)
  }

  const importPresetFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const preset = JSON.parse(reader.result as string) as LocalPreset
        if (!preset.bindings) {
          setToast('无效的预设文件：缺少 bindings 字段')
          return
        }
        const newBindings = createBindings(preset.bindings)
        const newProfile: Profile = {
          id: `import-${preset.id ?? Date.now()}`,
          name: preset.name ?? '导入的预设',
          note: preset.note ?? `从文件导入 · ${preset.sourceGame ?? '未知来源'}`,
          category: preset.category,
          bindings: newBindings,
        }
        setProfiles((prev) => [...prev, newProfile])
        setActiveProfileId(newProfile.id)
        setToast(`已导入预设「${newProfile.name}」`)
      } catch {
        setToast('导入失败：无效的 JSON 文件')
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  // Load local presets on mount
  useEffect(() => { void refreshLocalPresets() }, [])

  const generateChangeSet = () => {
    setShowPreview(true)
    setShowNativeText(true)
    setWriteResult(null)
    setToast(`已基于「${activeProfile.name}」生成 ${activeGame.name} 的原生变更集（${patchSet.changedCount} 项变更）`)
  }

  // ─── Batch ESDF workbench ──────────────────────────────────────────────────

  const loadEsdfCandidates = async (autoOpen = false) => {
    setIsLoadingEsdf(true)
    setEsdfBatchResult(null)
    try {
      const response = await fetch(API_BASE + '/api/adapters/esdf-candidates', { cache: 'no-store' })
      const result = await response.json()
      if (!result.success) {
        setToast(result.message || '扫描 ESDF 候选失败')
        return
      }
      const list: EsdfCandidate[] = result.candidates ?? []
      setEsdfCandidates(list)
      setEsdfSummary(result.message ?? '')
      // Auto-select all migratable
      const next = new Set(list.filter((c) => c.canMigrate).map((c) => c.gameId))
      setEsdfSelected(next)
      if (autoOpen) setShowEsdfWorkbench(true)
      setToast(result.message || `已分析 ${list.length} 款游戏的配置`)
    } catch {
      setToast('无法连接 ESDF 扫描服务')
    } finally {
      setIsLoadingEsdf(false)
    }
  }

  const toggleEsdfSelect = (gameId: string) => {
    setEsdfSelected((prev) => {
      const next = new Set(prev)
      if (next.has(gameId)) next.delete(gameId)
      else next.add(gameId)
      return next
    })
  }

  const selectAllMigratable = () => {
    setEsdfSelected(new Set(esdfCandidates.filter((c) => c.canMigrate).map((c) => c.gameId)))
  }

  const clearEsdfSelection = () => setEsdfSelected(new Set())

  const runBatchEsdf = async () => {
    const ids = [...esdfSelected]
    if (ids.length === 0) {
      setToast('请先勾选要迁移的游戏')
      return
    }
    if (!window.confirm(
      `确认对选中的 ${ids.length} 款游戏执行 WASD→ESDF 整体右移吗？\n\n` +
      '· 只改配置文件里的字母键位，不碰数字/鼠标/修饰键\n' +
      '· Q/A/Z 会空出，请到游戏内自行安排\n' +
      '· 每款写入前自动备份，可从备份恢复\n' +
      '· 请先完全退出这些游戏',
    )) {
      setToast('已取消批量迁移')
      return
    }
    setIsBatchMigrating(true)
    setEsdfBatchResult(null)
    try {
      const response = await fetch(API_BASE + '/api/adapters/esdf-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameIds: ids }),
      })
      const result = await response.json()
      setEsdfBatchResult(result)
      setToast(result.message || '批量迁移完成')
      // Refresh candidate list to reflect new layout
      await loadEsdfCandidates(false)
    } catch {
      setToast('批量迁移失败：无法连接本地服务')
    } finally {
      setIsBatchMigrating(false)
    }
  }

  // ─── One-click ESDF migration (read real config → shift letter keys → write back) ──

  const migrateEsdfOneClick = async () => {
    if (!window.confirm(
      `确认对「${activeGame.name}」执行一键 ESDF 迁移吗？\n\n` +
      '将读取游戏配置文件，把 Q/W/E/R/A/S/D/F/Z/X/C/V 等字母键整体右移（WASD→ESDF），QAZ 空出。\n' +
      '写入前会自动备份原文件。请先完全退出游戏。',
    )) {
      setToast('已取消 ESDF 迁移')
      return
    }
    setIsMigratingEsdf(true)
    setWriteResult(null)
    try {
      // Optional: pass current profile custom keys for non-default actions
      const customKeys: Record<string, string> = {}
      for (const b of activeProfile.bindings) {
        if (!b.key) continue
        // Only send keys that look customized (not the classic WASD defaults)
        const wasdDefaults: Record<string, string> = {
          forward: 'W', left: 'A', back: 'S', right: 'D',
          ability1: 'Q', ability2: 'E', ability3: 'R', ultimate: 'F',
          interact: 'E', jump: 'Space',
        }
        const defaultVal = wasdDefaults[b.id]
        if (defaultVal && b.key.toUpperCase() === defaultVal.toUpperCase()) continue
        // If already ESDF movement, skip (pure shift will handle letters)
        if (['forward', 'left', 'back', 'right'].includes(b.id)) continue
        customKeys[b.id] = b.key
      }

      const response = await fetch(API_BASE + '/api/adapters/esdf-migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: activeGame.id,
          configPath: activeGame.configPathLabel || undefined,
          fileName: activeConfigFileName || undefined,
          customKeys: Object.keys(customKeys).length > 0 ? customKeys : undefined,
        }),
      })
      const result = await response.json()
      setWriteResult({ success: result.success, message: result.message })
      if (result.success) {
        // Sync UI profile to ESDF layout
        shiftBindingsRight()
        const now = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date())
        setRestorePoints((points) => [{
          id: `restore-${Date.now()}`,
          gameId: activeGame.id,
          gameName: activeGame.name,
          profileName: `ESDF迁移 · ${activeProfile.name}`,
          timestamp: `今天 ${now}`,
          backupPath: result.backupPath ?? '',
          originalPath: result.writtenPath ?? '',
        }, ...points])
        setToast(result.skipped
          ? (result.message || `${activeGame.name} 已是 ESDF 布局，无需迁移`)
          : result.changedCount > 0
            ? `已对 ${activeGame.name} 完成 ESDF 迁移（${result.changedCount} 处改动），请重启游戏`
            : (result.message || `已处理 ${activeGame.name}，未发现可右移的键`))
      } else {
        setToast(`ESDF 迁移失败：${result.message}`)
      }
    } catch {
      setWriteResult({ success: false, message: '无法连接本地迁移服务' })
      setToast('ESDF 迁移失败：无法连接本地服务')
    } finally {
      setIsMigratingEsdf(false)
    }
  }

  // ─── Write config to game (only for canWrite games) ─────────────────────

  const writeConfig = async () => {
    if (!activeGame.canWrite) {
      setToast(`${activeGame.name} 暂不支持自动写入`)
      return
    }
    if (activeStrategy?.implemented === false) {
      setToast(`方案「${activeStrategy.name}」尚未实现，请选择其他方案`)
      return
    }
    const strategyName = activeStrategy?.name ?? ''
    const writeTarget = isLol && activeStrategyId === 'lol-lcu-cloud'
      ? '英雄联盟客户端云端设置（LCU API）'
      : `${activeGame.name} 本地配置文件（${strategyName || activeConfigFileName}）`
    if (!window.confirm(`确认将当前「${activeProfile.name}」写入${writeTarget}吗？\n写入前会尽量创建备份。${strategyName ? `\n使用方案：${strategyName}` : ''}`)) {
      setToast('已取消写入')
      return
    }
    setIsWriting(true)
    setWriteResult(null)
    try {
      const response = await fetch(API_BASE + '/api/adapters/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: activeGame.id,
          profileName: activeProfile.name,
          modeId: activeModeId,
          configPath: activeGame.configPathLabel || undefined,
          configText: nativeConfigText,
          fileName: activeConfigFileName,
          strategyId: activeStrategyId || undefined,
          configFormat: activeConfigFormat,
        }),
      })
      const result = await response.json()
      setWriteResult({ success: result.success, message: result.message })
      if (result.success) {
        setToast(result.backupPath
          ? `已写入 ${activeGame.name} 配置（备份已创建）`
          : `已写入 ${activeGame.name} 配置`)
        // Add restore point
        const now = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date())
        setRestorePoints((points) => [{
          id: `restore-${Date.now()}`,
          gameId: activeGame.id,
          gameName: activeGame.name,
          profileName: activeProfile.name,
          timestamp: `今天 ${now}`,
          backupPath: result.backupPath ?? '',
          originalPath: result.writtenPath ?? '',
        }, ...points])
      } else {
        setToast(`写入失败：${result.message}`)
      }
    } catch {
      setWriteResult({ success: false, message: '无法连接本地写入服务' })
      setToast('写入配置失败')
    } finally {
      setIsWriting(false)
    }
  }

  const downloadConfig = () => {
    const blob = new Blob([nativeConfigText], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = getConfigFileName(activeGame.id)
    a.click()
    URL.revokeObjectURL(url)
    setToast(`已导出 ${getConfigFileName(activeGame.id)}`)
  }

  const visibleActions = supportedBindings.filter((action) => activeCategory === 'all' || action.category === activeCategory)

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="workspace-header">
          <div>
            <div className="breadcrumb">控制中心 <span>/</span> {({ config: '配置档', personal: '个人方案', games: '游戏迁移', sync: '实时显示' } as const)[activePage]}</div>
            <div className="title-row">
              <h1>{activePage === 'personal' ? '个人方案' : activePage === 'games' ? '游戏迁移' : '实时按键显示'}</h1>
            </div>
          </div>
          <div className="page-tabs">
            <button className={`page-tab ${activePage === 'personal' ? 'is-active' : ''}`} onClick={() => setActivePage('personal')}>
              <UserRound size={14} /> 个人方案
            </button>
            <button className={`page-tab ${activePage === 'games' ? 'is-active' : ''}`} onClick={() => setActivePage('games')}>
              <ArrowRightLeft size={14} /> 游戏迁移
            </button>
            <button className={`page-tab ${activePage === 'sync' ? 'is-active' : ''}`} onClick={() => setActivePage('sync')}>
              <Activity size={14} /> 实时显示
            </button>
          </div>
          <div className="header-actions">

          </div>
        </header>

        {activePage === 'personal' && <PersonalProfilePage onToast={setToast} pressedKeys={pressedKeys} pressedButtons={pressedMouseButtons} />}
        {activePage === 'games' && <BatchPage onToast={setToast} />}

        {activePage === 'sync' && (
          <section className="realtime-page">
            {/* 第一行：显示模式 + 悬浮窗控制 */}
            <div className="display-mode-bar">
              <span className="display-mode-label">显示模式：</span>
              <div className="display-mode-buttons">
                {[
                  { id: 'keys-only', label: '仅按键' },
                  { id: 'game', label: '游戏模式' },
                  { id: 'full', label: '全键盘' },
                  { id: 'custom1', label: '自定义1' },
                  { id: 'custom2', label: '自定义2' },
                  { id: 'custom3', label: '自定义3' },
                ].map((mode) => (
                  <div key={mode.id} className="mode-with-mouse-toggle">
                    <button
                      className={`overlay-mode-btn ${overlayMode === mode.id ? 'is-active' : ''}`}
                      onClick={async () => {
                        setOverlayMode(mode.id)
                        // If switching to a custom mode, load its key set
                        if (mode.id.startsWith('custom')) {
                          const keys = customKeySets[mode.id] || []
                          setCustomKeys(keys)
                          try {
                            await fetch('http://127.0.0.1:4175/api/overlay/custom-keys', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ keys }),
                            })
                          } catch (err) {
                            console.error('Set custom keys failed:', err)
                          }
                        }
                        // Apply this mode's mouse setting
                        const shouldShowMouse = showMouseForMode[mode.id] ?? false
                        setShowMouse(shouldShowMouse)
                        try {
                          await fetch('http://127.0.0.1:4175/api/overlay/mode', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ mode: mode.id.startsWith('custom') ? 'custom' : mode.id }),
                          })
                          await fetch('http://127.0.0.1:4175/api/overlay/show-mouse', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ show: shouldShowMouse }),
                          })
                        } catch (err) {
                          console.error('Set overlay mode failed:', err)
                        }
                      }}
                    >
                      {mode.label}
                    </button>
                    <button
                      className={`mouse-toggle-btn ${showMouseForMode[mode.id] ? 'is-active' : ''}`}
                      onClick={() => {
                        const newVal = !showMouseForMode[mode.id]
                        setShowMouseForMode(prev => ({ ...prev, [mode.id]: newVal }))
                        // If this is the current mode, apply immediately
                        if (overlayMode === mode.id) {
                          setShowMouse(newVal)
                          fetch('http://127.0.0.1:4175/api/overlay/show-mouse', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ show: newVal }),
                          }).catch(console.error)
                        }
                      }}
                      title={showMouseForMode[mode.id] ? '隐藏鼠标' : '显示鼠标'}
                    >
                      🖱
                    </button>
                  </div>
                ))}
              </div>
              <div className="display-mode-right">
                <label className="full104-toggle">
                  <input
                    type="checkbox"
                    checked={showFull104}
                    onChange={(e) => setShowFull104(e.target.checked)}
                  />
                  <span>104键</span>
                </label>
                <button
                  className={`overlay-toggle-btn ${overlayVisible ? 'is-active' : ''}`}
                  onClick={async () => {
                    try {
                      const resp = await fetch('http://127.0.0.1:4175/api/overlay/toggle', { method: 'POST' })
                      const data = await resp.json()
                      setOverlayVisible(data.visible)
                    } catch (err) {
                      console.error('Toggle overlay failed:', err)
                    }
                  }}
                >
                  {overlayVisible ? '👁 隐藏悬浮窗' : '👁 显示悬浮窗'}
                </button>
                <button
                  className={`overlay-toggle-btn ${overlayLocked ? 'is-active' : ''}`}
                  onClick={async () => {
                    const newVal = !overlayLocked
                    setOverlayLocked(newVal)
                    try {
                      await fetch('http://127.0.0.1:4175/api/overlay/lock', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ locked: newVal }),
                      })
                    } catch (err) {
                      console.error('Set lock failed:', err)
                    }
                  }}
                >
                  {overlayLocked ? '🔒 已锁定' : '🔓 未锁定'}
                </button>
              </div>
            </div>

            {/* 统一调整面板（可收起展开，两排并排式结构） */}
            <div className="keyboard-adjust-bar">
              <div className="adjust-bar-header" onClick={() => setShowKeyboardAdjust(!showKeyboardAdjust)}>
                <div className="keyboard-adjust-title">⚙ 调整面板</div>
                <span className="adjust-bar-toggle">{showKeyboardAdjust ? '▲' : '▼'}</span>
              </div>
              {showKeyboardAdjust && (
              <div className="adjust-items-grid">
                {/* 第一排 */}
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>缩放</label>
                    <span>{keyboardScale}%</span>
                  </div>
                  <input type="range" min="50" max="150" value={keyboardScale}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setKeyboardScale(val)
                      fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ scale: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>透明度</label>
                    <span>{keyboardOpacity}%</span>
                  </div>
                  <input type="range" min="30" max="100" value={keyboardOpacity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setKeyboardOpacity(val)
                      fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ opacity: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <label>高亮色</label>
                  <div className="color-picker-row">
                    <input
                      type="color"
                      value={keyboardHighlightColor}
                      onChange={(e) => {
                        const val = e.target.value
                        setKeyboardHighlightColor(val)
                        fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ highlightColor: val }),
                        }).catch(console.error)
                      }}
                      className="color-input"
                    />
                    {['#00d4ff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7'].map(color => (
                      <button
                        key={color}
                        className={`color-dot ${keyboardHighlightColor === color ? 'is-active' : ''}`}
                        style={{ background: color }}
                        onClick={() => {
                          setKeyboardHighlightColor(color)
                          fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ highlightColor: color }),
                          }).catch(console.error)
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>高光透明度</label>
                    <span>{keyboardHighlightOpacity}%</span>
                  </div>
                  <input type="range" min="10" max="100" value={keyboardHighlightOpacity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setKeyboardHighlightOpacity(val)
                      fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ highlightOpacity: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>X偏移</label>
                    <span>{mouseSettings.x}</span>
                  </div>
                  <input type="range" min="-100" max="100" value={mouseSettings.x}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setMouseSettings(s => ({ ...s, x: val }))
                      fetch('http://127.0.0.1:4175/api/overlay/mouse-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ x: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>Y偏移</label>
                    <span>{mouseSettings.y}</span>
                  </div>
                  <input type="range" min="-100" max="200" value={mouseSettings.y}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setMouseSettings(s => ({ ...s, y: val }))
                      fetch('http://127.0.0.1:4175/api/overlay/mouse-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ y: val }),
                      }).catch(console.error)
                    }} />
                </div>
                {/* 第二排 */}
                <div className="adjust-row-item">
                  <label>主题</label>
                  <div className="theme-toggle-row">
                    <button
                      className={`theme-btn ${overlayTheme === 'white' ? 'is-active' : ''}`}
                      onClick={() => {
                        setOverlayTheme('white')
                        fetch('http://127.0.0.1:4175/api/overlay/theme', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ theme: 'white' }),
                        }).catch(console.error)
                      }}
                    >⬜ 白色</button>
                    <button
                      className={`theme-btn ${overlayTheme === 'black' ? 'is-active' : ''}`}
                      onClick={() => {
                        setOverlayTheme('black')
                        fetch('http://127.0.0.1:4175/api/overlay/theme', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ theme: 'black' }),
                        }).catch(console.error)
                      }}
                    >⬛ 黑色</button>
                  </div>
                </div>
                <div className="adjust-row-item">
                  <label>重置</label>
                  <button className="adjust-reset-btn" onClick={() => {
                    setKeyboardScale(100)
                    setKeyboardOpacity(100)
                    setKeyboardHighlightColor('#00d4ff')
                    setKeyboardHighlightOpacity(100)
                  }}>恢复默认</button>
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>宽度</label>
                    <span>{mouseSettings.width}</span>
                  </div>
                  <input type="range" min="100" max="350" value={mouseSettings.width}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setMouseSettings(s => ({ ...s, width: val }))
                      fetch('http://127.0.0.1:4175/api/overlay/mouse-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ width: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>高度</label>
                    <span>{mouseSettings.height}</span>
                  </div>
                  <input type="range" min="100" max="350" value={mouseSettings.height}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setMouseSettings(s => ({ ...s, height: val }))
                      fetch('http://127.0.0.1:4175/api/overlay/mouse-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ height: val }),
                      }).catch(console.error)
                    }} />
                </div>
              </div>
              )}
            </div>

            <div className="realtime-main-layout">
              {/* 左侧栏：当前按键 + 鼠标状态 */}
              <div className="realtime-left-panel">
                <div className="realtime-card realtime-current-keys">
                  <h3>当前按键</h3>
                  <div className="realtime-keys-display">
                    {pressedKeys.size === 0 && pressedMouseButtons.size === 0 ? (
                      <span className="realtime-placeholder">等待按键输入...</span>
                    ) : (
                      <>
                        {Array.from(pressedKeys).map((key) => {
                          const keyImg = getKeyAsset(key)
                          return (
                            <span key={key} className="realtime-keycap has-image">
                              {keyImg ? (
                                <img src={keyImg} alt={key} className="keycap-img" />
                              ) : (
                                key === 'Space' ? '空格' : key
                              )}
                            </span>
                          )
                        })}
                        {Array.from(pressedMouseButtons).map((btn) => {
                          const label = btn === 'left' ? '左键' : btn === 'right' ? '右键' : btn === 'middle' ? '中键' : btn === 'x1' ? '侧键1' : '侧键2'
                          const mouseImg = getMouseAsset(btn)
                          const badge = getMouseBadge(btn)
                          return (
                            <span key={btn} className="realtime-keycap is-mouse has-image">
                              {mouseImg ? (
                                <span className="keycap-img-wrapper">
                                  <img src={mouseImg} alt={label} className="keycap-img" />
                                  {badge && <span className="keycap-badge">{badge}</span>}
                                </span>
                              ) : (
                                label
                              )}
                            </span>
                          )
                        })}
                      </>
                    )}
                  </div>
                </div>

                <div className="realtime-card">
                  <h3>鼠标状态</h3>
                  <div className="realtime-mouse-display">
                    {[
                      { id: 'left', label: '左键' },
                      { id: 'right', label: '右键' },
                      { id: 'middle', label: '中键' },
                      { id: 'x1', label: '侧键1' },
                      { id: 'x2', label: '侧键2' },
                    ].map((btn) => {
                      const mouseImg = getMouseAsset(btn.id)
                      const badge = getMouseBadge(btn.id)
                      return (
                        <div key={btn.id} className={`realtime-mouse-btn ${pressedMouseButtons.has(btn.id) ? 'is-pressed' : ''}`}>
                          {mouseImg ? (
                            <span className="mouse-btn-img-wrapper">
                              <img src={mouseImg} alt={btn.label} className="mouse-btn-img" />
                              {badge && <span className="mouse-btn-badge">{badge}</span>}
                            </span>
                          ) : (
                            <span className="mouse-btn-icon" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* 右侧主内容：实时键盘可视化 */}
              <div className="realtime-right-panel">
                <div className="realtime-card">
                  <div className="realtime-card-header">
                    <h3>实时键盘可视化</h3>
                    <div className="realtime-card-actions">
                      {isEditingCustom ? (
                        <>
                          <span className="custom-edit-hint">已选 {customKeys.length} 个</span>
                          <button
                            className="overlay-toggle-btn is-active"
                            onClick={async () => {
                              setIsEditingCustom(false)
                              // Save to current custom mode's key set
                              if (overlayMode.startsWith('custom')) {
                                setCustomKeySets(prev => ({
                                  ...prev,
                                  [overlayMode]: [...customKeys],
                                }))
                              }
                              try {
                                await fetch('http://127.0.0.1:4175/api/overlay/custom-keys', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ keys: customKeys }),
                                })
                                setToast('自定义按键已保存')
                              } catch (err) {
                                console.error('Save custom keys failed:', err)
                              }
                            }}
                          >
                            ✓ 保存
                          </button>
                          <button
                            className="overlay-toggle-btn"
                            onClick={() => {
                              setIsEditingCustom(false)
                              setCustomKeys(['W', 'A', 'S', 'D', 'Space'])
                            }}
                          >
                            ✕ 取消
                          </button>
                        </>
                      ) : (
                        <button
                          className="overlay-toggle-btn"
                          onClick={() => setIsEditingCustom(true)}
                        >
                          ✎ 编辑自定义
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`realtime-keyboard-full ${isEditingCustom ? 'is-editing' : ''} ${showFull104 ? 'is-104' : ''}`}>
                    <KeyboardMap
                      bindings={activeProfile.bindings}
                      selectedActionId={'' as ActionId}
                      onAssign={(key) => {
                        if (isEditingCustom) {
                          setCustomKeys(prev => {
                            if (prev.includes(key)) {
                              return prev.filter(k => k !== key)
                            } else {
                              return [...prev, key]
                            }
                          })
                        }
                      }}
                      pressedKeys={pressedKeys}
                      customKeys={isEditingCustom ? customKeys : null}
                      full104={showFull104}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 底部：按键历史（可展开/收起） */}
            <div className="realtime-card realtime-history-card">
              <div className="history-header" onClick={() => setHistoryExpanded(!historyExpanded)}>
                <h3>按键历史 <span className="realtime-history-count">最近 {inputHistory.length} 条</span></h3>
                <span className="history-toggle-icon">{historyExpanded ? '▲' : '▼'}</span>
              </div>
              {historyExpanded && (
                <div className="realtime-history-list">
                  {inputHistory.length === 0 ? (
                    <span className="realtime-placeholder">暂无按键记录</span>
                  ) : (
                    inputHistory.map((event, index) => (
                      <div key={`${event.time}-${index}`} className={`realtime-history-item ${event.state === 'down' ? 'is-down' : 'is-up'} ${index === 0 ? 'is-latest' : ''}`}>
                        <span className="history-key">{event.key}</span>
                        <span className="history-state">{event.state === 'down' ? '按下' : '释放'}</span>
                        <span className="history-time">{new Date(event.time).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </section>

      {toast && <div className="toast" role="status"><Check size={16} />{toast}<button onClick={() => setToast('')} aria-label="关闭提示"><X size={15} /></button></div>}
    </main>
  )
}

export default App
