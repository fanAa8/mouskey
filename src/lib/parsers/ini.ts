/**
 * Generic INI parser and writer.
 *
 * Handles standard INI format:
 *   [Section]
 *   key=value
 *   key = value
 *   ; comment
 *   # comment
 *
 * Preserves comments and section order when writing.
 */

export type IniSection = {
  name: string
  entries: { key: string; value: string; comment?: string }[]
  leadingComments: string[]
}

export type ParsedIni = {
  sections: IniSection[]
  globalEntries: { key: string; value: string; comment?: string }[]
  leadingComments: string[]
}

/** Parse INI content into structured sections. */
export function parseIni(content: string): ParsedIni {
  const lines = content.split(/\r?\n/)
  const result: ParsedIni = {
    sections: [],
    globalEntries: [],
    leadingComments: [],
  }

  let currentSection: IniSection | null = null
  let pendingComments: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()

    // Empty line
    if (!line) {
      pendingComments.push('')
      continue
    }

    // Comment
    if (line.startsWith(';') || line.startsWith('#')) {
      pendingComments.push(line)
      continue
    }

    // Section header
    const sectionMatch = line.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      currentSection = {
        name: sectionMatch[1].trim(),
        entries: [],
        leadingComments: pendingComments,
      }
      result.sections.push(currentSection)
      pendingComments = []
      continue
    }

    // Key=value pair
    const eqIndex = line.indexOf('=')
    if (eqIndex > 0) {
      const key = line.substring(0, eqIndex).trim()
      const value = line.substring(eqIndex + 1).trim()
      const entry = { key, value, comment: pendingComments.length > 0 ? pendingComments.join('\n') : undefined }

      if (currentSection) {
        currentSection.entries.push(entry)
      } else {
        result.globalEntries.push(entry)
      }
      pendingComments = []
      continue
    }

    // Unrecognized line - treat as comment
    pendingComments.push(line)
  }

  // Any remaining comments go to leadingComments (shouldn't happen normally)
  if (pendingComments.length > 0 && result.sections.length === 0) {
    result.leadingComments = pendingComments
  }

  return result
}

/** Get a value from a parsed INI by section and key. */
export function getIniValue(parsed: ParsedIni, section: string, key: string): string | null {
  const sec = parsed.sections.find((s) => s.name.toLowerCase() === section.toLowerCase())
  if (!sec) return null
  const entry = sec.entries.find((e) => e.key.toLowerCase() === key.toLowerCase())
  return entry ? entry.value : null
}

/** Get all key-value pairs from a section. */
export function getIniSection(parsed: ParsedIni, section: string): Record<string, string> {
  const sec = parsed.sections.find((s) => s.name.toLowerCase() === section.toLowerCase())
  if (!sec) return {}
  const result: Record<string, string> = {}
  for (const entry of sec.entries) {
    result[entry.key] = entry.value
  }
  return result
}

/** Set a value in a parsed INI, creating the section/key if needed. */
export function setIniValue(parsed: ParsedIni, section: string, key: string, value: string): void {
  let sec = parsed.sections.find((s) => s.name.toLowerCase() === section.toLowerCase())
  if (!sec) {
    sec = { name: section, entries: [], leadingComments: [] }
    parsed.sections.push(sec)
  }
  const entry = sec.entries.find((e) => e.key.toLowerCase() === key.toLowerCase())
  if (entry) {
    entry.value = value
  } else {
    sec.entries.push({ key, value })
  }
}

/** Serialize a parsed INI back to text. */
export function serializeIni(parsed: ParsedIni): string {
  const lines: string[] = []

  // Leading comments
  for (const comment of parsed.leadingComments) {
    lines.push(comment)
  }

  // Global entries (before first section)
  for (const entry of parsed.globalEntries) {
    if (entry.comment) lines.push(entry.comment)
    lines.push(`${entry.key}=${entry.value}`)
  }

  // Sections
  for (const section of parsed.sections) {
    for (const comment of section.leadingComments) {
      lines.push(comment)
    }
    lines.push(`[${section.name}]`)
    for (const entry of section.entries) {
      if (entry.comment) lines.push(entry.comment)
      lines.push(`${entry.key}=${entry.value}`)
    }
  }

  return lines.join('\n')
}

/**
 * Generate INI config text from a set of key-value pairs for a specific section.
 * Used by the frontend preview and backend writer.
 */
export function formatIniConfig(
  section: string,
  pairs: { nativeKey: string; value: string }[],
  header?: string[],
): string {
  const lines: string[] = []
  if (header) {
    for (const h of header) lines.push(h)
    lines.push('')
  }
  lines.push(`[${section}]`)
  for (const pair of pairs) {
    lines.push(`${pair.nativeKey}=${pair.value}`)
  }
  lines.push('')
  return lines.join('\n')
}
