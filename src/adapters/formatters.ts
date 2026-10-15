import type { PatchSet } from './types'
import { normalizeKey } from './patchGenerator'
import { getGame } from './games'

/**
 * Native config formatters.
 * Each function takes a PatchSet and returns the text that would be
 * written to the game's config file (or a keyforge-managed include file).
 *
 * These are pure functions — no filesystem access. They are used by
 * both the frontend (preview) and the backend (actual writing).
 *
 * Dispatch is data-driven: uses the game's configFormat field from the
 * JSON adapter, with gameId as fallback for backward compatibility.
 */

// ─── CS2: Source engine bind commands ──────────────────────────────────────

export function formatCs2Config(patchSet: PatchSet): string {
  const lines: string[] = [
    '// Keyforge generated config',
    `// Game: ${patchSet.gameName}`,
    `// Generated: ${new Date().toISOString()}`,
    '// To use: place in csgo/cfg/ and run "exec keyforge" in console,',
    '// or add "exec keyforge" to your autoexec.cfg',
  ]

  const categoryLabels: Record<string, string> = {
    movement: 'Movement',
    combat: 'Combat',
    abilities: 'Abilities',
    summoner: 'Summoner Spells',
    items: 'Items',
    system: 'System',
  }

  let lastCategory = ''
  for (const patch of patchSet.patches) {
    const cat = categoryForAction(patch.actionId)
    if (cat !== lastCategory) {
      lines.push('')
      lines.push(`// --- ${categoryLabels[cat]} ---`)
      lastCategory = cat
    }
    const key = normalizeKey(patch.presetValue).toLowerCase()
    const command = patch.nativeKey
    lines.push(`bind "${key}" "${command}"`)
  }

  lines.push('')
  lines.push('// --- End Keyforge config ---')
  return lines.join('\n')
}

// ─── CF: KeySettings.ini format ─────────────────────────────────────────────

export function formatCfConfig(patchSet: PatchSet): string {
  const lines: string[] = [
    '; Keyforge generated KeySettings',
    `; Game: ${patchSet.gameName}`,
    `; Generated: ${new Date().toISOString()}`,
    '',
    '[KeySettings]',
  ]

  for (const patch of patchSet.patches) {
    const key = normalizeKey(patch.presetValue)
    lines.push(`${patch.nativeKey}=${key}`)
  }

  lines.push('')
  return lines.join('\n')
}

// ─── 饥荒: settings.ini [MUTABLE] / controls format ────────────────────────

export function formatDontStarveConfig(patchSet: PatchSet): string {
  const lines: string[] = [
    '; Keyforge generated controls',
    `; Game: ${patchSet.gameName}`,
    `; Generated: ${new Date().toISOString()}`,
    '',
    '[controls]',
  ]

  for (const patch of patchSet.patches) {
    const key = normalizeKey(patch.presetValue).toLowerCase()
    lines.push(`${patch.nativeKey} = ${key}`)
  }

  lines.push('')
  return lines.join('\n')
}

// ─── LoL: Input.ini / LCU section format ──────────────────────────────────

export function formatLolConfig(patchSet: PatchSet): string {
  const sectionName = patchSet.modeId === 'wasd' ? 'WASD' : 'GameEvents'
  const lines: string[] = [
    '; Keyforge generated Input.ini',
    `; Game: ${patchSet.gameName}`,
    `; Generated: ${new Date().toISOString()}`,
    `; Written to PersistedSettings.json [${sectionName}] section`,
    '',
    `[${sectionName}]`,
  ]

  for (const patch of patchSet.patches) {
    const key = normalizeKey(patch.presetValue)
    lines.push(`${patch.nativeKey}=${key}`)
  }

  lines.push('')
  return lines.join('\n')
}

// ─── UE4/UE5: Input.ini AxisMappings / ActionMappings format ───────────────

/** Convert our normalized key names (MOUSE1, SPACE, W) to UE4 key names (LeftMouseButton, SpaceBar, W) */
export function normalizeKeyToUe4(key: string): string {
  const k = key.trim()
  // Mouse buttons
  if (k === 'Mouse 1' || k === 'MOUSE1') return 'LeftMouseButton'
  if (k === 'Mouse 2' || k === 'MOUSE2') return 'RightMouseButton'
  if (k === 'Mouse 3' || k === 'MOUSE3' || k === 'Mouse Wheel') return 'MiddleMouseButton'
  if (k === 'Mouse 4' || k === 'MOUSE4') return 'ThumbMouseButton'
  if (k === 'Mouse 5' || k === 'MOUSE5') return 'ThumbMouseButton2'
  // Special keys
  if (k === 'Space' || k === 'SPACE') return 'SpaceBar'
  if (k === 'Tab' || k === 'TAB') return 'Tab'
  if (k === 'Esc' || k === 'ESCAPE') return 'Escape'
  if (k === 'Enter' || k === 'ENTER') return 'Enter'
  if (k === 'Backspace' || k === 'BACKSPACE') return 'BackSpace'
  if (k === 'Shift' || k === 'SHIFT') return 'LeftShift'
  if (k === 'Shift R' || k === 'RSHIFT') return 'RightShift'
  if (k === 'Ctrl' || k === 'CTRL') return 'LeftControl'
  if (k === 'Ctrl R' || k === 'RCTRL') return 'RightControl'
  if (k === 'Alt' || k === 'ALT') return 'LeftAlt'
  if (k === 'Alt R' || k === 'RALT') return 'RightAlt'
  if (k === 'Caps' || k === 'CAPSLOCK') return 'CapsLock'
  // F keys
  if (/^F\d+$/.test(k)) return k
  // Single char keys: uppercase
  if (k.length === 1) return k.toUpperCase()
  return k
}

/**
 * Format a PatchSet as UE4/UE5 Input.ini content.
 * Movement (forward/back/left/right) becomes AxisMappings with Scale,
 * everything else becomes ActionMappings.
 */
export function formatUe4Config(patchSet: PatchSet): string {
  const lines: string[] = [
    '; Keyforge generated Input.ini',
    `; Game: ${patchSet.gameName}`,
    `; Generated: ${new Date().toISOString()}`,
    '; UE4/UE5 Enhanced Input / Legacy Input format',
    '',
    '[/Script/Engine.InputSettings]',
  ]

  // Axis mappings: movement (forward/back share one axis, left/right share another)
  const axisActions = new Map<string, { positive?: string; negative?: string }>()
  const actionMappings: { name: string; key: string }[] = []

  for (const patch of patchSet.patches) {
    const ue4Key = normalizeKeyToUe4(patch.presetValue)
    const nativeName = patch.nativeKey
    if (!nativeName) continue

    if (patch.actionId === 'forward') {
      if (!axisActions.has(nativeName)) axisActions.set(nativeName, {})
      axisActions.get(nativeName)!.positive = ue4Key
    } else if (patch.actionId === 'back') {
      if (!axisActions.has(nativeName)) axisActions.set(nativeName, {})
      axisActions.get(nativeName)!.negative = ue4Key
    } else if (patch.actionId === 'right') {
      if (!axisActions.has(nativeName)) axisActions.set(nativeName, {})
      axisActions.get(nativeName)!.positive = ue4Key
    } else if (patch.actionId === 'left') {
      if (!axisActions.has(nativeName)) axisActions.set(nativeName, {})
      axisActions.get(nativeName)!.negative = ue4Key
    } else {
      actionMappings.push({ name: nativeName, key: ue4Key })
    }
  }

  // Write axis mappings
  if (axisActions.size > 0) {
    lines.push('')
    lines.push('; --- Axis Mappings (movement) ---')
    for (const [axisName, keys] of axisActions) {
      if (keys.positive) {
        lines.push(`AxisMappings=(AxisName="${axisName}",Scale=1.000000,Key=${keys.positive})`)
      }
      if (keys.negative) {
        lines.push(`AxisMappings=(AxisName="${axisName}",Scale=-1.000000,Key=${keys.negative})`)
      }
    }
  }

  // Write action mappings
  if (actionMappings.length > 0) {
    lines.push('')
    lines.push('; --- Action Mappings ---')
    for (const { name, key } of actionMappings) {
      lines.push(`ActionMappings=(ActionName="${name}",Key=${key})`)
    }
  }

  lines.push('')
  return lines.join('\n')
}

// ─── Dispatcher (data-driven via configFormat) ─────────────────────────────

export function formatNativeConfig(patchSet: PatchSet, overrideFormat?: string): string {
  // Look up the game definition to get configFormat, unless overridden
  const game = getGame(patchSet.gameId)
  const format = overrideFormat ?? game.configFormat

  // Dispatch by configFormat (data-driven)
  switch (format) {
    case 'source-cfg':
      return formatCs2Config(patchSet)
    case 'ue4-ini':
      return formatUe4Config(patchSet)
    case 'ini':
      // INI format varies by game; use gameId for exact syntax
      return formatByGameId(patchSet)
    case 'riot-persisted-json':
      return formatLolConfig(patchSet)
    default:
      // Fallback to gameId-based dispatch for backward compatibility
      return formatByGameId(patchSet)
  }
}

/** GameId-based dispatch (fallback for games without configFormat or with unique INI syntax) */
function formatByGameId(patchSet: PatchSet): string {
  switch (patchSet.gameId) {
    case 'cs2':
      return formatCs2Config(patchSet)
    case 'cf':
      return formatCfConfig(patchSet)
    case 'dont-starve':
      return formatDontStarveConfig(patchSet)
    case 'lol':
      return formatLolConfig(patchSet)
    default:
      return patchSet.patches
        .map((p) => `${p.nativeKey}=${normalizeKey(p.presetValue)}`)
        .join('\n')
  }
}

/** Get the file extension / filename for a game's generated config (data-driven) */
export function getConfigFileName(gameId: string): string {
  const game = getGame(gameId)
  // Use the game's configFileName from JSON adapter if defined
  if (game.configFileName) return game.configFileName
  // Fallback to gameId-based defaults
  switch (gameId) {
    case 'cs2':
      return 'keyforge.cfg'
    case 'cf':
      return 'KeySettings.ini'
    case 'dont-starve':
      return 'settings.ini'
    case 'lol':
      return 'Input.ini'
    default:
      return 'config.txt'
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function categoryForAction(actionId: string): string {
  const movement = ['forward', 'left', 'back', 'right']
  const combat = ['primary', 'secondary']
  const abilities = ['ability1', 'ability2', 'ability3', 'ultimate']
  const summoner = ['summoner1', 'summoner2']
  const items = ['interact', 'inventory1', 'inventory2', 'inventory3', 'inventory4', 'inventory5', 'inventory6']
  if (movement.includes(actionId)) return 'movement'
  if (combat.includes(actionId)) return 'combat'
  if (abilities.includes(actionId)) return 'abilities'
  if (summoner.includes(actionId)) return 'summoner'
  if (items.includes(actionId)) return 'items'
  return 'system'
}
