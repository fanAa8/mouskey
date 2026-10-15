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
    if (game.configPath && /\.(json|ini|cfg)$/i.test(game.configFileName || '')) cands = ['config', 'unity-ggm', 'bepinex']
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
  const strat = selectStrategy(g, { antiCheat, ue4State, history: status.history })
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
  const cache = { ue4: (() => { try { return ue4s().getStrategyState() } catch { return { games: {} } } })() }
  const games = (all.games || []).filter((g) => g.found).map((g) => describeGame(g, cache))
  return { success: true, games }
}
const findGame = (gameId) => {
  const g = (api().detectAllGames().games || []).find((x) => x.gameId === gameId)
  if (!g) return null
  const cache = { ue4: (() => { try { return ue4s().getStrategyState() } catch { return { games: {} } } })() }
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
const listProfiles = () => {
  const d = profilesDir(); const out = sem.BUILTIN_PROFILES.map((p) => ({ ...p }))
  if (existsSync(d)) for (const f of readdirSync(d).filter((x) => x.endsWith('.json'))) { try { out.push(JSON.parse(readFileSync(join(d, f), 'utf8'))) } catch { /* skip */ } }
  return { success: true, profiles: out, dir: d, catalog: sem.CATALOG }
}
const saveProfile = (p = {}) => {
  if (!p.name) return { success: false, message: '方案需要名字' }
  if (!['keyboard', 'mouse'].includes(p.movementMode)) return { success: false, message: 'movementMode 必须是 keyboard 或 mouse' }
  const id = p.id && !String(p.id).startsWith('builtin-') ? safeId(p.id) : `p-${Date.now()}`
  const known = new Set(sem.CATALOG.map((a) => a.id))
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
const applyOne = async ({ mode = 'esdf', profileId, gameId, confirmUnknown = false } = {}) => {
  const f = findGame(gameId); if (!f) return { success: false, message: '未找到该游戏' }
  const { raw, info } = f
  if (info.requirements.unsupported) return { success: false, blocked: true, message: info.requirements.chips[0].text }
  const g = await gate(info)
  if (!g.allowed) return { success: false, blocked: true, message: g.reason }
  let result
  if (mode === 'esdf') {
    if (info.strategy !== 'config' && info.strategy !== 'ue4-clearArray') return { success: false, message: `该游戏的 ESDF 需走「${info.strategyLabel}」策略：请在按键配置页的策略面板操作（不会自动安装模组/补丁）` }
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

const dispatch = async (action, body = {}, extra = {}) => {
  switch (action) {
    case 'catalog': return { success: true, catalog: sem.CATALOG, builtin: sem.BUILTIN_PROFILES }
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

module.exports = { dispatch, selectStrategy, listProfiles, saveProfile, deleteProfile, planProfile, STRATEGY_LABEL }
