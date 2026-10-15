// Per-game apply requirements, launch info, effect status registry and write gating.
const { existsSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const os = require('node:os')

const keyforgeDir = () => join(os.homedir(), 'Documents', 'Keyforge')
const STATUS_FILE = () => join(keyforgeDir(), 'game-status.json')

// Verified-in-game history (seeded; user confirmations 2026-10-16)
const VERIFIED_SEED = {
  'ue4-1260760': [{ plan: 'ue4-pak (2A)', status: 'verified-in-game' }, { plan: 'ue4ss (2B, RFDG)', status: 'verified-in-game' }],
  'unity-shadowpuppet': [{ plan: 'unity-globalgamemanagers (A, ESDF)', status: 'verified-in-game' }],
  'unity-504370': [{ plan: 'config KMInput.json + Steam Cloud', status: 'verified-in-game' }],
  lol: [{ plan: 'lcu GameEvents WERT + click-to-move', status: 'verified-in-game' }],
}
const loadStatus = () => { try { return JSON.parse(readFileSync(STATUS_FILE(), 'utf8')) } catch { return { games: {} } } }
const saveStatus = (s) => { mkdirSync(keyforgeDir(), { recursive: true }); writeFileSync(STATUS_FILE(), JSON.stringify(s, null, 2)) }
const statusFor = (game) => {
  const id = game.gameId
  const s = loadStatus().games[id] || []
  let seed = VERIFIED_SEED[id] || []
  if (!seed.length && /shadow ?puppet/i.test(game.name || '')) seed = VERIFIED_SEED['unity-shadowpuppet']
  const all = [...seed, ...s]
  const best = all.some((x) => x.status === 'verified-in-game') ? 'verified-in-game' : all.some((x) => x.status === 'written') ? 'written' : all.some((x) => x.status === 'ineffective') ? 'ineffective' : null
  return { status: best, history: all }
}
const setStatus = (gameId, plan, status, note) => {
  if (!['written', 'verified-in-game', 'ineffective'].includes(status)) throw new Error('bad status')
  const s = loadStatus(); (s.games[gameId] ||= []).push({ plan, status, note: note || null, at: new Date().toISOString() }); saveStatus(s)
  return { success: true }
}

/** Launch descriptor (not executed here). */
const launchInfo = (game, env = {}) => {
  if (game.gameId === 'lol') {
    const roots = env.lolRoots || ['D:\\WeGameApps\\英雄联盟', 'C:\\Riot Games\\League of Legends']
    for (const r of roots) {
      for (const rel of ['TCLS\\Client.exe', 'Launcher\\Client.exe', 'LeagueClient.exe']) {
        const p = join(r, rel); if ((env.exists || existsSync)(p)) return { type: 'exe', target: p, label: '启动英雄联盟客户端' }
      }
    }
    const riot = 'C:\\Riot Games\\Riot Client\\RiotClientServices.exe'
    if ((env.exists || existsSync)(riot)) return { type: 'exe', target: riot, args: ['--launch-product=league_of_legends', '--launch-patchline=live'], label: '通过 Riot Client 启动' }
    return { type: 'none', label: '未找到英雄联盟启动器（WeGame 用户请从 WeGame 启动）' }
  }
  if (game.steamAppId) return { type: 'url', target: `steam://rungameid/${game.steamAppId}`, label: '通过 Steam 启动' }
  if (game.exePath) return { type: 'exe', target: game.exePath, label: '直接启动' }
  return { type: 'none', label: '未知启动方式' }
}

/**
 * Requirements per game + strategy. Returns chips the UI shows and flags the write gate uses.
 * strategy ∈ config | ue4-clearArray | ue4-pak | ue4ss | unity-ggm | bepinex | lcu
 */
const requirementsFor = (game, strategy, antiCheat = []) => {
  const r = { chips: [], needsClientRunning: false, mustNotBeInMatch: false, mustBeClosed: false, restartAfterWrite: false, unsupported: false, cloudSync: null }
  if (antiCheat.length) { r.unsupported = true; r.chips.push({ level: 'block', text: `检测到反作弊（${antiCheat.join('、')}），不支持` }); return r }
  if (strategy === 'lcu') {
    r.needsClientRunning = true; r.mustNotBeInMatch = true
    r.chips.push({ level: 'warn', text: '需要客户端开着、不在对局中修改' }, { level: 'info', text: '写入后立即同步到账号（云端）' })
    r.cloudSync = 'account'
    return r
  }
  r.mustBeClosed = true; r.restartAfterWrite = true
  r.chips.push({ level: 'warn', text: '写入时需关闭游戏' }, { level: 'info', text: '修改后需重启游戏生效' })
  if (strategy === 'ue4ss' || strategy === 'bepinex') r.chips.push({ level: 'warn', text: '会在游戏目录安装运行时模组（可一键卸载）' })
  if (strategy === 'ue4-pak' || strategy === 'unity-ggm') r.chips.push({ level: 'warn', text: '会修改/新增游戏数据文件（已备份，可还原；游戏更新后需重做）' })
  if (/504370$/.test(game.gameId || '')) { r.cloudSync = 'steam'; r.chips.push({ level: 'info', text: 'Steam 云同步副本会一并写入' }) }
  return r
}

/** Gate a write. procs: lowercase process names currently running. lcuPhase: gameflow phase or null. */
const checkWrite = (req, { procs = [], lcuRunning = false, lcuPhase = null, gameProcess = null } = {}) => {
  if (req.unsupported) return { allowed: false, reason: '反作弊游戏不支持写入' }
  if (req.needsClientRunning && !lcuRunning) return { allowed: false, reason: '请先打开游戏客户端（不要进入对局）' }
  if (req.mustNotBeInMatch && (procs.includes('league of legends.exe') || /InProgress|Reconnect|ChampSelect|GameStart/i.test(lcuPhase || ''))) return { allowed: false, reason: '对局进行中，请结束对局后再写入' }
  if (req.mustBeClosed && gameProcess && procs.includes(gameProcess.toLowerCase())) return { allowed: false, reason: `游戏正在运行（${gameProcess}），请先关闭游戏` }
  return { allowed: true, afterWrite: req.restartAfterWrite ? '修改后需重启游戏生效' : null }
}

module.exports = { VERIFIED_SEED, statusFor, setStatus, launchInfo, requirementsFor, checkWrite, loadStatus, STATUS_FILE }
