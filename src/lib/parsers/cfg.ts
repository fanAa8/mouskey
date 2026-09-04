/**
 * Generic Source engine CFG parser and writer.
 *
 * Handles Valve Source engine config format:
 *   bind "key" "command"
 *   bind key command
 *   alias "name" "commands"
 *   // comment
 *
 * Used by CS2, CS:GO, TF2, and other Source engine games.
 */

export type CfgBind = {
  key: string
  command: string
  comment?: string
}

export type ParsedCfg = {
  binds: CfgBind[]
  aliases: { name: string; command: string }[]
  otherLines: string[]
  leadingComments: string[]
}

/** Parse Source CFG content into structured binds. */
export function parseCfg(content: string): ParsedCfg {
  const lines = content.split(/\r?\n/)
  const result: ParsedCfg = {
    binds: [],
    aliases: [],
    otherLines: [],
    leadingComments: [],
  }

  let pendingComments: string[] = []

  for (const rawLine of lines) {
    const line = rawLine.trim()

    if (!line) {
      pendingComments.push('')
      continue
    }

    if (line.startsWith('//')) {
      pendingComments.push(line)
      continue
    }

    // bind "key" "command" or bind key command
    const bindMatch = line.match(/^bind\s+(?:"([^"]*)"|(\S+))\s+(?:"([^"]*)"|(.+))$/i)
    if (bindMatch) {
      const key = bindMatch[1] || bindMatch[2] || ''
      const command = bindMatch[3] || bindMatch[4] || ''
      result.binds.push({
        key,
        command,
        comment: pendingComments.length > 0 ? pendingComments.join('\n') : undefined,
      })
      pendingComments = []
      continue
    }

    // alias "name" "command"
    const aliasMatch = line.match(/^alias\s+(?:"([^"]*)"|(\S+))\s+(?:"([^"]*)"|(.+))$/i)
    if (aliasMatch) {
      const name = aliasMatch[1] || aliasMatch[2] || ''
      const command = aliasMatch[3] || aliasMatch[4] || ''
      result.aliases.push({ name, command })
      pendingComments = []
      continue
    }

    // Other lines (set, exec, etc.)
    if (pendingComments.length > 0) {
      result.otherLines.push(...pendingComments)
      pendingComments = []
    }
    result.otherLines.push(line)
  }

  if (pendingComments.length > 0 && result.binds.length === 0 && result.otherLines.length === 0) {
    result.leadingComments = pendingComments
  }

  return result
}

/** Get the command bound to a key. */
export function getCfgBind(parsed: ParsedCfg, key: string): string | null {
  const bind = parsed.binds.find((b) => b.key.toLowerCase() === key.toLowerCase())
  return bind ? bind.command : null
}

/** Set a bind, replacing existing if present. */
export function setCfgBind(parsed: ParsedCfg, key: string, command: string): void {
  const existing = parsed.binds.find((b) => b.key.toLowerCase() === key.toLowerCase())
  if (existing) {
    existing.command = command
  } else {
    parsed.binds.push({ key, command })
  }
}

/**
 * Generate Source CFG config text from a set of key→command pairs.
 * Used by the frontend preview and backend writer.
 */
export function formatCfgConfig(
  pairs: { key: string; command: string }[],
  header?: string[],
  categoryLabels?: Record<string, string>,
): string {
  const lines: string[] = []
  if (header) {
    for (const h of header) lines.push(h)
  }

  for (const pair of pairs) {
    lines.push(`bind "${pair.key}" "${pair.command}"`)
  }

  lines.push('')
  return lines.join('\n')
}

/** Serialize a parsed CFG back to text (preserves original structure). */
export function serializeCfg(parsed: ParsedCfg): string {
  const lines: string[] = []

  for (const comment of parsed.leadingComments) {
    lines.push(comment)
  }

  for (const line of parsed.otherLines) {
    lines.push(line)
  }

  for (const bind of parsed.binds) {
    if (bind.comment) lines.push(bind.comment)
    lines.push(`bind "${bind.key}" "${bind.command}"`)
  }

  return lines.join('\n')
}
