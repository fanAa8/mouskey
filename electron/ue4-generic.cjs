/**
 * UE4 / UE5(legacy input) generic support for MousKey.
 * - Detect UE projects from an install dir (<Project>/Content/Paks/*.pak|*.utoc)
 * - Locate %LOCALAPPDATA%/<Project>/Saved/Config/{Windows,WindowsNoEditor}
 * - Read DefaultInput.ini from pak via `repak` when available (unencrypted paks only)
 * - Build -/+ override entries under [/Script/Engine.InputSettings]
 */
const { existsSync, readdirSync, statSync } = require('node:fs')
const { join, basename, dirname } = require('node:path')
const { spawnSync } = require('node:child_process')

// Full-row right shift. Q/A/Z end up empty because nothing maps TO them.
// The rightmost key of each row (P/L/M) moves onto punctuation so no two
// actions collide on one key.
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']
const ROW_OVERFLOW = { p: '[', l: ';', m: ',' }
const LETTER_SHIFT = {}
for (const row of ROWS) {
  for (let i = 0; i < row.length; i++) {
    LETTER_SHIFT[row[i]] = i + 1 < row.length ? row[i + 1] : ROW_OVERFLOW[row[i]]
  }
}
const UE4_PUNCT_NAMES = { '[': 'LeftBracket', ';': 'Semicolon', ',': 'Comma' }

/** Shift a UE key name (W, E, ...). Returns new UE key name or null. */
const shiftUe4Key = (name) => {
  if (!name) return null
  const t = String(name).trim().replace(/^"|"$/g, '')
  if (!/^[A-Za-z]$/.test(t)) return null
  const s = LETTER_SHIFT[t.toLowerCase()]
  if (!s) return null
  return UE4_PUNCT_NAMES[s] || s.toUpperCase()
}

const DIR_SKIP = /^(engine|binaries|\$recycle\.bin|_commonredist|redist|directx|vcredist)$/i

/** Find UE project codenames under an install dir. */
const findUe4ProjectsInInstall = (installPath, maxDepth = 3) => {
  const found = []
  if (!installPath || !existsSync(installPath)) return found
  const hasEngine = existsSync(join(installPath, 'Engine'))
  const walk = (dir, depth) => {
    if (depth > maxDepth) return
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (!e.isDirectory() || DIR_SKIP.test(e.name)) continue
      const projDir = join(dir, e.name)
      const paks = join(projDir, 'Content', 'Paks')
      if (existsSync(paks)) {
        let files = []
        try { files = readdirSync(paks) } catch { /* ignore */ }
        const pak = files.filter((f) => /\.pak$/i.test(f))
        const utoc = files.some((f) => /\.utoc$/i.test(f))
        if ((pak.length && (hasEngine || existsSync(join(dir, 'Engine')))) || utoc) {
          found.push({ project: e.name, projectDir: projDir, paksDir: paks, paks: pak, iostore: utoc })
        }
        continue
      }
      walk(projDir, depth + 1)
    }
  }
  walk(installPath, 0)
  return found
}

const localAppData = () => process.env.LOCALAPPDATA
  || join(process.env.USERPROFILE || 'C:\\Users\\Administrator', 'AppData', 'Local')

/**
 * Config dirs to write for a project. If exactly one of Windows/WindowsNoEditor
 * exists use it; if neither (or both) exist return both ("write both if unsure").
 */
const ue4ConfigDirs = (project, root = localAppData()) => {
  const base = join(root, project, 'Saved', 'Config')
  const win = join(base, 'Windows')
  const wne = join(base, 'WindowsNoEditor')
  const hw = existsSync(win)
  const hn = existsSync(wne)
  if (hw && !hn) return [win]
  if (hn && !hw) return [wne]
  return [win, wne]
}

/** Pick the best Input.ini among platforms under Saved/Config (most recently modified). */
const pickInputIni = (savedConfig) => {
  let best = null
  let entries = []
  try { entries = readdirSync(savedConfig, { withFileTypes: true }) } catch { return null }
  for (const p of entries) {
    if (!p.isDirectory() || /crashreport/i.test(p.name)) continue
    const ini = join(savedConfig, p.name, 'Input.ini')
    if (!existsSync(ini)) continue
    let m = 0
    try { m = statSync(ini).mtimeMs } catch { /* ignore */ }
    if (!best || m > best.m) best = { path: ini, m }
  }
  return best ? best.path : null
}

let repakChecked = null
const findRepak = () => {
  if (repakChecked !== null) return repakChecked
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['repak'], { encoding: 'utf8', windowsHide: true })
  repakChecked = r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : ''
  return repakChecked
}

/** Try reading <Project>/Config/DefaultInput.ini from the game's paks. Null if not possible. */
const readDefaultInputFromPak = (ue) => {
  const repak = findRepak()
  if (!repak || !ue || !ue.paks || !ue.paks.length) return null
  const inner = `${ue.project}/Config/DefaultInput.ini`
  for (const pak of ue.paks) {
    const r = spawnSync(repak, ['get', join(ue.paksDir, pak), inner], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
    if (r.status === 0 && /Mappings=/.test(r.stdout)) return { text: r.stdout, source: `pak:${pak}` }
  }
  return null
}

/** Common default mappings, used when the pak can't be read. */
const TEMPLATE_DEFAULT_INPUT = [
  '[/Script/Engine.InputSettings]',
  '+AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=W)',
  '+AxisMappings=(AxisName="MoveForward",Scale=-1.000000,Key=S)',
  '+AxisMappings=(AxisName="MoveRight",Scale=1.000000,Key=D)',
  '+AxisMappings=(AxisName="MoveRight",Scale=-1.000000,Key=A)',
  '+ActionMappings=(ActionName="Interact",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=E)',
  '+ActionMappings=(ActionName="Use",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=E)',
  '+ActionMappings=(ActionName="Reload",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=R)',
  '+ActionMappings=(ActionName="Crouch",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=C)',
  '+ActionMappings=(ActionName="Flashlight",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=F)',
].join('\n')

/** Extract mapping tuples from an ini text. */
const parseMappings = (text) => {
  const out = []
  const re = /^\s*[+]?(AxisMappings|ActionMappings)=\((.*)\)\s*$/gm
  let m
  while ((m = re.exec(text))) out.push({ kind: m[1], inner: m[2] })
  return out
}

/**
 * Build override text for Input.ini. Keeps existing content, appends -/+ lines
 * inside [/Script/Engine.InputSettings] (created if missing). Idempotent.
 */
const buildUe4Override = (existing, defaultsText) => {
  const content = existing || ''
  const lines = []
  const changes = []
  for (const { kind, inner } of parseMappings(defaultsText)) {
    const km = inner.match(/Key=("?)([^,)"]+)\1/)
    if (!km) continue
    const nk = shiftUe4Key(km[2])
    if (!nk) continue
    const newInner = inner.replace(/Key=("?)[^,)"]+\1/, `Key=${nk}`)
    const plus = `+${kind}=(${newInner})`
    if (content.includes(plus)) continue
    lines.push(`-${kind}=(${inner})`, plus)
    const name = (inner.match(/(?:AxisName|ActionName)="?([^",]+)/) || [])[1] || '?'
    changes.push(`${name}: ${km[2]} → ${nk}`)
  }
  if (!lines.length) return { content, changedCount: 0, changes, added: [] }
  const header = '[/Script/Engine.InputSettings]'
  const block = ['; MousKey ESDF override', ...lines].join('\r\n')
  let next
  const idx = content.indexOf(header)
  if (idx >= 0) {
    const after = idx + header.length
    next = content.slice(0, after) + '\r\n' + block + content.slice(after)
  } else {
    const trimmed = content.replace(/\s+$/, '')
    next = (trimmed ? trimmed + '\r\n\r\n' : '') + header + '\r\n' + block + '\r\n'
  }
  return { content: next, changedCount: changes.length, changes, added: lines }
}

module.exports = {
  LETTER_SHIFT,
  shiftUe4Key,
  findUe4ProjectsInInstall,
  ue4ConfigDirs,
  pickInputIni,
  readDefaultInputFromPak,
  TEMPLATE_DEFAULT_INPUT,
  parseMappings,
  buildUe4Override,
}
