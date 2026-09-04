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

// ─── Dispatcher (data-driven via configFormat) ─────────────────────────────

export function formatNativeConfig(patchSet: PatchSet): string {
  // Look up the game definition to get configFormat
  const game = getGame(patchSet.gameId)
  const format = game.configFormat

  // Dispatch by configFormat (data-driven)
  switch (format) {
    case 'source-cfg':
      return formatCs2Config(patchSet)
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
