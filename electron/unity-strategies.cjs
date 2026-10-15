/**
 * Unity strategies (beyond config files; user-approved, never with anti-cheat):
 *   - detectUnityGame: exe-named *_Data (any depth ≤2) + UnityPlayer.dll; backend (Mono/IL2CPP),
 *     input stack (legacy InputManager / new Input System / Rewired), app.info company/product
 *   - Plan U-A: patch InputManager axes in <Game>_Data/globalgamemanagers (same-length button
 *     strings, e.g. alt buttons "a"→"s"); backup + restore
 *   - Plan U-B: BepInEx 5 (Mono) + MousKeyRemap plugin (Harmony hooks on Input.GetKey / GetAxis)
 */
const { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } = require('node:fs')
const { join, dirname, basename } = require('node:path')
const crypto = require('node:crypto')
const os = require('node:os')
const ue4s = require('./ue4-strategies.cjs')

const keyforgeDir = () => join(process.env.USERPROFILE || os.homedir(), 'Documents', 'Keyforge')
const stateFile = () => join(keyforgeDir(), 'unity-strategies.json')
const loadState = () => { try { return JSON.parse(readFileSync(stateFile(), 'utf8')) } catch { return { games: {} } } }
const saveState = (s) => { mkdirSync(keyforgeDir(), { recursive: true }); writeFileSync(stateFile(), JSON.stringify(s, null, 2)) }
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex')

/** Find the Unity player folder: dir containing UnityPlayer.dll (or <exe>_Data next to <exe>.exe). */
const detectUnityGame = (installPath, maxDepth = 2) => {
  const found = []
  const walk = (dir, d) => {
    if (d > maxDepth) return
    let es; try { es = readdirSync(dir, { withFileTypes: true }) } catch { return }
    const names = es.map((e) => e.name)
    for (const e of es) {
      if (!e.isDirectory() || !/_Data$/i.test(e.name)) continue
      const exe = e.name.replace(/_Data$/i, '') + '.exe'
      const hasExe = names.some((n) => n.toLowerCase() === exe.toLowerCase())
      const hasPlayer = names.some((n) => /^UnityPlayer\.dll$/i.test(n))
      const dataDir = join(dir, e.name)
      if ((hasExe || hasPlayer) && existsSync(join(dataDir, 'globalgamemanagers'))) found.push({ gameDir: dir, dataDir, exe, hasPlayer })
    }
    for (const e of es) if (e.isDirectory() && !/_Data$/i.test(e.name) && !/^(MonoBleedingEdge|BepInEx)$/i.test(e.name)) walk(join(dir, e.name), d + 1)
  }
  if (installPath && existsSync(installPath)) walk(installPath, 0)
  if (!found.length) return null
  const g = found[0]
  const managed = join(g.dataDir, 'Managed')
  const has = (f) => existsSync(join(managed, f))
  let company = null, product = null
  try { [company, product] = readFileSync(join(g.dataDir, 'app.info'), 'utf8').split(/\r?\n/) } catch { /* ignore */ }
  const backend = existsSync(join(g.gameDir, 'GameAssembly.dll')) ? 'il2cpp' : (has('Assembly-CSharp.dll') ? 'mono' : 'unknown')
  const inputStack = []
  if (has('Unity.InputSystem.dll')) inputStack.push('new-input-system')
  if (has('Rewired_Core.dll') || has('Rewired_Windows.dll')) inputStack.push('rewired')
  if (has('UnityEngine.InputLegacyModule.dll') || backend === 'il2cpp') inputStack.push('legacy-input-manager')
  const antiCheat = ue4s.detectAntiCheat(installPath)
  return {
    ...g, company, product, backend, inputStack, antiCheat,
    registryKey: company && product ? `HKCU\\Software\\${company}\\${product}` : null,
    localLow: company && product ? join(process.env.USERPROFILE || os.homedir(), 'AppData', 'LocalLow', company, product) : null,
  }
}

// ─── Plan U-A: InputManager patch ───
// Each axis in InputManager is serialized as: m_Name, descriptiveName, descriptiveNegativeName,
// negativeButton, positiveButton, altNegativeButton, altPositiveButton (aligned strings), then numbers.
const readAligned = (buf, off) => {
  const len = buf.readInt32LE(off)
  if (len < 0 || len > 256 || off + 4 + len > buf.length) return null
  const str = buf.toString('utf8', off + 4, off + 4 + len)
  return { str, len, strOff: off + 4, next: off + 4 + len + ((4 - (len % 4)) % 4) }
}
const encodeAligned = (s) => { const b = Buffer.alloc(4 + s.length + ((4 - (s.length % 4)) % 4)); b.writeInt32LE(s.length, 0); b.write(s, 4, 'utf8'); return b }

/** Find InputManager axis records by name and return their button string slots. */
const findAxes = (buf, axisNames = ['Horizontal', 'Vertical']) => {
  const out = []
  for (const name of axisNames) {
    const pat = encodeAligned(name)
    let i = buf.indexOf(pat)
    while (i >= 0) {
      let p = i
      const fields = []
      let ok = true
      for (let k = 0; k < 7; k++) { const s = readAligned(buf, p); if (!s) { ok = false; break } fields.push(s); p = s.next }
      // sanity: negative/positive buttons look like key names
      if (ok && /^(left|right|up|down|[a-z]|)$/.test(fields[3].str) && /^(left|right|up|down|[a-z]|)$/.test(fields[4].str)) {
        out.push({ name, offset: i, negative: fields[3], positive: fields[4], altNegative: fields[5], altPositive: fields[6] })
      }
      i = buf.indexOf(pat, i + 1)
    }
  }
  return out
}

/** Unity key-name shift for single letters, same length only. */
const shiftUnityKey = (k, map) => (/^[a-z]$/.test(k) && map[k] && map[k].length === 1 ? map[k] : null)

const patchInputManagerBuffer = (buf, map) => {
  const out = Buffer.from(buf)
  const axes = findAxes(out)
  const changes = []
  for (const a of axes) {
    for (const slot of ['negative', 'positive', 'altNegative', 'altPositive']) {
      const f = a[slot]
      const t = shiftUnityKey(f.str, map)
      if (t) { out.write(t, f.strOff, 'utf8'); changes.push(`${a.name}.${slot}: ${f.str} → ${t}`) }
    }
  }
  return { buf: out, changes, axes: axes.length }
}

const ESDF_MAP = { w: 'e', a: 's', s: 'd', d: 'f' }

const applyInputManagerPatch = ({ installPath, map = ESDF_MAP, dryRun = false } = {}) => {
  const g = detectUnityGame(installPath)
  if (!g) return { success: false, message: '未识别为 Unity 游戏' }
  if (g.antiCheat.length) return { success: false, message: `检测到反作弊（${g.antiCheat.join('、')}），不支持` }
  const file = join(g.dataDir, 'globalgamemanagers')
  const key = g.product || basename(g.gameDir)
  const st = loadState()
  const prev = st.games[key] && st.games[key].planA
  if (prev) return { success: false, message: '已安装方案 U-A，请先还原再重新应用', game: g }
  const orig = readFileSync(file)
  const r = patchInputManagerBuffer(orig, map)
  if (!r.changes.length) return { success: false, message: `InputManager 中没有可改的字母键（找到 ${r.axes} 个轴）`, game: g }
  if (dryRun) return { success: true, dryRun: true, changes: r.changes, game: g }
  const bdir = join(keyforgeDir(), 'backups', key)
  mkdirSync(bdir, { recursive: true })
  const backup = join(bdir, `globalgamemanagers.${sha256(orig).slice(0, 12)}.orig`)
  if (!existsSync(backup)) copyFileSync(file, backup)
  writeFileSync(file, r.buf)
  const verify = patchInputManagerBuffer(readFileSync(file), {}) // reread & locate axes
  st.games[key] = { ...(st.games[key] || {}), planA: { file, backup, origSha: sha256(orig), patchedSha: sha256(r.buf), changes: r.changes, at: new Date().toISOString() }, status: 'written' }
  saveState(st)
  return { success: true, changes: r.changes, backup, verified: verify.axes === r.axes && sha256(readFileSync(file)) === sha256(r.buf), game: g }
}

const revertInputManagerPatch = ({ installPath } = {}) => {
  const g = detectUnityGame(installPath)
  if (!g) return { success: false, message: '未识别为 Unity 游戏' }
  const key = g.product || basename(g.gameDir)
  const st = loadState(); const a = st.games[key] && st.games[key].planA
  if (!a) return { success: true, message: '未安装方案 U-A' }
  const cur = sha256(readFileSync(a.file))
  if (cur !== a.patchedSha && cur !== a.origSha) return { success: false, message: 'globalgamemanagers 已被游戏更新改变，拒绝覆盖；请用 Steam 校验文件完整性还原' }
  copyFileSync(a.backup, a.file)
  delete st.games[key].planA; saveState(st)
  return { success: true, message: `已还原 ${a.file}` }
}

// ─── Plan U-B: BepInEx + MousKeyRemap plugin ───
const unityToolsDir = () => join(__dirname, '..', 'tools', 'unity')

/** remap: physical → logical, e.g. { R: 'W', F: 'S', D: 'A', G: 'D', H: 'F' } */
const writeRemapConfig = (path, remap) => {
  const lines = ['# MousKey remap: physical = logical (game asks for logical, player presses physical)', ...Object.entries(remap).map(([p, l]) => `${p}=${l}`)]
  writeFileSync(path, lines.join('\r\n') + '\r\n', 'utf8')
}

const installBepInEx = ({ installPath, remap } = {}) => {
  const g = detectUnityGame(installPath)
  if (!g) return { success: false, message: '未识别为 Unity 游戏' }
  if (g.antiCheat.length) return { success: false, message: `检测到反作弊（${g.antiCheat.join('、')}），拒绝安装` }
  if (g.backend !== 'mono') return { success: false, message: `后端为 ${g.backend}：需要 BepInEx IL2CPP 版本（BepInEx 6），暂未实现` }
  const bep = join(unityToolsDir(), 'bepinex5_x64')
  const plugin = join(unityToolsDir(), 'MousKeyRemap.dll')
  if (!existsSync(bep) || !existsSync(plugin)) return { success: false, message: `缺少 BepInEx 或插件文件：${bep}` }
  const added = []
  const copyTree = (src, dst) => {
    for (const e of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, e.name); const d = join(dst, e.name)
      if (e.isDirectory()) { mkdirSync(d, { recursive: true }); copyTree(s, d) }
      else { if (existsSync(d)) throw new Error(`目标已存在，拒绝覆盖：${d}`); copyFileSync(s, d); added.push(d) }
    }
  }
  try {
    copyTree(bep, g.gameDir)
    const pdir = join(g.gameDir, 'BepInEx', 'plugins', 'MousKeyRemap')
    mkdirSync(pdir, { recursive: true })
    copyFileSync(plugin, join(pdir, 'MousKeyRemap.dll')); added.push(join(pdir, 'MousKeyRemap.dll'))
    writeRemapConfig(join(pdir, 'remap.txt'), remap || { E: 'W', S: 'A', D: 'S', F: 'D' }); added.push(join(pdir, 'remap.txt'))
  } catch (e) {
    for (const f of added.reverse()) rmSync(f, { force: true })
    return { success: false, message: `安装失败已回滚：${e.message}` }
  }
  const st = loadState(); const key = g.product || basename(g.gameDir)
  st.games[key] = { ...(st.games[key] || {}), planB: { gameDir: g.gameDir, added, remap, at: new Date().toISOString() }, status: 'written' }
  saveState(st)
  return { success: true, added: added.length, message: `已安装 BepInEx + MousKeyRemap（${Object.keys(remap || {}).length} 个映射）` }
}

const uninstallBepInEx = ({ installPath } = {}) => {
  const g = detectUnityGame(installPath)
  const key = g ? (g.product || basename(g.gameDir)) : null
  const st = loadState(); const b = key && st.games[key] && st.games[key].planB
  if (!b) return { success: true, message: '未安装方案 U-B' }
  for (const f of b.added) rmSync(f, { force: true })
  // BepInEx creates config/, cache/, LogOutput.log at runtime: remove the whole BepInEx dir we introduced
  rmSync(join(b.gameDir, 'BepInEx'), { recursive: true, force: true })
  delete st.games[key].planB; saveState(st)
  return { success: true, message: '已卸载 BepInEx（含其运行时生成的 BepInEx 目录）' }
}

const setUnityStatus = ({ product, status, plan, note } = {}) => {
  if (!ue4s.EFFECT_STATES.includes(status)) return { success: false, message: 'bad status' }
  const st = loadState(); const g = st.games[product] || {}
  g.status = status; g.history = [...(g.history || []), { at: new Date().toISOString(), status, plan, note }]
  st.games[product] = g; saveState(st); return { success: true, game: g }
}

module.exports = {
  detectUnityGame, findAxes, patchInputManagerBuffer, applyInputManagerPatch, revertInputManagerPatch,
  installBepInEx, uninstallBepInEx, setUnityStatus, ESDF_MAP, getUnityState: loadState,
}
