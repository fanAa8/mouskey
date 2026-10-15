// MousKey v2 API: games overview (requirements/strategy/status), launch, personal profiles, profile plan/apply.
// Single dispatcher used by both electron/main.cjs and vite dev middleware: POST /api/v2/<action>.
const { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, copyFileSync } = require('node:fs')
const { join, basename } = require('node:path')
const os = require('node:os')
const { execFileSync, spawn } = require('node:child_process')
const sem = require('./action-semantics.cjs')
const reqs = require('./game-requirements.cjs')

let _api = null
const api = () => (_api ||= require('./api-handlers.cjs'))
const ue4s = () => require('./ue4-strategies.cjs')
const unitys = () => require('./unity-strategies.cjs')
const br = () => require('./battlerite.cjs')
const lolAb = () => require('./lol-abilities.cjs')

const profilesDir = () => join(os.homedir(), 'Documents', 'Keyforge', 'presets', 'personal')

// ─── strategy selection ───
/**
 * Ordered strategy candidates for a game; first non-ineffective one is chosen.
 * Honors anti-cheat (→ none) and per-strategy 'ineffective' history.
 */
const selectStrategy = (game, ctx = {}) => {
  const antiCheat = ctx.antiCheat || []
  if (antiCheat.length) return { chosen: null, candidates: [], reason: '反作弊：不支持' }
  const id = game.gameId || ''
  let cands = []
  if (id === 'lol') cands = ['lcu']
  else if (game.engineType === 'ue4') {
    const st = ctx.ue4State || {}
    if (st.plan2b) cands = ['ue4ss', 'ue4-pak', 'ue4-clearArray']
    else if (st.plan2a) cands = ['ue4-pak', 'ue4ss', 'ue4-clearArray']
    else cands = ['ue4-clearArray', 'ue4-pak', 'ue4ss']
  } else if (game.engineType === 'unity') {
    const us = ctx.unityState || {}
    const keybindFile = game.configPath && /\.(json|ini|cfg)$/i.test(game.configFileName || '') && /input|key|bind|control/i.test(game.configFileName || '')
    if (us.planB) cands = ['bepinex', 'unity-ggm']
    else if (us.planA) cands = ['unity-ggm', 'bepinex']
    else if (keybindFile) cands = ['config', 'unity-ggm', 'bepinex']
    else cands = ['unity-ggm', 'bepinex']
  } else cands = ['config']
  const ineffective = new Set((ctx.history || []).filter((h) => h.status === 'ineffective').map((h) => String(h.plan).split(' ')[0]))
  const usable = cands.filter((c) => !ineffective.has(c))
  return { chosen: usable[0] || null, candidates: cands, skippedIneffective: cands.filter((c) => ineffective.has(c)) }
}
const STRATEGY_LABEL = {
  lcu: '客户端 API（LCU）', config: '配置文件', 'ue4-clearArray': 'UE Input.ini 重建（ClearArray）', 'ue4-pak': 'UE 补丁 pak（方案2A）',
  ue4ss: 'UE4SS 运行时模组（方案2B）', 'unity-ggm': 'Unity globalgamemanagers 补丁（方案A）', bepinex: 'BepInEx 运行时插件（方案B）',
}

const gameProcessName = (game) => {
  try {
    if (game.engineType === 'unity' && game.installPath) { const g = unitys().detectUnityGame(game.installPath); if (g) return g.exe }
  } catch { /* ignore */ }
  if (game.engineType === 'ue4' && game.ue4Project) return `${game.ue4Project}-Win64-Shipping.exe`
  if (/504370$/.test(game.gameId || '')) return 'Battlerite.exe'
  return null
}

const describeGame = (g, cache) => {
  let antiCheat = []
  try { if (g.installPath) antiCheat = ue4s().detectAntiCheat(g.installPath, 3) } catch { /* ignore */ }
  const status = reqs.statusFor(g)
  const ue4State = g.engineType === 'ue4' && g.ue4Project ? (cache.ue4.games || {})[g.ue4Project] : null
  let unityState = null
  if (g.engineType === 'unity' && g.installPath) {
    try { const u = unitys().detectUnityGame(g.installPath); const key = u && (u.product || null); unityState = key ? ((cache.unity && cache.unity.games) || {})[key] || null : null } catch { /* ignore */ }
  }
  const strat = selectStrategy(g, { antiCheat, ue4State, unityState, history: status.history })
  const requirements = reqs.requirementsFor(g, strat.chosen, antiCheat)
  return {
    gameId: g.gameId, name: g.name, engineType: g.engineType || null, steamAppId: g.steamAppId || null, installPath: g.installPath || null,
    configPath: g.configPath || null, configFileName: g.configFileName || null, source: g.source || null,
    antiCheat, status: status.status, history: status.history,
    strategy: strat.chosen, strategyLabel: STRATEGY_LABEL[strat.chosen] || '无', strategyCandidates: strat.candidates, skippedIneffective: strat.skippedIneffective || [],
    requirements, launch: reqs.launchInfo(g), adapter: sem.adapterFor(g).id, gameProcess: gameProcessName(g),
  }
}

const listGames = () => {
  const all = api().detectAllGames()
  const cache = { ue4: (() => { try { return ue4s().getStrategyState() } catch { return { games: {} } } })(), unity: (() => { try { return unitys().getUnityState() } catch { return { games: {} } } })() }
  const games = (all.games || []).filter((g) => g.found).map((g) => describeGame(g, cache))
  return { success: true, games }
}
const findGame = (gameId) => {
  const g = (api().detectAllGames().games || []).find((x) => x.gameId === gameId)
  if (!g) return null
  const cache = { ue4: (() => { try { return ue4s().getStrategyState() } catch { return { games: {} } } })(), unity: (() => { try { return unitys().getUnityState() } catch { return { games: {} } } })() }
  return { raw: g, info: describeGame(g, cache) }
}

// ─── runtime context for write gating ───
const runningProcs = () => {
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Get-Process | ForEach-Object { $_.ProcessName + ".exe" }'], { encoding: 'utf8', timeout: 8000 })
      .split(/\r?\n/).map((s) => s.trim().toLowerCase()).filter(Boolean)
  } catch { return [] }
}
const lcuContext = async () => {
  try { const r = await api().lolLcuGet('/lol-gameflow/v1/gameflow-phase'); if (!r) return { lcuRunning: false, lcuPhase: null }; return { lcuRunning: true, lcuPhase: String(r.data || '').replace(/"/g, '') } }
  catch { return { lcuRunning: false, lcuPhase: null } }
}
const gate = async (info) => {
  const ctx = { procs: runningProcs(), gameProcess: info.gameProcess }
  if (info.requirements.needsClientRunning) Object.assign(ctx, await lcuContext())
  return reqs.checkWrite(info.requirements, ctx)
}

// ─── launch ───
const launch = ({ gameId, dryRun = false, opener } = {}) => {
  const f = findGame(gameId)
  if (!f) return { success: false, message: '未找到该游戏' }
  const l = f.info.launch
  if (l.type === 'none') return { success: false, message: l.label }
  if (dryRun) return { success: true, dryRun: true, launch: l }
  if (l.type === 'url') {
    if (opener) opener(l.target)
    else spawn('cmd.exe', ['/c', 'start', '', l.target], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
  } else spawn(l.target, l.args || [], { detached: true, stdio: 'ignore', cwd: require('node:path').dirname(l.target) }).unref()
  return { success: true, message: `已发出启动：${l.label}`, launch: l }
}

// ─── personal profiles (stored next to presets) ───
const safeId = (s) => String(s || '').replace(/[^\w\-]/g, '_').slice(0, 64)
const hasKeyConflict = (p) => { const seen = new Set(); for (const k of Object.values((p && p.bindings) || {})) { if (seen.has(k)) return true; seen.add(k) } return false }
const listProfiles = () => {
  const d = profilesDir(); const out = sem.BUILTIN_PROFILES.map((p) => ({ ...p }))
  if (existsSync(d)) for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) { try { const p = JSON.parse(readFileSync(join(d, f), 'utf8')); if (/^(seed|preset)-/.test(String(p.id)) && hasKeyConflict(p)) continue; out.push(p) } catch { /* skip */ } }
  return { success: true, profiles: out, dir: d, catalog: sem.CATALOG, mouseCatalog: sem.MOUSE_CATALOG }
}
const saveProfile = (p = {}) => {
  if (!p.name) return { success: false, message: '方案需要名字' }
  if (!['keyboard', 'mouse'].includes(p.movementMode)) return { success: false, message: 'movementMode 必须是 keyboard 或 mouse' }
  const id = p.id && !String(p.id).startsWith('builtin-') ? safeId(p.id) : `p-${Date.now()}`
  const known = new Set(sem.catalogFor(p.movementMode).map((a) => a.id))
  const bindings = Object.fromEntries(Object.entries(p.bindings || {}).filter(([k, v]) => known.has(k) && typeof v === 'string' && v.trim()).map(([k, v]) => [k, v.trim().toUpperCase()]))
  const doc = { id, name: String(p.name).slice(0, 60), movementMode: p.movementMode, bindings, note: p.note || '', updatedAt: new Date().toISOString() }
  mkdirSync(profilesDir(), { recursive: true }); writeFileSync(join(profilesDir(), `${id}.json`), JSON.stringify(doc, null, 2))
  return { success: true, profile: doc }
}
const deleteProfile = ({ id } = {}) => {
  if (!id || String(id).startsWith('builtin-')) return { success: false, message: '内置方案不能删除' }
  const f = join(profilesDir(), `${safeId(id)}.json`); if (existsSync(f)) unlinkSync(f)
  return { success: true }
}
/** One-time migration of old 按键配置 seeds (sent by the UI) and saved presets (Documents/Keyforge/presets) into personal profiles. Idempotent by id. */
const presetsRoot = () => join(os.homedir(), 'Documents', 'Keyforge', 'presets')
const migrateProfiles = ({ seeds = [] } = {}) => {
  mkdirSync(profilesDir(), { recursive: true })
  const existing = new Set(readdirSync(profilesDir()).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)))
  const created = []
  const put = (old, prefix) => {
    const p = sem.convertOldProfile(old, prefix); const id = safeId(p.id)
    if (existing.has(id) || !Object.keys(p.bindings).length || hasKeyConflict(p)) return
    writeFileSync(join(profilesDir(), `${id}.json`), JSON.stringify({ ...p, id, updatedAt: new Date().toISOString() }, null, 2)); existing.add(id); created.push({ id, name: p.name, movementMode: p.movementMode })
  }
  for (const sd of seeds) if (sd && sd.id && sd.bindings) put(sd, 'seed-')
  if (existsSync(presetsRoot())) for (const f of readdirSync(presetsRoot()).filter((x) => x.endsWith('.keyforge.json'))) { try { put(JSON.parse(readFileSync(join(presetsRoot(), f), 'utf8')), 'preset-') } catch { /* skip */ } }
  return { success: true, created }
}
const getProfile = (id) => listProfiles().profiles.find((p) => p.id === id) || null

// native action names for dynamic adapters (UE: DefaultInput from pak/Input.ini; Unity: axes)
const nativeActionsFor = (raw) => {
  try {
    if (raw.engineType === 'ue4' && raw.installPath && raw.ue4Project) {
      const ue4g = require('./ue4-generic.cjs')
      const proj = ue4g.findUe4ProjectsInInstall(raw.installPath).find((p) => p.project.toLowerCase() === raw.ue4Project.toLowerCase())
      const d = proj ? ue4g.readDefaultInputFromPak(proj) : null
      const text = d ? d.text : ''
      const names = new Set(); for (const m of text.matchAll(/(?:Action|Axis)Name="?([^",)]+)"?/g)) names.add(m[1])
      // axis + sign → directional names
      for (const m of text.matchAll(/AxisName="?([^",)]+)"?,\s*Scale=(-?[\d.]+)/g)) names.add(`${m[1]}${Number(m[2]) < 0 ? '-' : '+'}`)
      return [...names]
    }
  } catch { /* ignore */ }
  return []
}

/** Plan a profile (or ESDF) over selected games. Read-only. */
const planProfile = ({ mode = 'esdf', profileId, gameIds = [] } = {}) => {
  const profile = mode === 'profile' ? getProfile(profileId) : null
  if (mode === 'profile' && !profile) return { success: false, message: '未找到个人方案' }
  const out = []
  for (const gid of gameIds) {
    const f = findGame(gid); if (!f) { out.push({ gameId: gid, ok: false, message: '未找到' }); continue }
    const { raw, info } = f
    if (info.requirements.unsupported) { out.push({ gameId: gid, name: info.name, ok: false, blocked: true, message: info.requirements.chips[0].text, info }); continue }
    if (mode === 'esdf') {
      const p = info.strategy === 'lcu' ? { success: false, message: '英雄联盟请使用个人方案（点击移动 + 技能键）' } : api().previewEsdfConfig({ gameId: gid, gameName: raw.name, configPath: raw.configPath, fileName: raw.configFileName, steamAppId: raw.steamAppId })
      const inst = installedState(raw); const already = p.status === 'already-esdf' || configWritten(info) || Object.values(inst).some(Boolean)
      if (already) { out.push({ gameId: gid, name: info.name, ok: false, mode, strategy: info.strategy, changes: [], status: 'already-esdf', message: '已是 ESDF，跳过', info }); continue }
      out.push({ gameId: gid, name: info.name, ok: !!p.success, mode, strategy: info.strategy, changes: p.changes || [], status: p.status, message: p.message, info })
      continue
    }
    const natives = sem.adapterFor(raw).dynamic ? nativeActionsFor(raw) : []
    const m = sem.mapProfileToGame(profile, raw, natives)
    const implemented = ['lol', 'battlerite'].includes(m.adapter) || (sem.isEsdfShiftOfWasd(profile) && profile.movementMode === 'keyboard' && info.strategy !== 'lcu')
    out.push({ gameId: gid, name: info.name, ok: m.applies, mode, strategy: info.strategy, mapping: m, implemented,
      message: implemented ? (m.adapter === 'lol' || m.adapter === 'battlerite' ? '可直接写入' : '方案等同 ESDF 平移：复用已验证的 ESDF 策略') : '仅预览：该引擎的自定义方案写入尚未实现（未知动作需确认）', info })
  }
  return { success: true, mode, profile, results: out }
}

// Battlerite: write mapped natives into KMInput.json (+ Steam Cloud copy)
const applyBattlerite = (raw, mapping) => {
  const file = join(raw.configPath, 'KMInput.json')
  if (!existsSync(file)) return { success: false, message: `未找到 ${file}` }
  const orig = readFileSync(file, 'utf8')
  const obj = JSON.parse(br().withDefaults('KMInput.json', orig))
  for (const m of mapping.mapped) obj[m.native] = [m.value]
  const next = JSON.stringify(obj, null, 2)
  const bdir = join(os.homedir(), 'Documents', 'Keyforge', 'backups', 'Battlerite'); mkdirSync(bdir, { recursive: true })
  const backup = join(bdir, `KMInput.json.${Date.now()}.bak`); copyFileSync(file, backup)
  writeFileSync(file, next, 'utf8')
  const verified = readFileSync(file, 'utf8') === next
  let cloud = []
  try { cloud = br().mirrorToCloud({ steamPath: api().getSteamPathForV2 ? api().getSteamPathForV2() : null, appId: '504370', fileName: 'KMInput.json', origText: orig, newText: next, label: 'Battlerite' }) } catch (e) { cloud = [{ error: String(e) }] }
  return { success: verified, backup, verified, cloud, file }
}

/** Apply to ONE game (UI loops so each game's gate/requirements are shown). */
const applyOne = async ({ mode = 'esdf', profileId, gameId, confirmUnknown = false, forceStrategy = null } = {}) => {
  const f = findGame(gameId); if (!f) return { success: false, message: '未找到该游戏' }
  const { raw, info } = f
  if (info.requirements.unsupported) return { success: false, blocked: true, message: info.requirements.chips[0].text }
  const g = await gate(info)
  if (!g.allowed) return { success: false, blocked: true, message: g.reason }
  let result
  if (forceStrategy) info.strategy = forceStrategy
  if (mode === 'esdf') {
    if (info.strategy !== 'config' && info.strategy !== 'ue4-clearArray') return { success: false, message: `该游戏的 ESDF 需走「${info.strategyLabel}」策略：请在「游戏迁移」点开该游戏，在「修改方式」里选择（批量不会自动安装模组/补丁）` }
    // Never shift twice: if the game is already ESDF/modified (config written by MousKey, patch/injection installed, or current bindings read as ESDF) skip without writing.
    const inst = installedState(raw); const on = Object.keys(inst).filter((k) => inst[k])
    if (on.length) return { success: true, skipped: true, alreadyEsdf: true, message: `已是 ESDF，跳过（已安装「${on.map((o) => STRATEGY_LABEL[o]).join('、')}」）` }
    if (configWritten(info)) return { success: true, skipped: true, alreadyEsdf: true, message: '已是 ESDF，跳过（MousKey 已写入过该游戏配置）' }
    const pv = api().previewEsdfConfig({ gameId, gameName: raw.name, configPath: raw.configPath, fileName: raw.configFileName, steamAppId: raw.steamAppId })
    if (pv && pv.status === 'already-esdf') return { success: true, skipped: true, alreadyEsdf: true, message: '已是 ESDF，跳过（当前键位已是 ESDF）' }
    result = api().migrateEsdfConfig({ gameId, gameName: raw.name, configPath: raw.configPath, fileName: raw.configFileName, steamAppId: raw.steamAppId })
  } else {
    const profile = getProfile(profileId); if (!profile) return { success: false, message: '未找到个人方案' }
    const natives = sem.adapterFor(raw).dynamic ? nativeActionsFor(raw) : []
    const m = sem.mapProfileToGame(profile, raw, natives)
    if (m.unknown.length && !confirmUnknown) return { success: false, needsConfirm: true, unknown: m.unknown, message: '有未识别的游戏动作，请确认后再写入' }
    if (m.collisions.length) return { success: false, collisions: m.collisions, message: '方案内有键位冲突' }
    if (m.adapter === 'lol') {
      const upd = Object.fromEntries(m.mapped.map((x) => [x.native, x.value]))
      result = await lolAb().applyLolUpdates(api().lolDeps(), upd, { movementMode: m.movementMode })
    } else if (m.adapter === 'battlerite') result = applyBattlerite(raw, m)
    else if (sem.isEsdfShiftOfWasd(profile) && (info.strategy === 'config' || info.strategy === 'ue4-clearArray')) result = api().migrateEsdfConfig({ gameId, gameName: raw.name, configPath: raw.configPath, fileName: raw.configFileName })
    else return { success: false, stub: true, message: '该游戏的自定义方案写入尚未实现（已生成预览）' }
  }
  if (result && result.success && !result.skipped) { try { reqs.setStatus(gameId, `${info.strategy} (${mode === 'esdf' ? 'ESDF' : profileId})`, 'written') } catch { /* ignore */ } }
  return { ...result, afterWrite: g.afterWrite, launch: info.launch }
}

// ─── per-game methods (priority order) + fallback chain ───
const INJECTION = new Set(['ue4-pak', 'ue4ss', 'bepinex'])
const PATCH = new Set(['unity-ggm'])
const methodOrder = (raw) => {
  if (raw.gameId === 'lol') return ['lcu']
  if (raw.engineType === 'ue4') return ['ue4-clearArray', 'ue4-pak', 'ue4ss']
  if (raw.engineType === 'unity') {
    const kb = raw.configPath && /\.(json|ini|cfg)$/i.test(raw.configFileName || '') && /input|key|bind|control/i.test(raw.configFileName || '')
    return kb ? ['config', 'unity-ggm', 'bepinex'] : ['unity-ggm', 'bepinex']
  }
  return ['config']
}
const installedState = (raw) => {
  const out = {}
  try { if (raw.engineType === 'ue4' && raw.ue4Project) { const g = (ue4s().getStrategyState().games || {})[raw.ue4Project] || {}; out['ue4-pak'] = !!g.plan2a; out.ue4ss = !!g.plan2b } } catch { /* ignore */ }
  try {
    if (raw.engineType === 'unity' && raw.installPath) {
      const u = unitys().detectUnityGame(raw.installPath); const g = (u && (unitys().getUnityState().games || {})[u.product]) || {}
      out['unity-ggm'] = !!g.planA; out.bepinex = !!g.planB
    }
  } catch { /* ignore */ }
  return out
}
const listMethods = ({ gameId } = {}) => {
  const f = findGame(gameId); if (!f) return { success: false, message: '未找到该游戏' }
  const { raw, info } = f
  const inst = installedState(raw)
  const lastStatus = {}
  for (const h of info.history || []) lastStatus[String(h.plan).split(' ')[0]] = h.status
  const methods = methodOrder(raw).map((id, i) => ({
    id, label: STRATEGY_LABEL[id] || id, priority: i + 1,
    kind: INJECTION.has(id) ? 'injection' : PATCH.has(id) ? 'patch' : 'config',
    installed: !!inst[id], status: lastStatus[id] || null,
    ops: id === 'unity-ggm' ? ['apply', 'uninstall'] : INJECTION.has(id) ? ['install', 'uninstall'] : id === 'lcu' ? ['apply'] : ['apply', 'restore'],
  }))
  const unsupported = info.requirements.unsupported
  const current = methods.find((m) => m.installed) || methods.find((m) => m.status === 'verified-in-game' || m.status === 'written') || null
  const recommended = unsupported ? null : (current && current.status !== 'ineffective' ? current : methods.find((m) => m.status !== 'ineffective' && m !== current)) || null
  return { success: true, configWritten: configWritten(info), configBackups: configBackups(raw).map((f) => basename(f)), methods, current: current && current.id, recommended: recommended && recommended.id, unsupported, antiCheat: info.antiCheat }
}
const uninstallMethod = (raw, id) => {
  if (id === 'ue4-pak') return api().ue4Strategy({ action: 'pak-uninstall', gameId: raw.gameId })
  if (id === 'ue4ss') return api().ue4Strategy({ action: 'ue4ss-uninstall', gameId: raw.gameId })
  if (id === 'unity-ggm') return api().unityStrategy({ action: 'im-revert', installPath: raw.installPath })
  if (id === 'bepinex') return api().unityStrategy({ action: 'bepinex-uninstall', installPath: raw.installPath })
  return { success: false, message: '该方式没有卸载操作（配置文件类请用备份恢复）' }
}
// ─── double-shift guard: config/Input.ini ESDF writes vs patch/injection methods ───
const CONFIG_METHODS = new Set(['config', 'ue4-clearArray'])
const configWritten = (info) => {
  let on = false
  for (const h of info.history || []) {
    const m = String(h.plan).split(' ')[0]
    if (!CONFIG_METHODS.has(m)) continue
    if (h.status === 'written' || h.status === 'verified-in-game') on = true
    if (h.status === 'restored') on = false
  }
  return on
}
const configBackups = (raw) => {
  if (!raw.configPath || !raw.configFileName) return []
  const d = join(raw.configPath, 'keyforge_backups'); if (!existsSync(d)) return []
  return readdirSync(d).filter((f) => f.startsWith(`${raw.gameId}_${raw.configFileName}.`) && f.endsWith('.bak')).sort().map((f) => join(d, f))
}
/** Restore the config file to the OLDEST MousKey backup (= state before the first ESDF write). Current file is backed up first. */
const restoreConfig = (raw, method) => {
  const target = raw.configPath && raw.configFileName ? join(raw.configPath, raw.configFileName) : null
  const baks = configBackups(raw)
  if (!target || !baks.length) return { success: false, message: '找不到配置文件的 MousKey 备份，无法自动恢复；请手动恢复后再继续' }
  const orig = baks[0]
  let safety = null
  if (existsSync(target)) { safety = join(raw.configPath, 'keyforge_backups', `${raw.gameId}_${raw.configFileName}.${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.before-restore.bak`); copyFileSync(target, safety) }
  copyFileSync(orig, target)
  if (readFileSync(target).compare(readFileSync(orig)) !== 0) return { success: false, message: '恢复后回读校验失败', safety }
  try { reqs.setStatus(raw.gameId, `${method || 'config'} (restore)`, 'restored') } catch { /* ignore */ }
  return { success: true, message: `已从备份恢复：${basename(orig)}`, restoredFrom: orig, safety }
}

/** Run one method on one game. Mutual exclusion: other installed patch/injection methods are uninstalled first. Injection needs confirm. */
const runMethod = async ({ gameId, method, op = 'apply', confirm = false, restoreFirst = false } = {}) => {
  const f = findGame(gameId); if (!f) return { success: false, message: '未找到该游戏' }
  const { raw, info } = f
  if (info.requirements.unsupported) return { success: false, blocked: true, message: '反作弊游戏：不支持任何修改方式' }
  const order = methodOrder(raw); if (!order.includes(method)) return { success: false, message: `该游戏不适用方式 ${method}` }
  const g = await gate(info)
  if (!g.allowed) return { success: false, blocked: true, message: g.reason }
  if (op === 'uninstall') { const r = uninstallMethod(raw, method); return { ...r, method, op } }
  if (op === 'restore') { const r = restoreConfig(raw, method); return { ...r, method, op } }
  const inst = installedState(raw)
  const others = Object.keys(inst).filter((o) => o !== method && inst[o])
  if ((INJECTION.has(method) || PATCH.has(method)) && configWritten(info)) {
    const baks = configBackups(raw)
    if (!restoreFirst) return { success: false, needsRestore: true, backup: baks[0] || null, message: baks.length ? `该游戏的配置文件已写入过 ESDF（${STRATEGY_LABEL.config}/Input.ini）。再装「${STRATEGY_LABEL[method]}」会双重平移。需先从备份恢复原始配置：${basename(baks[0])}` : '该游戏的配置文件已写入过 ESDF，但找不到 MousKey 备份，无法自动恢复——已阻止，避免双重平移' }
    if (!baks.length) return { success: false, blocked: true, message: '找不到配置备份，已阻止' }
  }
  if (CONFIG_METHODS.has(method) && others.length && !confirm) {
    return { success: false, needsConfirm: true, message: `已安装「${others.map((o) => STRATEGY_LABEL[o]).join('、')}」，会先卸载它们再写配置，避免双重平移` }
  }
  if ((INJECTION.has(method) || PATCH.has(method)) && !confirm) {
    return { success: false, needsConfirm: true, message: INJECTION.has(method) ? `「${STRATEGY_LABEL[method]}」会向游戏目录注入运行时模组/补丁文件，确认后执行` : `「${STRATEGY_LABEL[method]}」会修改游戏数据文件（有备份），确认后执行` }
  }
  const removed = []
  if ((INJECTION.has(method) || PATCH.has(method)) && configWritten(info) && restoreFirst) {
    const rr = restoreConfig(raw, 'config'); if (!rr.success) return { ...rr, method }
    removed.push('config(已恢复)')
  }
  for (const other of Object.keys(inst)) {
    if (other === method || !inst[other]) continue
    const r = uninstallMethod(raw, other)
    if (!r.success) return { success: false, message: `先卸载「${STRATEGY_LABEL[other]}」失败：${r.message}，已停止，避免双重平移` }
    removed.push(other)
  }
  let r
  if (method === 'ue4-pak') r = api().ue4Strategy({ action: 'pak-install', gameId })
  else if (method === 'ue4ss') r = api().ue4Strategy({ action: 'ue4ss-install', gameId })
  else if (method === 'unity-ggm') r = api().unityStrategy({ action: 'im-apply', installPath: raw.installPath })
  else if (method === 'bepinex') r = api().unityStrategy({ action: 'bepinex-install', installPath: raw.installPath })
  else if (method === 'lcu') return { success: false, message: '英雄联盟请在上方选择「个人方案」（如 LoL WERT / 点击移动）批量写入，通过客户端 API 生效', method }
  else return { ...(await applyOne({ mode: 'esdf', gameId, forceStrategy: method })), method, removed }
  if (r && r.success) { try { reqs.setStatus(gameId, `${method} (ESDF)`, 'written') } catch { /* ignore */ } }
  return { ...r, method, op, removed, afterWrite: g.afterWrite }
}

/** Read-only: backup files that belong to a game (Documents/Keyforge/backups/* and keyforge_backups next to its config). */
const listBackups = ({ gameId } = {}) => {
  const f = findGame(gameId); if (!f) return { success: false, message: '未找到该游戏' }
  const { raw, info } = f
  const dirs = []
  const root = join(os.homedir(), 'Documents', 'Keyforge', 'backups')
  const names = [raw.name, raw.ue4Project, gameId === 'lol' ? 'LoL' : null, /504370$/.test(gameId) ? 'Battlerite' : null, /shadow ?puppet/i.test(raw.name || '') ? 'ShadowPuppet' : null].filter(Boolean)
  for (const n of names) dirs.push(join(root, n))
  if (raw.configPath) dirs.push(join(raw.configPath, 'keyforge_backups'))
  const files = []
  for (const d of [...new Set(dirs)]) { if (!existsSync(d)) continue; for (const x of readdirSync(d, { withFileTypes: true })) files.push({ path: join(d, x.name), dir: x.isDirectory() }) }
  return { success: true, files: files.slice(0, 200), status: info.status }
}

const dispatch = async (action, body = {}, extra = {}) => {
  switch (action) {
    case 'catalog': return { success: true, catalog: sem.CATALOG, mouseCatalog: sem.MOUSE_CATALOG, builtin: sem.BUILTIN_PROFILES }
    case 'profiles.migrate': return migrateProfiles(body)
    case 'backups': return listBackups(body)
    case 'methods': return listMethods(body)
    case 'method.run': return runMethod(body)
    case 'games': return listGames()
    case 'launch': return launch({ ...body, opener: extra.opener })
    case 'profiles.list': return listProfiles()
    case 'profiles.save': return saveProfile(body)
    case 'profiles.delete': return deleteProfile(body)
    case 'plan': return planProfile(body)
    case 'apply': return applyOne(body)
    case 'status.set': return reqs.setStatus(body.gameId, body.plan || 'manual', body.status, body.note)
    default: return { success: false, message: `unknown v2 action ${action}` }
  }
}

module.exports = { hasKeyConflict, configWritten, configBackups, restoreConfig, listMethods, runMethod, methodOrder, migrateProfiles, listBackups, dispatch, selectStrategy, listProfiles, saveProfile, deleteProfile, planProfile, STRATEGY_LABEL }
