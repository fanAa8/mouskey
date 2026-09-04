/**
 * Riot Games PersistedSettings.json parser and writer.
 *
 * Handles the nested JSON format used by League of Legends:
 * {
 *   "files": [
 *     {
 *       "name": "Input.ini",
 *       "sections": [
 *         {
 *           "name": "GameEvents",
 *           "settings": [
 *             { "name": "evtCastSpell1", "value": "[q]" }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 * }
 *
 * Also supports the WASD section which has different field names
 * (e.g., "CastSpell1" instead of "evtCastSpell1").
 */

export type PersistedSetting = {
  name: string
  value: string
}

export type PersistedSection = {
  name: string
  settings: PersistedSetting[]
}

export type PersistedFile = {
  name: string
  sections: PersistedSection[]
}

export type ParsedPersistedSettings = {
  files: PersistedFile[]
}

/** Parse PersistedSettings.json content. */
export function parsePersistedSettings(content: string): ParsedPersistedSettings {
  try {
    const parsed = JSON.parse(content)
    return {
      files: (parsed.files || []).map((f: any) => ({
        name: f.name || '',
        sections: (f.sections || []).map((s: any) => ({
          name: s.name || '',
          settings: (s.settings || []).map((st: any) => ({
            name: st.name || '',
            value: st.value || '',
          })),
        })),
      })),
    }
  } catch {
    return { files: [] }
  }
}

/** Get a specific file entry by name. */
export function getFile(parsed: ParsedPersistedSettings, fileName: string): PersistedFile | null {
  return parsed.files.find((f) => f.name.toLowerCase() === fileName.toLowerCase()) || null
}

/** Get a section from a file by name. */
export function getSection(file: PersistedFile | null, sectionName: string): PersistedSection | null {
  if (!file) return null
  return file.sections.find((s) => s.name.toLowerCase() === sectionName.toLowerCase()) || null
}

/** Get a setting value from a section by name. */
export function getSettingValue(section: PersistedSection | null, settingName: string): string | null {
  if (!section) return null
  const setting = section.settings.find((s) => s.name.toLowerCase() === settingName.toLowerCase())
  return setting ? setting.value : null
}

/**
 * Get all keybindings from a section as a key→value map.
 * This is the main function used to read current game config.
 */
export function getSectionBindings(
  parsed: ParsedPersistedSettings,
  fileName: string,
  sectionName: string,
): Record<string, string> {
  const file = getFile(parsed, fileName)
  const section = getSection(file, sectionName)
  if (!section) return {}
  const result: Record<string, string> = {}
  for (const setting of section.settings) {
    result[setting.name] = setting.value
  }
  return result
}

/** Set a setting value, creating the file/section/setting if needed. */
export function setSettingValue(
  parsed: ParsedPersistedSettings,
  fileName: string,
  sectionName: string,
  settingName: string,
  value: string,
): void {
  let file = getFile(parsed, fileName)
  if (!file) {
    file = { name: fileName, sections: [] }
    parsed.files.push(file)
  }

  let section = getSection(file, sectionName)
  if (!section) {
    section = { name: sectionName, settings: [] }
    file.sections.push(section)
  }

  const setting = section.settings.find((s) => s.name.toLowerCase() === settingName.toLowerCase())
  if (setting) {
    setting.value = value
  } else {
    section.settings.push({ name: settingName, value })
  }
}

/** Serialize back to JSON string. */
export function serializePersistedSettings(parsed: ParsedPersistedSettings, pretty: boolean = true): string {
  return JSON.stringify(parsed, null, pretty ? 2 : 0)
}

/**
 * Normalize a key value to LoL's bracket format.
 * "q" → "[q]", "Mouse 2" → "[Button 2]", "Space" → "[Space]"
 */
export function normalizeLolKey(key: string): string {
  const trimmed = key.trim()
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) return trimmed
  // Mouse buttons
  if (trimmed === 'Mouse 1') return '[Button 1]'
  if (trimmed === 'Mouse 2') return '[Button 2]'
  if (trimmed === 'Mouse 3' || trimmed === 'Mouse Wheel') return '[Button 3]'
  if (trimmed === 'Mouse 4') return '[Button 4]'
  if (trimmed === 'Mouse 5') return '[Button 5]'
  return `[${trimmed}]`
}

/** Denormalize from LoL bracket format to Keyforge key name. */
export function denormalizeLolKey(value: string): string {
  const trimmed = value.trim().replace(/^\[/, '').replace(/\]$/, '')
  if (trimmed === 'Button 1') return 'Mouse 1'
  if (trimmed === 'Button 2') return 'Mouse 2'
  if (trimmed === 'Button 3') return 'Mouse 3'
  if (trimmed === 'Button 4') return 'Mouse 4'
  if (trimmed === 'Button 5') return 'Mouse 5'
  return trimmed
}
