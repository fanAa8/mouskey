// Shared adapter types for Keyforge
// These types are used by both the frontend (patch generation, preview)
// and the backend (file detection, backup, write, restore).

export type Category = 'movement' | 'combat' | 'abilities' | 'summoner' | 'items' | 'system'
export type Device = 'keyboard' | 'mouse'

export type ActionId =
  // 移动 (WASD movement — FPS/RPG/WASD-MOBA)
  | 'forward'
  | 'left'
  | 'back'
  | 'right'
  // 操作 (mouse actions)
  | 'primary'
  | 'secondary'
  // 技能 (abilities)
  | 'ability1'
  | 'ability2'
  | 'ability3'
  | 'ultimate'
  // 召唤师技能 (MOBA summoner spells)
  | 'summoner1'
  | 'summoner2'
  // 物品 (items)
  | 'interact'
  | 'inventory1'
  | 'inventory2'
  | 'inventory3'
  | 'inventory4'
  | 'inventory5'
  | 'inventory6'
  | 'trinket'
  | 'role_quest'
  // 系统 (system / utility)
  | 'jump'
  | 'map'
  | 'ping'
  | 'recall'
  | 'shop'
  | 'camera_snap'
  | 'camera_lock'
  | 'stop'
  | 'hold_position'
  | 'attack_move'
  | 'cancel_cast'
  | 'confirm_cast'

export type ControlAction = {
  id: ActionId
  label: string
  detail: string
  category: Category
  key: string
  device: Device
}

export type ProfileCategory = 'moba' | 'fps' | 'wasd' | 'keyboard-only' | 'survival' | 'universal'

export type Profile = {
  id: string
  name: string
  note: string
  category?: ProfileCategory
  bindings: ControlAction[]
}

/**
 * Local preset file format — the universal middle layer.
 *
 * Flow: A账号游戏 → 读取 → 保存为本地预设文件 → B账号/C游戏 从本地预设应用
 * Once saved locally, the preset can be applied to ANY game without
 * re-reading the source account.
 *
 * File location: %USERPROFILE%\Documents\Keyforge\presets\<id>.json
 * File extension: .keyforge.json (or .json)
 */
export type LocalPreset = {
  /** Format version for future compatibility */
  version: string
  /** Unique preset ID (used as filename) */
  id: string
  /** Human-readable name */
  name: string
  /** Preset category */
  category?: ProfileCategory
  /** Optional note / description */
  note?: string
  /** Game ID this preset was imported from (e.g. 'league-of-legends') */
  sourceGame?: string
  /** Game mode this preset was imported from (e.g. 'traditional', 'wasd') */
  sourceMode?: string
  /** Creation timestamp (ISO 8601) */
  createdAt: string
  /** Last update timestamp (ISO 8601) */
  updatedAt: string
  /**
   * Core bindings: actionId → key value.
   * This is the universal format — can be applied to ANY game via its adapter.
   * Keys are in Keyforge standard format: 'Q', 'Mouse 1', 'Space', 'Tab', etc.
   */
  bindings: Partial<Record<ActionId, string>>
}

/** Result of listing local presets */
export type PresetListResult = {
  success: boolean
  message: string
  presets: Array<Pick<LocalPreset, 'id' | 'name' | 'category' | 'note' | 'sourceGame' | 'sourceMode' | 'createdAt' | 'updatedAt'> & { bindingCount: number; filePath: string }>
  presetsDir: string
}

/** Result of saving a local preset */
export type PresetSaveResult = {
  success: boolean
  message: string
  presetId?: string
  filePath?: string
}

/** Result of loading a local preset */
export type PresetLoadResult = {
  success: boolean
  message: string
  preset?: LocalPreset
  filePath?: string
}

/** Result of deleting a local preset */
export type PresetDeleteResult = {
  success: boolean
  message: string
  presetId?: string
}

export type NativeLolBinding = { event: string; key: string; section: string }

export type LolReadResult = {
  status: 'found' | 'partial' | 'not_found' | 'error' | 'gamecfg_only'
  message: string
  source?: string
  persistedSettingsPath?: string | null
  inputPath?: string | null
  gameCfgPath?: string | null
  traditional?: {
    bindings: NativeLolBinding[]
    quickbinds: Record<string, string>
  }
  wasd?: {
    movementRotation: string | null
    cameraMode: string | null
    bindings: NativeLolBinding[]
  }
  /** Legacy: traditional mode bindings (same as traditional.bindings) */
  bindings?: NativeLolBinding[]
  inputIniEntries?: { section: string; key: string; value: string }[]
  candidates?: { source: string; gameCfgPath: string; inputPath: string; persistedSettingsPath?: string }[]
}

export type LolWatchResult = {
  status: 'idle' | 'watching' | 'captured'
  message: string
  events: { at: string; change: string; path: string }[]
}

export type GameMode = {
  id: string
  name: string
  section: string
}

export type LcuApiConfig = {
  supported: boolean
  inputSettingsEndpoint?: string
  gameSettingsEndpoint?: string
  quitGameEndpoint?: string
  gameflowPhaseEndpoint?: string
}

export type GameDefinition = {
  id: string
  name: string
  genre: string
  color: string
  adapterLabel: string
  /** Human-readable config path description shown in UI */
  configPathLabel: string
  /** Config file format: 'ini' | 'source-cfg' | 'riot-persisted-json' | 'json' | 'xml' */
  configFormat?: string
  /** Output config file name (e.g. 'keyforge.cfg', 'KeySettings.ini') */
  configFileName?: string
  /** Relative path from game install root to the config file (e.g. 'Game\\Config\\PersistedSettings.json') */
  configRelativePath?: string
  /** Detection strategy: 'path-scan' | 'steam' | 'documents' | 'lol-special' | 'registry' */
  detectionType?: string
  /** Steam App ID (for detectionType='steam') */
  steamAppId?: string
  /** Sub-path under Documents (for detectionType='documents', e.g. 'Klei\\DoNotStarve') */
  documentsSubPath?: string
  /** Possible installation paths, checked in order. Supports %USERPROFILE% env vars. */
  installPaths?: string[]
  /** Game operation modes (e.g. LoL traditional/wasd). Single-mode games have one entry. */
  modes?: GameMode[]
  defaultMode?: string
  /** Native field/command names for each action (default mode) */
  nativeNames: Partial<Record<ActionId, string>>
  /** Mode-specific native field overrides: { modeId: { actionId: nativeName } } */
  modeNativeNames?: Record<string, Partial<Record<ActionId, string>>>
  /** Default bindings shipped by the game (default mode, used for diff highlighting) */
  defaults: Partial<Record<ActionId, string>>
  /** Mode-specific default binding overrides */
  modeDefaults?: Record<string, Partial<Record<ActionId, string>>>
  /** Whether this adapter can safely write to the local filesystem */
  canWrite: boolean
  /** Reason why writing is not supported (shown when canWrite is false) */
  writeUnsupportedReason?: string
  /** Actions supported by this game. If specified, only these actions are shown/processed. If omitted, all actions are shown. */
  supportedActions?: ActionId[]
  /** Mode-specific action allow-list, used when a game exposes different native sections. */
  modeSupportedActions?: Record<string, ActionId[]>
  /** How changes take effect: 'restart' = need game restart, 'exec' = exec command in console, 'realtime' = instant */
  applyMethod?: 'restart' | 'exec' | 'realtime'
  /** Whether the game syncs keybindings to cloud */
  cloudSync?: boolean
  /** LCU API configuration (for Riot games) */
  lcuApi?: LcuApiConfig
}

/** A single binding change derived from the user's preset */
export type BindingPatch = {
  actionId: ActionId
  actionLabel: string
  nativeKey: string
  presetValue: string
  defaultValue: string | null
  changed: boolean
}

/** Result of generating patches from a user profile */
export type PatchSet = {
  gameId: string
  gameName: string
  /** Native mode used to resolve mode-specific fields (e.g. LoL WASD). */
  modeId?: string
  patches: BindingPatch[]
  changedCount: number
  totalCount: number
}

/** Backend response for game installation detection */
export type DetectResult = {
  gameId: string
  found: boolean
  configPath: string | null
  message: string
  candidates?: string[]
}

/** Backend response for reading current config */
export type ReadConfigResult = {
  gameId: string
  status: 'found' | 'partial' | 'not_found' | 'error'
  message: string
  configPath: string | null
  values?: Record<string, string>
  rawPreview?: string
}

/** Backend response for backup operation */
export type BackupResult = {
  gameId: string
  success: boolean
  message: string
  backupPath?: string
  originalPath?: string
  timestamp?: string
}

/** Backend response for write operation */
export type WriteResult = {
  gameId: string
  success: boolean
  message: string
  writtenPath?: string
  backupPath?: string
  linesWritten?: number
}

/** Backend response for restore operation */
export type RestoreResult = {
  gameId: string
  success: boolean
  message: string
  restoredPath?: string
}

/** A restore point stored locally */
export type RestorePoint = {
  id: string
  gameId: string
  gameName: string
  profileName: string
  timestamp: string
  backupPath: string
  originalPath: string
}
