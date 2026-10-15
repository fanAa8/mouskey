// LoL "abilities QWER -> WERT" (click-to-move kept). Only [GameEvents]; [WASD], movement mode,
// summoners, items untouched. Write path: running client LCU (no game in progress) → GET verify →
// mirror into PersistedSettings.json + input.ini with backups. Never quits/starts matches.
const { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

// event → [expected current value, new value]
const WERT_PLAN = {
  evtCastSpell1: ['[q]', '[w]'], evtCastSpell2: ['[w]', '[e]'], evtCastSpell3: ['[e]', '[r]'], evtCastSpell4: ['[r]', '[t]'],
  evtSmartCastSpell1: ['[Shift][q]', '[Shift][w]'], evtSmartCastSpell2: ['[Shift][w]', '[Shift][e]'],
  evtSmartCastSpell3: ['[Shift][e]', '[Shift][r]'], evtSmartCastSpell4: ['[Shift][r]', '[Shift][t]'],
  evtSelfCastSpell1: ['[Alt][q],', '[Alt][w],'], evtSelfCastSpell2: ['[Alt][w],', '[Alt][e],'], evtSelfCastSpell3: ['[Alt][e],', '[Alt][r],'],
  evtLevelSpell1: ['[Ctrl][q],[Alt][Button 2]', '[Ctrl][w],[Alt][Button 2]'],
  evtLevelSpell2: ['[Ctrl][w],[Alt][a]', '[Ctrl][e],[Alt][a]'],
  evtLevelSpell3: ['[Ctrl][e],[Alt][Space]', '[Ctrl][r],[Alt][Space]'],
  evtLevelSpell4: ['[Ctrl][r],[Alt][r]', '[Ctrl][t],[Alt][t]'],
  evtRadialEmoteInstantOpen: ['[t]', '[q]'],
}
const norm = (v) => String(v ?? '').replace(/\s+/g, '').toLowerCase()

/** Build updates from current GameEvents. Already-WERT keys are skipped; unexpected values block. */
const planWert = (current) => {
  const updates = {}, already = [], conflicts = []
  for (const [ev, [from, to]] of Object.entries(WERT_PLAN)) {
    const cur = current[ev]
    if (norm(cur) === norm(to)) already.push(ev)
    else if (norm(cur) === norm(from)) updates[ev] = to
    else conflicts.push({ event: ev, current: cur ?? null, expected: from })
  }
  return { updates, already, conflicts }
}

const settingsToMap = (section) => Object.fromEntries((section?.settings || []).map((s) => [s.name, s.value]))
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` }
const backupDir = () => { const d = join(os.homedir(), 'Documents', 'Keyforge', 'backups', 'LoL'); mkdirSync(d, { recursive: true }); return d }

/** Edit PersistedSettings.json Input.ini/<section>; backup first; reread + verify. */
const writePersistedVerified = (path, sectionName, updates, bdir = backupDir()) => {
  const backup = join(bdir, `PersistedSettings.json.${stamp()}.bak`)
  copyFileSync(path, backup)
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const input = (data.files || []).find((f) => f.name === 'Input.ini')
  if (!input) throw new Error('PersistedSettings.json has no Input.ini node')
  let sec = (input.sections ||= []).find((s) => s.name === sectionName)
  if (!sec) { sec = { name: sectionName, settings: [] }; input.sections.push(sec) }
  sec.settings ||= []
  for (const [k, v] of Object.entries(updates)) {
    const e = sec.settings.find((s) => s.name === k)
    if (e) e.value = v; else sec.settings.push({ name: k, value: v })
  }
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
  const back = settingsToMap((JSON.parse(readFileSync(path, 'utf8')).files.find((f) => f.name === 'Input.ini').sections || []).find((s) => s.name === sectionName))
  const bad = Object.entries(updates).filter(([k, v]) => back[k] !== v).map(([k]) => k)
  return { backup, verified: bad.length === 0, bad }
}

/** Edit input.ini [section] key=value lines; backup; verify. */
const writeInputIniVerified = (path, sectionName, updates, bdir = backupDir()) => {
  const backup = join(bdir, `input.ini.${stamp()}.bak`)
  copyFileSync(path, backup)
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  const out = []; let inSec = false; const left = new Map(Object.entries(updates))
  const flush = () => { for (const [k, v] of left) out.push(`${k}=${v}`); left.clear() }
  for (const l of lines) {
    const m = l.trim().match(/^\[([^\]]+)\]$/)
    if (m && !/^\[(Ctrl|Alt|Shift)/i.test(l.trim())) { if (inSec) flush(); inSec = m[1] === sectionName; out.push(l); continue }
    const eq = l.indexOf('=')
    if (inSec && eq > 0 && left.has(l.slice(0, eq).trim())) { const k = l.slice(0, eq).trim(); out.push(`${k}=${left.get(k)}`); left.delete(k); continue }
    out.push(l)
  }
  if (inSec) flush()
  writeFileSync(path, out.join('\r\n'), 'utf8')
  const txt = readFileSync(path, 'utf8')
  const bad = Object.entries(updates).filter(([k, v]) => !txt.includes(`${k}=${v}`)).map(([k]) => k)
  return { backup, verified: bad.length === 0, bad }
}


// ─── movement mode: click-to-move ───
// Client game-settings (LCU) does not list these keys, but they live in Game.cfg / PersistedSettings
// (HUD "Movement Mode", General CameraModeWASD) and game.cfg (General WASD). We PATCH them through LCU
// so the account copy agrees, then fix both local files.
const CLICK_MOVE = { HUD: { 'Movement Mode': 0 }, General: { CameraModeWASD: 0, WASD: 0 } }

const setGameCfgVerified = (path, plan, bdir = backupDir()) => {
  const backup = join(bdir, `game.cfg.${stamp()}.bak`); copyFileSync(path, backup)
  const raw = readFileSync(path, 'utf8'); const nl = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/); const out = []; let sec = null; const left = {}
  for (const [s, kv] of Object.entries(plan)) left[s] = new Map(Object.entries(kv))
  const flush = () => { if (sec && left[sec]) { for (const [k, v] of left[sec]) out.push(`${k}=${v}`); left[sec].clear() } }
  for (const l of lines) {
    const m = l.trim().match(/^\[([^\]]+)\]$/)
    if (m) { flush(); sec = m[1]; out.push(l); continue }
    const eq = l.indexOf('=')
    if (sec && left[sec] && eq > 0 && left[sec].has(l.slice(0, eq).trim())) { const k = l.slice(0, eq).trim(); out.push(`${k}=${left[sec].get(k)}`); left[sec].delete(k); continue }
    out.push(l)
  }
  flush()
  writeFileSync(path, out.join(nl), 'utf8')
  const txt = readFileSync(path, 'utf8')
  const bad = []; for (const [s, kv] of Object.entries(plan)) for (const [k, v] of Object.entries(kv)) if (!new RegExp(`^${k.replace(/ /g, ' ')}=${v}\\s*$`, 'm').test(txt)) bad.push(`${s}.${k}`)
  return { backup, verified: bad.length === 0, bad }
}

const setPersistedGameCfgVerified = (path, plan, bdir = backupDir()) => {
  const backup = join(bdir, `PersistedSettings.json.${stamp()}.movement.bak`); copyFileSync(path, backup)
  const data = JSON.parse(readFileSync(path, 'utf8'))
  const g = (data.files || []).find((f) => f.name === 'Game.cfg'); if (!g) throw new Error('no Game.cfg node')
  for (const [sn, kv] of Object.entries(plan)) {
    let sec = (g.sections ||= []).find((s) => s.name === sn); if (!sec) { sec = { name: sn, settings: [] }; g.sections.push(sec) }
    for (const [k, v] of Object.entries(kv)) { const e = (sec.settings ||= []).find((x) => x.name === k); if (e) e.value = String(v); else sec.settings.push({ name: k, value: String(v) }) }
  }
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf8')
  const back = JSON.parse(readFileSync(path, 'utf8')).files.find((f) => f.name === 'Game.cfg').sections
  const bad = []; for (const [sn, kv] of Object.entries(plan)) for (const [k, v] of Object.entries(kv)) { const s = back.find((x) => x.name === sn); const e = s && s.settings.find((x) => x.name === k); if (!e || String(e.value) !== String(v)) bad.push(`${sn}.${k}`) }
  return { backup, verified: bad.length === 0, bad }
}

/**
 * deps: { findLcuApi, lcuRequest, isGameRunning, buildLolCandidates }
 * opts: { dryRun }
 */
const applyLolAbilitiesWert = async (deps, { dryRun = false, movementMode = null } = {}) => {
  if (deps.isGameRunning()) return { success: false, status: 'game-running', message: 'A League match is running — writes are blocked. Finish/quit the match first (MousKey never quits matches).' }
  const lcu = deps.findLcuApi()
  if (!lcu) return { success: false, status: 'client-not-running', message: 'League client (LeagueClientUx) is not running. Open the client (do not start a match), then retry.' }
  const auth = Buffer.from(`riot:${lcu.token}`).toString('base64')
  let phaseRes
  try { phaseRes = await deps.lcuRequest(lcu.port, auth, 'GET', '/lol-gameflow/v1/gameflow-phase') }
  catch (e) { return { success: false, status: 'client-not-ready', message: 'League client API not reachable yet (' + (e.code || e.message) + '). Wait for the client to finish loading and retry.' } }
  const phase = String(phaseRes.data || '').replace(/"/g, '')
  if (/InProgress|Reconnect|GameStart|ChampSelect/i.test(phase)) return { success: false, status: 'in-game', phase, message: `Gameflow phase ${phase}: writes are blocked.` }
  const get = await deps.lcuRequest(lcu.port, auth, 'GET', '/lol-game-settings/v1/input-settings')
  if (get.status !== 200) return { success: false, status: 'lcu-get-failed', message: `LCU GET input-settings HTTP ${get.status}` }
  const before = JSON.parse(get.data)
  const plan = planWert(before.GameEvents || {})
  if (plan.conflicts.length) return { success: false, status: 'conflict', conflicts: plan.conflicts, message: 'Current bindings differ from the approved plan; nothing written.' }
  const gsGet = await deps.lcuRequest(lcu.port, auth, 'GET', '/lol-game-settings/v1/game-settings')
  const gsBefore = gsGet.status === 200 ? JSON.parse(gsGet.data) : null
  if (dryRun) return { success: true, dryRun: true, phase, plan, movement: movementMode === 'click' ? CLICK_MOVE : null }
  const bdir = backupDir(); const s = stamp()
  const lcuBackup = join(bdir, `lcu-input-settings.${s}.json`)
  writeFileSync(lcuBackup, JSON.stringify(before, null, 2))
  const gsBackup = gsBefore ? join(bdir, `lcu-game-settings.${s}.json`) : null
  if (gsBackup) writeFileSync(gsBackup, JSON.stringify(gsBefore, null, 2))
  const movement = movementMode === 'click' ? await applyClickMove(deps, lcu, auth, bdir) : null
  if (!Object.keys(plan.updates).length) {
    const after0 = JSON.parse((await deps.lcuRequest(lcu.port, auth, 'GET', '/lol-game-settings/v1/input-settings')).data)
    const wertOk = Object.entries(WERT_PLAN).every(([k, [, to]]) => (after0.GameEvents || {})[k] === to)
    return { success: wertOk && (!movement || movement.verified), status: 'already-wert', lcuBackup, gsBackup, wertVerified: wertOk, movement, plan }
  }
  const patch = await deps.lcuRequest(lcu.port, auth, 'PATCH', '/lol-game-settings/v1/input-settings', JSON.stringify({ GameEvents: plan.updates }))
  if (patch.status !== 200 && patch.status !== 204) return { success: false, status: 'lcu-patch-failed', lcuBackup, message: `LCU PATCH HTTP ${patch.status}` }
  const after = JSON.parse((await deps.lcuRequest(lcu.port, auth, 'GET', '/lol-game-settings/v1/input-settings')).data)
  const lcuBad = Object.entries(plan.updates).filter(([k, v]) => (after.GameEvents || {})[k] !== v).map(([k]) => k)
  // untouched check: WASD section identical
  const wasdSame = JSON.stringify(before.WASD) === JSON.stringify(after.WASD)
  // try to persist on the client side too (best-effort)
  try { await deps.lcuRequest(lcu.port, auth, 'POST', '/lol-game-settings/v1/save') } catch { /* optional */ }
  const files = []
  const loc = deps.buildLolCandidates().find((c) => existsSync(c.persistedSettingsPath))
  if (loc) {
    try { files.push({ path: loc.persistedSettingsPath, ...writePersistedVerified(loc.persistedSettingsPath, 'GameEvents', plan.updates, bdir) }) } catch (e) { files.push({ path: loc.persistedSettingsPath, error: String(e) }) }
    if (existsSync(loc.inputPath)) {
      try { files.push({ path: loc.inputPath, ...writeInputIniVerified(loc.inputPath, 'GameEvents', plan.updates, bdir) }) } catch (e) { files.push({ path: loc.inputPath, error: String(e) }) }
    }
  }
  return { gsBackup, movement, success: lcuBad.length === 0 && (!movement || movement.verified), status: lcuBad.length ? 'lcu-verify-failed' : 'written', phase, lcuBackup, changed: plan.updates, already: plan.already, lcuVerified: lcuBad.length === 0, lcuBad, wasdUntouched: wasdSame, files }
}

const applyClickMove = async (deps, lcu, auth, bdir) => {
  const p = await deps.lcuRequest(lcu.port, auth, 'PATCH', '/lol-game-settings/v1/game-settings', JSON.stringify({ HUD: CLICK_MOVE.HUD, General: { CameraModeWASD: 0 } }))
  const gs = JSON.parse((await deps.lcuRequest(lcu.port, auth, 'GET', '/lol-game-settings/v1/game-settings')).data)
  const lcuView = { 'HUD.Movement Mode': gs.HUD && gs.HUD['Movement Mode'], 'General.CameraModeWASD': gs.General && gs.General.CameraModeWASD }
  try { await deps.lcuRequest(lcu.port, auth, 'POST', '/lol-game-settings/v1/save') } catch { /* optional */ }
  const files = []
  const loc = deps.buildLolCandidates().find((c) => existsSync(c.persistedSettingsPath))
  if (loc) {
    try { files.push({ path: loc.persistedSettingsPath, ...setPersistedGameCfgVerified(loc.persistedSettingsPath, { HUD: CLICK_MOVE.HUD, General: { CameraModeWASD: 0 } }, bdir) }) } catch (e) { files.push({ path: loc.persistedSettingsPath, error: String(e) }) }
    if (existsSync(loc.gameCfgPath)) { try { files.push({ path: loc.gameCfgPath, ...setGameCfgVerified(loc.gameCfgPath, CLICK_MOVE, bdir) }) } catch (e) { files.push({ path: loc.gameCfgPath, error: String(e) }) } }
  }
  const lcuOk = (p.status === 200 || p.status === 204) && Number(lcuView['HUD.Movement Mode']) === 0 && Number(lcuView['General.CameraModeWASD']) === 0
  return { patchStatus: p.status, lcuView, lcuVerified: lcuOk, files, verified: lcuOk && files.length > 0 && files.every((f) => f.verified) }
}

module.exports = { CLICK_MOVE, setGameCfgVerified, setPersistedGameCfgVerified, applyClickMove, WERT_PLAN, planWert, writePersistedVerified, writeInputIniVerified, applyLolAbilitiesWert }
