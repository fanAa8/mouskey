/**
 * UE4 runtime-binding strategies (beyond config-only):
 *   - scanUe4Game: anti-cheat + "self-managed bindings" detection via repak
 *   - Plan 2A: pak patch (<Project>-WindowsNoEditor_MousKey_P.pak) with shifted
 *     key-binding DataTables + DefaultInput.ini (same-length FName edits)
 *   - Plan 2B: UE4SS + Lua mod that re-applies shifted mappings at runtime
 *   - Per-game effect status: written / verified-in-game / ineffective
 * Every install is reversible (delete the files we added; manifest records them).
 */
const fs = require('node:fs')
const { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, statSync } = fs
const { join, dirname, basename } = require('node:path')
const { spawnSync } = require('node:child_process')
const os = require('node:os')
const ue4g = require('./ue4-generic.cjs')

const keyforgeDir = () => join(process.env.USERPROFILE || os.homedir(), 'Documents', 'Keyforge')
const stateFile = () => join(keyforgeDir(), 'ue4-strategies.json')
const loadState = () => { try { return JSON.parse(readFileSync(stateFile(), 'utf8')) } catch { return { games: {} } } }
const saveState = (s) => { mkdirSync(keyforgeDir(), { recursive: true }); writeFileSync(stateFile(), JSON.stringify(s, null, 2)) }

// ─── Anti-cheat detection ───
const ANTI_CHEAT = [
  { name: 'EasyAntiCheat', re: /^(EasyAntiCheat|EasyAntiCheat_x64\.dll|EasyAntiCheat_EOS_Setup\.exe|start_protected_game\.exe)$/i },
  { name: 'BattlEye', re: /^(BattlEye|BEService.*\.exe|BEClient.*\.dll)$/i },
  { name: 'Vanguard', re: /^(vgk\.sys|vgc\.exe|Riot Vanguard)$/i },
  { name: 'XIGNCODE', re: /^(xigncode|x3\.xem)$/i },
  { name: 'nProtect GameGuard', re: /^(GameGuard|GameMon\.des)$/i },
  { name: 'ACE (Tencent)', re: /^(AntiCheatExpert|ACE-Base.*\.sys|SGuard.*\.exe)$/i },
  { name: 'Denuvo Anti-Cheat', re: /^(denuvo-anti-cheat.*|DenuvoAntiCheat)$/i },
]
const detectAntiCheat = (installPath, maxDepth = 4) => {
  const hits = new Set()
  const walk = (dir, d) => {
    if (d > maxDepth) return
    let es; try { es = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of es) {
      for (const ac of ANTI_CHEAT) if (ac.re.test(e.name)) hits.add(ac.name)
      if (e.isDirectory() && !/^(Content|Movies|Paks)$/i.test(e.name)) walk(join(dir, e.name), d + 1)
    }
  }
  if (installPath && existsSync(installPath)) walk(installPath, 0)
  return [...hits]
}

// ─── repak helpers ───
const repakPath = () => ue4g.findRepak()
const repak = (args, opts = {}) => spawnSync(repakPath(), args, { windowsHide: true, maxBuffer: 256 * 1024 * 1024, ...opts })
const pakInfo = (pak) => {
  const r = repak(['info', pak], { encoding: 'utf8' })
  const out = (r.stdout || '') + (r.stderr || '')
  return {
    ok: r.status === 0,
    mountPoint: (out.match(/mount point:\s*(\S+)/) || [])[1] || '../../../',
    version: (out.match(/^version:\s*(\S+)/m) || [])[1] || null,
    encryptedIndex: /encrypted index:\s*true/i.test(out),
    raw: out,
  }
}
const pakList = (pak) => {
  const r = repak(['list', pak], { encoding: 'utf8' })
  return r.status === 0 ? r.stdout.split(/\r?\n/).filter(Boolean) : []
}
const pakGet = (pak, inner) => {
  const r = repak(['get', pak, inner])
  return r.status === 0 ? r.stdout : null
}

// ─── uasset name map (UE4 cooked, 4.x) ───
const crcTables = (() => {
  const msb = []; const lsb = []
  for (let i = 0; i < 256; i++) {
    let c = (i << 24) >>> 0
    for (let k = 0; k < 8; k++) c = (c & 0x80000000) ? (((c << 1) ^ 0x04C11DB7) >>> 0) : ((c << 1) >>> 0)
    msb.push(c)
    let l = i
    for (let k = 0; k < 8; k++) l = (l & 1) ? ((l >>> 1) ^ 0xEDB88320) >>> 0 : l >>> 1
    lsb.push(l >>> 0)
  }
  return { msb, lsb }
})()
/** FCrc::Strihash_DEPRECATED (ANSI) & 0xFFFF — UE4 non-case-preserving name hash */
const nameHashNoCase = (s) => {
  let h = 0
  for (const ch of s.toUpperCase()) h = (((h >>> 8) & 0x00FFFFFF) ^ crcTables.msb[(h ^ ch.charCodeAt(0)) & 0xFF]) >>> 0
  return h & 0xFFFF
}
/** FCrc::StrCrc32 & 0xFFFF — UE4 case-preserving name hash */
const nameHashCase = (s) => {
  let c = 0xFFFFFFFF
  for (const ch of s) {
    let v = ch.charCodeAt(0)
    for (let k = 0; k < 4; k++) { c = ((c >>> 8) ^ crcTables.lsb[(c ^ v) & 0xFF]) >>> 0; v >>>= 8 }
  }
  return (~c >>> 0) & 0xFFFF
}

const readNameMap = (buf) => {
  let o = 0
  const legacy = buf.readInt32LE(4); o = 8
  if (legacy !== -4) o += 4
  o += 8 // FileVersionUE4, Licensee
  if (legacy <= -2) { const n = buf.readInt32LE(o); o += 4 + n * 20 }
  o += 4 // TotalHeaderSize
  const fl = buf.readInt32LE(o); o += 4 + (fl >= 0 ? fl : -fl * 2)
  o += 4 // PackageFlags
  const count = buf.readInt32LE(o); const offset = buf.readInt32LE(o + 4)
  const names = []
  let p = offset
  for (let i = 0; i < count; i++) {
    const len = buf.readInt32LE(p); p += 4
    if (len <= 0) throw new Error('unicode name entries not supported')
    const str = buf.toString('latin1', p, p + len - 1)
    names.push({ index: i, strOffset: p, len, str })
    p += len + 4 // string + 2x uint16 hashes
  }
  return names
}

/**
 * Same-length FName rename in a cooked .uasset name map (W→E etc.).
 * Only letters→letters (punctuation targets would change lengths). Hashes recomputed.
 */
const shiftKeyNamesInUasset = (buf) => {
  const out = Buffer.from(buf)
  const names = readNameMap(out)
  const changes = []
  for (const n of names) {
    if (!/^[A-Za-z]$/.test(n.str)) continue
    const t = ue4g.shiftUe4Key(n.str)
    if (!t || t.length !== 1) continue
    out.write(t, n.strOffset, 'latin1')
    out.writeUInt16LE(nameHashNoCase(t), n.strOffset + n.len)
    out.writeUInt16LE(nameHashCase(t), n.strOffset + n.len + 2)
    changes.push(`${n.str} → ${t}`)
  }
  return { buf: out, changes, names: names.map((n) => n.str) }
}

/** Shift Key= letters in DefaultInput.ini mapping lines (keeps +/- prefixes and order). */
const shiftDefaultInputIni = (text) => {
  const changes = []
  const next = text.replace(/^(\s*[+\-.]?(?:AxisMappings|ActionMappings)=\(.*?Key=)("?)([^,)"]+)\2/gm, (full, pre, q, key) => {
    const nk = ue4g.shiftUe4Key(key)
    if (!nk) return full
    changes.push(`${key} → ${nk}`)
    return `${pre}${nk}`
  })
  return { text: next, changes }
}

// ─── Scan: self-managed binding detection ───
const BIND_ASSET_RE = /(key_?bind|keybind|bindings?|input_?(map|bind|settings|config)|controls?_?settings|rebind|keymap)/i
const SAVE_RE = /(save|sav_).*?(input|key|bind|control)|(input|key|bind|control).*?save/i
const RUNTIME_SIGNS = ['AddAxisMapping', 'RemoveAxisMapping', 'AddActionMapping', 'RemoveActionMapping', 'SaveKeyMappings', 'ForceRebuildKeymaps']

const scanUe4Game = ({ installPath, project } = {}) => {
  const res = { installPath, project, antiCheat: [], ue4: null, pak: null, encrypted: false, selfManaged: false, evidence: [], bindingTables: [], label: null, route: 'plan1' }
  res.antiCheat = detectAntiCheat(installPath)
  const projects = ue4g.findUe4ProjectsInInstall(installPath)
  const ue = project ? projects.find((p) => p.project.toLowerCase() === project.toLowerCase()) : projects[0]
  if (!ue) { res.label = '未识别为 UE4 游戏'; res.route = 'none'; return res }
  res.ue4 = { project: ue.project, paksDir: ue.paksDir, paks: ue.paks, iostore: ue.iostore }
  if (res.antiCheat.length) {
    res.label = `检测到反作弊（${res.antiCheat.join('、')}），不支持任何修改`
    res.route = 'unsupported'
    return res
  }
  if (!repakPath()) { res.label = '缺少 repak，无法扫描 pak'; return res }
  const main = ue.paks.find((f) => !/_P\.pak$/i.test(f)) || ue.paks[0]
  if (!main) { res.label = '只有 IoStore（utoc/ucas），暂不支持扫描'; res.route = ue.iostore ? 'plan2b' : 'plan1'; return res }
  const pak = join(ue.paksDir, main)
  const info = pakInfo(pak)
  res.pak = { file: pak, version: info.version, mountPoint: info.mountPoint }
  if (!info.ok || info.encryptedIndex) { res.encrypted = true; res.label = 'pak 已加密（需 AES 密钥，见 aesKey 钩子）'; res.route = 'plan2b'; return res }
  const list = pakList(pak)
  const candidates = list.filter((p) => /\.uasset$/i.test(p) && p.startsWith(`${ue.project}/Content/`) && (BIND_ASSET_RE.test(basename(p)) || SAVE_RE.test(basename(p)) || /settings_?controls?/i.test(basename(p))))
  for (const c of candidates.slice(0, 60)) {
    const buf = pakGet(pak, c)
    if (!buf) continue
    const s = buf.toString('latin1')
    const signs = RUNTIME_SIGNS.filter((k) => s.includes(k))
    const isDT = s.includes('DataTable') && s.includes('KeyName')
    const isSave = s.includes('SaveGame') && /Key|Bind|Input/.test(basename(c))
    if (isDT) {
      let letters = []
      try { letters = readNameMap(buf).map((n) => n.str).filter((x) => /^[A-Za-z]$/.test(x)) } catch { /* ignore */ }
      res.bindingTables.push({ path: c, letterKeys: letters })
      res.evidence.push(`DataTable 键位表：${c}（字母键 ${letters.join('/') || '无'}）`)
    }
    if (signs.length) res.evidence.push(`${c}：${signs.join(', ')}`)
    if (isSave) res.evidence.push(`疑似键位存档类：${c}`)
  }
  res.selfManaged = res.bindingTables.length > 0 || res.evidence.some((e) => /AddAxisMapping|RemoveAxisMapping|SaveKeyMappings/.test(e))
  if (res.selfManaged) { res.label = '运行时自管键位，配置写入无效'; res.route = 'plan2' }
  else res.label = '标准 Input.ini（方案1）'
  return res
}

// ─── Plan 2A: pak patch ───
const patchPakName = (project, mainPak) => {
  const plat = /-WindowsNoEditor/i.test(mainPak || '') ? 'WindowsNoEditor' : 'Windows'
  return `${project}-${plat}_MousKey_P.pak`
}

/**
 * Build (and optionally install) the patch pak. Returns details; does not touch
 * the original pak. aesKey hook: encrypted paks are refused unless aesKey given
 * (repak `-a` support is left for a future step).
 */
const buildPakPatch = ({ installPath, project, install = false, aesKey = null } = {}) => {
  const scan = scanUe4Game({ installPath, project })
  if (scan.route === 'unsupported') return { success: false, message: scan.label, scan }
  if (!scan.pak) return { success: false, message: scan.label || '未找到 pak', scan }
  if (scan.encrypted && !aesKey) return { success: false, message: 'pak 已加密：请提供 AES 密钥（aesKey）后再试。', scan }
  const ue = scan.ue4
  const pak = scan.pak.file
  const stage = join(os.tmpdir(), 'mouskey-pakpatch', ue.project)
  rmSync(stage, { recursive: true, force: true })
  const files = []
  const changes = []
  for (const t of scan.bindingTables) {
    for (const ext of ['uasset', 'uexp']) {
      const inner = t.path.replace(/\.uasset$/i, `.${ext}`)
      const data = pakGet(pak, inner)
      if (!data) continue
      let outBuf = data
      if (ext === 'uasset') {
        const r = shiftKeyNamesInUasset(data)
        outBuf = r.buf
        changes.push(...r.changes.map((c) => `${basename(t.path)}: ${c}`))
      }
      const dst = join(stage, ...inner.split('/'))
      mkdirSync(dirname(dst), { recursive: true })
      writeFileSync(dst, outBuf)
      files.push(inner)
    }
  }
  const iniInner = `${ue.project}/Config/DefaultInput.ini`
  const ini = pakGet(pak, iniInner)
  if (ini) {
    const r = shiftDefaultInputIni(ini.toString('utf8'))
    if (r.changes.length) {
      const dst = join(stage, ...iniInner.split('/'))
      mkdirSync(dirname(dst), { recursive: true })
      writeFileSync(dst, r.text, 'utf8')
      files.push(iniInner)
      changes.push(...r.changes.map((c) => `DefaultInput.ini: ${c}`))
    }
  }
  if (!files.length) return { success: false, message: '没有可修改的键位资源。', scan }
  const outDir = join(os.tmpdir(), 'mouskey-pakpatch-out')
  mkdirSync(outDir, { recursive: true })
  const name = patchPakName(ue.project, basename(pak))
  const outPak = join(outDir, name)
  rmSync(outPak, { force: true })
  const args = ['pack', '--mount-point', scan.pak.mountPoint, '--quiet']
  if (scan.pak.version) args.push('--version', scan.pak.version)
  args.push(stage, outPak)
  const pr = repak(args, { encoding: 'utf8' })
  if (pr.status !== 0 || !existsSync(outPak)) return { success: false, message: `repak 打包失败：${pr.stderr || pr.stdout}`, scan }
  // Verify: list + read back each file
  const listed = pakList(outPak)
  const verified = files.every((f) => listed.includes(f))
  const result = { success: true, scan, files, changes, builtPak: outPak, verified, installed: false }
  if (install) {
    const dst = join(ue.paksDir, name)
    copyFileSync(outPak, dst)
    result.installed = true
    result.installedPak = dst
    const st = loadState()
    const g = st.games[ue.project] || {}
    g.plan2a = { pak: dst, installedAt: new Date().toISOString(), changes: changes.length }
    g.status = 'written'
    st.games[ue.project] = g
    saveState(st)
  }
  result.message = `${result.installed ? '已安装' : '已生成'} ${name}（${changes.length} 处改键，校验${verified ? '通过' : '失败'}）`
  return result
}

const uninstallPakPatch = ({ installPath, project } = {}) => {
  const ue = ue4g.findUe4ProjectsInInstall(installPath).find((p) => !project || p.project.toLowerCase() === project.toLowerCase())
  if (!ue) return { success: false, message: '未找到 UE 项目' }
  const removed = []
  for (const f of readdirSync(ue.paksDir)) {
    if (/_MousKey_P\.(pak|sig)$/i.test(f)) { rmSync(join(ue.paksDir, f), { force: true }); removed.push(f) }
  }
  const st = loadState(); if (st.games[ue.project]) { delete st.games[ue.project].plan2a; saveState(st) }
  return { success: true, removed, message: removed.length ? `已删除 ${removed.join(', ')}` : '没有已安装的补丁 pak' }
}

// ─── Plan 2B: UE4SS + Lua mod ───
const UE4SS_MOD = 'MousKeyESDF'
const ue4ssBinDir = (installPath, project) => {
  const cands = [join(installPath, project || '', 'Binaries', 'Win64'), join(installPath, 'Engine', 'Binaries', 'Win64')]
  for (const c of cands) {
    try { if (readdirSync(c).some((f) => /-Win64-Shipping\.exe$/i.test(f))) return c } catch { /* ignore */ }
  }
  return null
}

/** Build the Lua mod from the real defaults: exact (name, fromKey) → toKey rules. */
const buildLuaMod = (defaultsText, overrides = {}) => {
  // overrides: { "<Name>|<FromKey>": "<ToKey>" } to customise individual rules
  const rules = []
  for (const { kind, inner } of ue4g.parseMappings(defaultsText)) {
    const km = inner.match(/Key=("?)([^,)"]+)\1/)
    const name = (inner.match(/(?:AxisName|ActionName)="?([^",]+)/) || [])[1]
    if (!km || !name) continue
    const to = overrides[`${name}|${km[2]}`] || ue4g.shiftUe4Key(km[2])
    if (to && to !== km[2]) rules.push({ kind: kind === 'AxisMappings' ? 'axis' : 'action', name, from: km[2], to })
  }
  const lua = `-- Generated by MousKey: key shift applied at runtime (reversible: delete this mod folder)
local Rules = {
${rules.map((r) => `  { kind = "${r.kind}", name = ${JSON.stringify(r.name)}, from = "${r.from}", to = "${r.to}" },`).join('\n')}
}
-- Group rules per mapping name: Groups["axis|movefoward"] = { W = "E", S = "D" }
local Groups = {}
for _, r in ipairs(Rules) do
  local g = r.kind .. "|" .. string.lower(r.name)
  Groups[g] = Groups[g] or {}
  Groups[g][r.from] = r.to
end

-- Two-phase per name: only when ALL original keys of that name are present
-- (i.e. the game (re)built the defaults), remap them from a snapshot. Idempotent,
-- and safe for chains like A->D + D->G inside one name.
local function apply(arr, kind, nameField)
  local byName = {}
  arr:ForEach(function(_, elem)
    local m = elem:get()
    local g = kind .. "|" .. string.lower(m[nameField]:ToString())
    if Groups[g] then
      byName[g] = byName[g] or {}
      table.insert(byName[g], { m = m, k = m.Key.KeyName:ToString() })
    end
  end)
  local changed = 0
  for g, items in pairs(byName) do
    local present = {}
    for _, it in ipairs(items) do present[it.k] = true end
    local original = true
    for from, _ in pairs(Groups[g]) do if not present[from] then original = false end end
    if original then
      for _, it in ipairs(items) do
        local to = Groups[g][it.k]
        if to then it.m.Key.KeyName = FName(to); changed = changed + 1 end
      end
    end
  end
  return changed
end

local function reapply(reason)
  local s = StaticFindObject("/Script/Engine.Default__InputSettings")
  if not s or not s:IsValid() then return end
  local n = apply(s.AxisMappings, "axis", "AxisName") + apply(s.ActionMappings, "action", "ActionName")
  if n > 0 then
    s:ForceRebuildKeymaps()
    print(string.format("[MousKeyESDF] %s: shifted %d mappings\\n", reason, n))
  end
end

RegisterHook("/Script/Engine.PlayerController:ClientRestart", function() ExecuteWithDelay(1500, function() reapply("ClientRestart") end) end)
pcall(function()
  RegisterHook("/Script/Engine.InputSettings:SaveKeyMappings", function() ExecuteWithDelay(200, function() reapply("SaveKeyMappings") end) end)
end)
-- Safety net: periodic check (only acts when a name's original keys reappear)
LoopAsync(3000, function() reapply("poll"); return false end)
print("[MousKeyESDF] loaded, rules: " .. #Rules .. "\\n")
`
  return { lua, rules }
}


// UE4SS v3.0.1 (github.com/UE4SS-RE/RE-UE4SS/releases/tag/v3.0.1). The release
// publishes no checksum; SHA256 of UE4SS_v3.0.1.zip as downloaded: 4b47d4bc...c57ec.
// tools/ue4ss/unpacked holds the minimal set: dwmapi.dll, UE4SS.dll,
// UE4SS-settings.ini, Mods/shared, Mods/mods.txt (only MousKeyESDF enabled).
const UE4SS_ZIP_SHA256 = '4b47d4bceddd2f561a4e395bfa00924ccfc945af576a2d0c613e6537846c57ec'
const ue4ssStageDir = () => join(__dirname, '..', 'tools', 'ue4ss')

/** Install UE4SS (from tools/ue4ss/UE4SS_v*.zip, pre-verified) + our mod. Records added files. */
const installUe4ss = ({ installPath, project, defaultsText, overrides, enableConsole = false } = {}) => {
  const ac = detectAntiCheat(installPath)
  if (ac.length) return { success: false, message: `检测到反作弊（${ac.join('、')}），拒绝安装 UE4SS` }
  const bin = ue4ssBinDir(installPath, project)
  if (!bin) return { success: false, message: '未找到 *-Win64-Shipping.exe 所在目录' }
  const stage = ue4ssStageDir()
  const unpacked = join(stage, 'unpacked')
  if (!existsSync(unpacked)) return { success: false, message: `缺少 UE4SS 文件：${unpacked}` }
  const added = []
  const copyTree = (src, dst) => {
    for (const e of readdirSync(src, { withFileTypes: true })) {
      const s = join(src, e.name); const d = join(dst, e.name)
      if (e.isDirectory()) { mkdirSync(d, { recursive: true }); copyTree(s, d) }
      else {
        if (existsSync(d)) throw new Error(`目标已存在同名文件，拒绝覆盖：${d}`)
        copyFileSync(s, d); added.push(d)
      }
    }
  }
  try {
    copyTree(unpacked, bin)
    const modDir = join(bin, 'Mods', UE4SS_MOD, 'Scripts')
    mkdirSync(modDir, { recursive: true })
    const { lua, rules } = buildLuaMod(defaultsText || '', overrides || {})
    if (enableConsole) {
      const si = join(bin, 'UE4SS-settings.ini')
      if (existsSync(si)) writeFileSync(si, readFileSync(si, 'utf8').replace(/^ConsoleEnabled = 0/m, 'ConsoleEnabled = 1'))
    }
    writeFileSync(join(modDir, 'main.lua'), lua, 'utf8'); added.push(join(modDir, 'main.lua'))
    writeFileSync(join(bin, 'Mods', UE4SS_MOD, 'enabled.txt'), ''); added.push(join(bin, 'Mods', UE4SS_MOD, 'enabled.txt'))
    const st = loadState(); const key = project || basename(installPath)
    const g = st.games[key] || {}
    g.plan2b = { binDir: bin, added, installedAt: new Date().toISOString(), rules: rules.length }
    g.status = 'written'
    st.games[key] = g; saveState(st)
    return { success: true, binDir: bin, added: added.length, rules: rules.length, message: `已安装 UE4SS + ${UE4SS_MOD}（${rules.length} 条规则）` }
  } catch (e) {
    for (const f of added.reverse()) rmSync(f, { force: true })
    return { success: false, message: `安装失败并已回滚：${e.message}` }
  }
}

const uninstallUe4ss = ({ installPath, project } = {}) => {
  const st = loadState(); const key = project || basename(installPath)
  const g = st.games[key]
  if (!g || !g.plan2b) return { success: true, message: '未安装 UE4SS（MousKey 记录中无）' }
  let removed = 0
  for (const f of g.plan2b.added) { if (existsSync(f)) { rmSync(f, { force: true }); removed++ } }
  // remove now-empty dirs we created (only under ue4ss/)
  const prune = (d) => { try { for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) prune(join(d, e.name)); if (!readdirSync(d).length) fs.rmdirSync(d) } catch { /* ignore */ } }
  prune(join(g.plan2b.binDir, 'Mods'))
  delete g.plan2b; saveState(st)
  return { success: true, removed, message: `已卸载 UE4SS，删除 ${removed} 个文件` }
}

// ─── Effect status ───
const EFFECT_STATES = ['written', 'verified-in-game', 'ineffective']
const setEffectStatus = ({ project, status, plan, note } = {}) => {
  if (!EFFECT_STATES.includes(status)) return { success: false, message: `status 必须是 ${EFFECT_STATES.join('/')}` }
  const st = loadState(); const g = st.games[project] || {}
  g.status = status; g.history = [...(g.history || []), { at: new Date().toISOString(), status, plan: plan || null, note: note || null }]
  st.games[project] = g; saveState(st)
  return { success: true, game: g }
}
const getStrategyState = () => loadState()

module.exports = {
  UE4SS_ZIP_SHA256,
  detectAntiCheat, scanUe4Game, buildPakPatch, uninstallPakPatch,
  installUe4ss, uninstallUe4ss, buildLuaMod, setEffectStatus, getStrategyState,
  shiftKeyNamesInUasset, shiftDefaultInputIni, readNameMap, nameHashNoCase, nameHashCase, EFFECT_STATES,
}
