import type { BindingPatch, ControlAction, GameDefinition, PatchSet } from './types'
import { actionTemplate } from './games'

/**
 * Generate a full patch set from the user's profile bindings.
 * This is the core "preset-first" logic: it never requires reading
 * the game's current config. The user's own scheme is the source of truth.
 */
export function generatePatchSet(game: GameDefinition, bindings: ControlAction[], modeId?: string): PatchSet {
  const patches: BindingPatch[] = []
  const supported = (modeId && game.modeSupportedActions?.[modeId]) ?? game.supportedActions
  const allowedSet = supported ? new Set(supported) : null
  const nativeNames = {
    ...game.nativeNames,
    ...(modeId ? game.modeNativeNames?.[modeId] : undefined),
  }
  const defaults = {
    ...game.defaults,
    ...(modeId ? game.modeDefaults?.[modeId] : undefined),
  }

  for (const action of actionTemplate) {
    // Skip actions not supported by this game
    if (allowedSet && !allowedSet.has(action.id)) continue

    const binding = bindings.find((b) => b.id === action.id)
    const presetValue = binding?.key ?? ''

    // Skip actions with no binding assigned
    if (!presetValue) continue

    const nativeKey = nativeNames[action.id]
    // Skip actions with no native field mapping
    if (!nativeKey) continue

    const defaultValue = defaults[action.id] ?? null
    const changed = defaultValue !== null && defaultValue !== presetValue

    patches.push({
      actionId: action.id,
      actionLabel: action.label,
      nativeKey,
      presetValue,
      defaultValue,
      changed,
    })
  }

  const changedCount = patches.filter((p) => p.changed).length

  return {
    gameId: game.id,
    gameName: game.name,
    modeId,
    patches,
    changedCount,
    totalCount: patches.length,
  }
}

/**
 * Normalize a Keyforge key name to a game-native key token.
 * Handles Mouse buttons, Space, and common special keys.
 */
export function normalizeKey(key: string): string {
  const trimmed = key.trim()
  // Mouse buttons
  if (trimmed === 'Mouse 1') return 'MOUSE1'
  if (trimmed === 'Mouse 2') return 'MOUSE2'
  if (trimmed === 'Mouse 3' || trimmed === 'Mouse Wheel') return 'MOUSE3'
  if (trimmed === 'Mouse 4') return 'MOUSE4'
  if (trimmed === 'Mouse 5') return 'MOUSE5'
  // Special keys
  if (trimmed === 'Space') return 'SPACE'
  if (trimmed === 'Tab') return 'TAB'
  if (trimmed === 'Esc') return 'ESCAPE'
  if (trimmed === 'Enter') return 'ENTER'
  if (trimmed === 'Backspace') return 'BACKSPACE'
  if (trimmed === 'Shift') return 'SHIFT'
  if (trimmed === 'Shift R') return 'RSHIFT'
  if (trimmed === 'Ctrl') return 'CTRL'
  if (trimmed === 'Ctrl R') return 'RCTRL'
  if (trimmed === 'Alt') return 'ALT'
  if (trimmed === 'Alt R') return 'RALT'
  if (trimmed === 'Caps') return 'CAPSLOCK'
  // Single char keys: uppercase
  if (trimmed.length === 1) return trimmed.toUpperCase()
  return trimmed.toUpperCase()
}
