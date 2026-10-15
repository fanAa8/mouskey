// Battlerite (Stunlock, InControl) KMInput.json helpers.
// KMInput.json only stores OVERRIDES; after "reset to defaults" it is "{}".
// Defaults come from InControl.GameInputs.InitializeInputDefinitions (StandardKeyboard column,
// decompiled from Battlerite_Data/Managed/MergedUnity.dll). Axes "Move.X" = d.A:D are overridable
// per direction as "Move.X.Neg"/"Move.X.Pos". Arrays are alternatives ("k.Tab,k.M" → ["k.Tab","k.M"]).
const { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } = require('node:fs')
const { join, basename, extname } = require('node:path')
const os = require('node:os')

// Gameplay letters only (UI/observer bindings left alone; Map's M would become ',' so it's skipped)
const BATTLERITE_KM_DEFAULTS = {
  'Move.X.Neg': ['k.A'], 'Move.X.Pos': ['k.D'], 'Move.Y.Neg': ['k.S'], 'Move.Y.Pos': ['k.W'],
  Ability4: ['k.Q'], Ability5: ['k.E'], Ability6: ['k.R'], Ability7: ['k.F'],
  LimitBreak: ['k.T'], Mount: ['k.Z', 'm.3'], Interrupt: ['k.C'], DropItem: ['k.LeftShift', 'k.X'],
  EmoteWheel: ['k.V'], FallBackPing: ['k.G'],
}

const isKMInput = (fileName) => /^KMInput(\.json)?$/i.test(basename(fileName || ''))

/** Fill missing gameplay defaults so a reset ("{}") file can be shifted. Existing overrides win. */
const withDefaults = (fileName, content) => {
  if (!isKMInput(fileName)) return content
  let parsed; try { parsed = JSON.parse(content || '{}') } catch { return content }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return content
  const out = { ...parsed }
  for (const [k, v] of Object.entries(BATTLERITE_KM_DEFAULTS)) {
    // an empty array is an explicit "unbound" override — keep it
    if (!(k in out)) out[k] = [...v]
  }
  return JSON.stringify(out, null, 2)
}

// ─── Steam Cloud mirror (userdata/<id>/<appid>/remote/<name>) ───
const decode = (buf) => {
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return { text: buf.slice(2).toString('utf16le'), encoding: 'utf16le', bom: true }
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return { text: buf.slice(3).toString('utf8'), encoding: 'utf8', bom: true }
  // UTF-16LE without BOM: ASCII text with NUL every second byte
  if (buf.length >= 2 && buf.length % 2 === 0 && buf[1] === 0 && buf[0] !== 0) return { text: buf.toString('utf16le'), encoding: 'utf16le', bom: false }
  return { text: buf.toString('utf8'), encoding: 'utf8', bom: false }
}
const encode = (text, enc) => {
  if (enc.encoding === 'utf16le') return Buffer.concat([enc.bom ? Buffer.from([0xFF, 0xFE]) : Buffer.alloc(0), Buffer.from(text, 'utf16le')])
  return Buffer.from((enc.bom ? '\uFEFF' : '') + text, 'utf8')
}
const sameJson = (a, b) => { try { return JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b)) } catch { return a.trim() === b.trim() } }

const findCloudCopies = (steamPath, appId, fileName) => {
  if (!steamPath || !appId) return []
  const ud = join(steamPath, 'userdata')
  if (!existsSync(ud)) return []
  const names = [basename(fileName), basename(fileName, extname(fileName))]
  const out = []
  for (const u of readdirSync(ud, { withFileTypes: true })) {
    if (!u.isDirectory()) continue
    for (const n of names) {
      const p = join(ud, u.name, String(appId), 'remote', n)
      if (existsSync(p)) { out.push({ path: p, remotecache: join(ud, u.name, String(appId), 'remotecache.vdf') }); break }
    }
  }
  return out
}

/**
 * Write newText to each Steam Cloud copy whose content matched the local file before the write.
 * Backups go to Documents/Keyforge/backups/<label>/ (never into remote/, which Steam watches).
 * remotecache.vdf is NOT edited: Steam sees a local change (sha/size differ, cloud unchanged) and uploads it.
 */
const mirrorToCloud = ({ steamPath, appId, fileName, origText, newText, label, dryRun = false }) => {
  const res = []
  for (const c of findCloudCopies(steamPath, appId, fileName)) {
    const enc = decode(readFileSync(c.path))
    if (!sameJson(enc.text, origText)) { res.push({ path: c.path, skipped: 'content differs from local file — not touched (possible cloud conflict)' }); continue }
    if (dryRun) { res.push({ path: c.path, encoding: enc.encoding, bom: enc.bom, dryRun: true }); continue }
    const bdir = join(os.homedir(), 'Documents', 'Keyforge', 'backups', label || String(appId))
    mkdirSync(bdir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '_')
    const backup = join(bdir, `cloud_${basename(c.path)}.${stamp}.bak`)
    copyFileSync(c.path, backup)
    writeFileSync(c.path, encode(newText, enc))
    const back = decode(readFileSync(c.path))
    res.push({ path: c.path, encoding: enc.encoding, bom: enc.bom, backup, verified: back.text === newText })
  }
  return res
}

const appIdFromGameId = (gameId) => { const m = /(\d{3,})$/.exec(gameId || ''); return m ? m[1] : null }

module.exports = { BATTLERITE_KM_DEFAULTS, isKMInput, withDefaults, decode, encode, findCloudCopies, mirrorToCloud, appIdFromGameId }
