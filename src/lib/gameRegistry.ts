/**
 * Game Registry — data-driven game adapter loader.
 *
 * All game definitions live in src/games/*.json.
 * This module loads them at build time via import.meta.glob,
 * converts them to GameDefinition objects, and provides lookup helpers.
 *
 * To add a new game: drop a JSON file in src/games/ — no code changes needed.
 */
import type { ActionId, GameDefinition, GameMode } from '../adapters/types'

// Eager-load all JSON adapters at build time
const gameModules = import.meta.glob('../games/*.json', { eager: true }) as Record<
  string,
  { default: GameDefinition }
>

/** All loaded game definitions, sorted by name */
export const games: GameDefinition[] = Object.values(gameModules)
  .map((m) => m.default)
  .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))

/** Look up a game by id. Returns the first game if not found (safe fallback). */
export function getGame(id: string): GameDefinition {
  return games.find((g) => g.id === id) ?? games[0]
}

/** Get all modes for a game. Returns [{id:'default',name:'默认',section:''}] if no modes defined. */
export function getGameModes(gameId: string): GameMode[] {
  const game = getGame(gameId)
  return game.modes && game.modes.length > 0
    ? game.modes
    : [{ id: 'default', name: '默认', section: '' }]
}

/** Get the default mode id for a game. */
export function getDefaultMode(gameId: string): string {
  const game = getGame(gameId)
  return game.defaultMode ?? game.modes?.[0]?.id ?? 'default'
}

/**
 * Get native field names for a specific game + mode.
 * Merges default nativeNames with mode-specific overrides.
 */
export function getNativeNames(
  gameId: string,
  modeId?: string,
): Partial<Record<ActionId, string>> {
  const game = getGame(gameId)
  const mode = modeId ?? getDefaultMode(gameId)
  const base = { ...game.nativeNames }
  const overrides = game.modeNativeNames?.[mode]
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      base[key as ActionId] = value
    }
  }
  return base
}

/**
 * Get default bindings for a specific game + mode.
 * Merges default defaults with mode-specific overrides.
 */
export function getDefaults(
  gameId: string,
  modeId?: string,
): Partial<Record<ActionId, string>> {
  const game = getGame(gameId)
  const mode = modeId ?? getDefaultMode(gameId)
  const base = { ...game.defaults }
  const overrides = game.modeDefaults?.[mode]
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      base[key as ActionId] = value
    }
  }
  return base
}

/** Get the config section name for a game mode (used in INI/JSON writers). */
export function getModeSection(gameId: string, modeId?: string): string {
  const mode = modeId ?? getDefaultMode(gameId)
  const modes = getGameModes(gameId)
  return modes.find((m) => m.id === mode)?.section ?? ''
}

/** Number of loaded game adapters. */
export const gameCount = games.length
