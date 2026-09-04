/**
 * Reverse mapper — converts a game's native config back to generic Keyforge actions.
 *
 * This is the key to "shared presets": read config from one game,
 * map native field names back to generic action IDs, and the resulting
 * profile can be applied to ANY other game.
 *
 * Example:
 *   LoL native: { evtCastSpell1: "[q]", evtCastSpell2: "[w]" }
 *   → generic: { ability1: "Q", ability2: "W" }
 *   → can be applied to CS2 as { slot1: "Q", slot2: "W" }
 */

import type { ActionId, GameDefinition } from '../adapters/types'

/**
 * Normalize a game-native key value to Keyforge's standard key name.
 * Handles LoL bracket format ([q], [Button 2], [Space]) and other formats.
 */
export function normalizeNativeKey(rawValue: string, gameId?: string): string {
  let value = rawValue.trim()

  // LoL bracket format: [q], [Button 1], [Space]
  if (value.startsWith('[') && value.endsWith(']')) {
    value = value.slice(1, -1).trim()
  }

  // Mouse buttons
  const mouseMap: Record<string, string> = {
    'Button 1': 'Mouse 1', 'Button 2': 'Mouse 2', 'Button 3': 'Mouse 3',
    'Button 4': 'Mouse 4', 'Button 5': 'Mouse 5',
    'MOUSE1': 'Mouse 1', 'MOUSE2': 'Mouse 2', 'MOUSE3': 'Mouse 3',
    'MOUSE4': 'Mouse 4', 'MOUSE5': 'Mouse 5',
  }
  if (mouseMap[value]) return mouseMap[value]

  // Special keys (case-insensitive match)
  const specialMap: Record<string, string> = {
    'space': 'Space', 'tab': 'Tab', 'escape': 'Esc', 'esc': 'Esc',
    'enter': 'Enter', 'return': 'Enter',
    'shift': 'Shift', 'lshift': 'Shift', 'rshift': 'Shift R',
    'ctrl': 'Ctrl', 'lctrl': 'Ctrl', 'rctrl': 'Ctrl R',
    'alt': 'Alt', 'lalt': 'Alt', 'ralt': 'Alt R',
    'backspace': 'Backspace', 'delete': 'Delete', 'insert': 'Insert',
    'home': 'Home', 'end': 'End', 'pageup': 'Page Up', 'pagedown': 'Page Down',
    'up': 'Up', 'down': 'Down', 'left': 'Left', 'right': 'Right',
    'capslock': 'Caps', 'caps': 'Caps',
  }
  const lower = value.toLowerCase()
  if (specialMap[lower]) return specialMap[lower]

  // F-keys
  if (/^f\d+$/i.test(value)) return value.toUpperCase()

  // Single character: uppercase for letters, keep as-is for numbers/symbols
  if (value.length === 1) {
    return /[a-z]/.test(value) ? value.toUpperCase() : value
  }

  return value
}

/**
 * Reverse-map a game's native bindings to generic Keyforge actions.
 *
 * @param game - The game definition (provides nativeNames mapping)
 * @param nativeBindings - Record of native field name → key value
 * @param modeId - Optional mode ID for mode-specific native names (e.g. LoL WASD)
 * @returns Record of actionId → key value (only actions that were found)
 */
export function reverseMapToProfile(
  game: GameDefinition,
  nativeBindings: Record<string, string>,
  modeId?: string,
): Partial<Record<ActionId, string>> {
  const result: Partial<Record<ActionId, string>> = {}

  // Get native names for the specified mode (or default)
  const nativeNames = game.nativeNames
  const modeOverrides = modeId ? game.modeNativeNames?.[modeId] : undefined

  // Build reverse map: nativeName → actionId
  const reverseMap: Record<string, ActionId> = {}
  for (const [actionId, nativeName] of Object.entries(nativeNames)) {
    if (nativeName) reverseMap[nativeName.toLowerCase()] = actionId as ActionId
  }
  // Apply mode-specific overrides
  if (modeOverrides) {
    for (const [actionId, nativeName] of Object.entries(modeOverrides)) {
      if (nativeName) reverseMap[nativeName.toLowerCase()] = actionId as ActionId
    }
  }

  // Map each native binding to a generic action
  for (const [nativeName, rawValue] of Object.entries(nativeBindings)) {
    const actionId = reverseMap[nativeName.toLowerCase()]
    if (actionId && rawValue) {
      result[actionId] = normalizeNativeKey(rawValue, game.id)
    }
  }

  return result
}

/**
 * Create a full profile from reverse-mapped bindings, filling in defaults
 * for actions that weren't found in the native config.
 *
 * @param game - The game definition
 * @param nativeBindings - Record of native field name → key value
 * @param profileName - Name for the new profile
 * @param modeId - Optional mode ID
 * @returns Profile object with all actions (mapped + default + empty)
 */
export function createProfileFromGameConfig(
  game: GameDefinition,
  nativeBindings: Record<string, string>,
  profileName: string,
  modeId?: string,
): { id: string; name: string; note: string; bindings: { id: ActionId; key: string }[] } {
  const mapped = reverseMapToProfile(game, nativeBindings, modeId)
  const defaults = game.defaults
  const modeDefaults = modeId ? game.modeDefaults?.[modeId] : undefined

  const bindings: { id: ActionId; key: string }[] = []
  const allActionIds = Object.keys({ ...game.nativeNames, ...(modeOverridesSafe(modeId, game)) }) as ActionId[]

  for (const actionId of allActionIds) {
    let key = mapped[actionId] ?? ''
    if (!key && modeDefaults?.[actionId]) key = modeDefaults[actionId]
    if (!key && defaults[actionId]) key = defaults[actionId]
    bindings.push({ id: actionId, key })
  }

  return {
    id: `imported-${game.id}-${Date.now()}`,
    name: profileName,
    note: `从 ${game.name} 导入${modeId ? `（${modeId}）` : ''}`,
    bindings,
  }
}

function modeOverridesSafe(modeId: string | undefined, game: GameDefinition): Partial<Record<ActionId, string>> {
  return modeId ? game.modeNativeNames?.[modeId] ?? {} : {}
}

/**
 * Check if a key value is "empty" or unbound.
 */
export function isUnbound(key: string): boolean {
  const trimmed = key.trim().toLowerCase()
  return !trimmed || trimmed === '<unbound>' || trimmed === 'none' || trimmed === 'unbound'
}
