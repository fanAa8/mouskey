/**
 * Unified config handler — dispatches to the correct parser/writer
 * based on the game's configFormat field from the JSON adapter.
 *
 * This is the main entry point for reading and writing game configs.
 * Adding a new config format = adding a parser + registering it here.
 */

import type { GameDefinition } from '../adapters/types'
import { parseIni, serializeIni, formatIniConfig, getIniSection, setIniValue } from './parsers/ini'
import { parseCfg, serializeCfg, formatCfgConfig, setCfgBind } from './parsers/cfg'
import {
  parsePersistedSettings,
  serializePersistedSettings,
  getSectionBindings,
  setSettingValue,
  normalizeLolKey,
  denormalizeLolKey,
} from './parsers/persistedSettings'

export type ConfigFormat = 'ini' | 'source-cfg' | 'riot-persisted-json' | 'json' | 'xml'

export type ReadResult = {
  format: ConfigFormat
  bindings: Record<string, string>
  raw: string
  parsed: any
}

/** Read current bindings from a config file content, based on game format. */
export function readConfig(
  content: string,
  game: GameDefinition,
  section?: string,
): ReadResult {
  const format = (game.configFormat || 'ini') as ConfigFormat

  switch (format) {
    case 'ini': {
      const parsed = parseIni(content)
      const sec = section || game.modes?.[0]?.section || ''
      const bindings = sec ? getIniSection(parsed, sec) : {}
      return { format, bindings, raw: content, parsed }
    }

    case 'source-cfg': {
      const parsed = parseCfg(content)
      const bindings: Record<string, string> = {}
      for (const bind of parsed.binds) {
        bindings[bind.command] = bind.key
      }
      return { format, bindings, raw: content, parsed }
    }

    case 'riot-persisted-json': {
      const parsed = parsePersistedSettings(content)
      const sec = section || game.modes?.[0]?.section || 'GameEvents'
      const rawBindings = getSectionBindings(parsed, 'Input.ini', sec)
      // Denormalize from [q] → q, [Button 2] → Mouse 2
      const bindings: Record<string, string> = {}
      for (const [key, value] of Object.entries(rawBindings)) {
        bindings[key] = denormalizeLolKey(value)
      }
      return { format, bindings, raw: content, parsed }
    }

    default:
      return { format, bindings: {}, raw: content, parsed: null }
  }
}

/** Write bindings to a config file content, based on game format. */
export function writeConfig(
  content: string,
  game: GameDefinition,
  bindings: Record<string, string>,
  section?: string,
): string {
  const format = (game.configFormat || 'ini') as ConfigFormat

  switch (format) {
    case 'ini': {
      const parsed = parseIni(content)
      const sec = section || game.modes?.[0]?.section || ''
      for (const [key, value] of Object.entries(bindings)) {
        setIniValue(parsed, sec, key, value)
      }
      return serializeIni(parsed)
    }

    case 'source-cfg': {
      const parsed = parseCfg(content)
      for (const [command, key] of Object.entries(bindings)) {
        setCfgBind(parsed, key, command)
      }
      return serializeCfg(parsed)
    }

    case 'riot-persisted-json': {
      const parsed = parsePersistedSettings(content)
      const sec = section || game.modes?.[0]?.section || 'GameEvents'
      for (const [key, value] of Object.entries(bindings)) {
        setSettingValue(parsed, 'Input.ini', sec, key, normalizeLolKey(value))
      }
      return serializePersistedSettings(parsed)
    }

    default:
      return content
  }
}

/** Generate a preview of what would be written (for the UI preview panel). */
export function generatePreview(
  game: GameDefinition,
  pairs: { nativeKey: string; value: string }[],
  section?: string,
): string {
  const format = (game.configFormat || 'ini') as ConfigFormat
  const sec = section || game.modes?.[0]?.section || ''

  const header = [
    `// Keyforge generated config`,
    `// Game: ${game.name}`,
    `// Generated: ${new Date().toISOString()}`,
  ]

  switch (format) {
    case 'source-cfg':
      return formatCfgConfig(
        pairs.map((p) => ({ key: p.value.toLowerCase(), command: p.nativeKey })),
        header,
      )

    case 'riot-persisted-json':
    case 'ini':
    default:
      return formatIniConfig(sec || 'Settings', pairs, header)
  }
}

// Re-export parsers for advanced use
export { parseIni, serializeIni, parseCfg, serializeCfg, parsePersistedSettings, serializePersistedSettings }
