// Tests for MousKey v2: semantics/adapters, requirements, strategy selection, profiles CRUD, LoL generic path.
const assert = require('assert'); const path = require('path'); const fs = require('fs'); const os = require('os')
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mkv2')); process.env.USERPROFILE = tmpHome; process.env.HOME = tmpHome
const sem = require(path.join(__dirname, '..', 'electron', 'action-semantics.cjs'))
const reqs = require(path.join(__dirname, '..', 'electron', 'game-requirements.cjs'))
const v2 = require(path.join(__dirname, '..', 'electron', 'mouskey-v2.cjs'))
const lolAb = require(path.join(__dirname, '..', 'electron', 'lol-abilities.cjs'))
let pass = 0, fail = 0
const t = async (n, f) => { try { await f(); pass++; console.log('ok', n) } catch (e) { fail++; console.log('FAIL', n, e.message) } }
const wert = sem.BUILTIN_PROFILES.find((p) => p.id === 'builtin-lol-wert')
const esdf = sem.BUILTIN_PROFILES.find((p) => p.id === 'builtin-esdf')
;(async () => {
  await t('LoL WERT profile → verified GameEvents values', () => {
    const m = sem.mapProfileToGame(wert, { gameId: 'lol', name: 'League of Legends' })
    const v = Object.fromEntries(m.mapped.map((x) => [x.native, x.value]))
    assert.strictEqual(m.movementMode, 'click')
    for (const [k, [, to]] of Object.entries(lolAb.WERT_PLAN)) { const exp = to.split(',')[0]; assert.strictEqual(v[k], exp, k) }
    assert.strictEqual(m.collisions.length, 0)
  })
  await t('mouse profile on keyboard game: abilities only, movement untouched', () => {
    const m = sem.mapProfileToGame({ ...wert, bindings: { ...wert.bindings, move_forward: 'E' } }, { gameId: 'unity-504370', name: 'Battlerite' })
    assert(!m.mapped.some((x) => x.native.startsWith('Move.')))
    assert(m.notes.some((n) => /不支持点击移动/.test(n)))
  })
  await t('Battlerite ESDF profile → verified KMInput values', () => {
    const m = sem.mapProfileToGame(sem.BUILTIN_PROFILES.find((p) => p.id === 'builtin-esdf-skill'), { gameId: 'unity-504370', name: 'Battlerite' })
    const v = Object.fromEntries(m.mapped.map((x) => [x.native, x.value]))
    assert.strictEqual(v['Move.Y.Pos'], 'k.E'); assert.strictEqual(v['Move.X.Neg'], 'k.S'); assert.strictEqual(v['Move.Y.Neg'], 'k.D'); assert.strictEqual(v['Move.X.Pos'], 'k.F')
    assert.strictEqual(v.Ability4, 'k.W'); assert.strictEqual(v.Ability5, 'k.R'); assert.strictEqual(v.Ability6, 'k.T')
  })
  await t('UE dynamic: synonyms + unknown flagged', () => {
    const m = sem.mapProfileToGame(esdf, { gameId: 'ue4-1', engineType: 'ue4' }, ['MoveForward+', 'MoveForward-', 'MoveRight+', 'MoveRight-', 'Jump', 'Examine', 'Flashlight', 'NewRow_2'])
    assert(m.mapped.some((x) => x.native === 'Jump')); assert(m.mapped.some((x) => x.native === 'Flashlight' && x.key === 'G'))
    assert(m.unknown.includes('NewRow_2'))
  })
  await t('guessCanonical', () => { assert.strictEqual(sem.guessCanonical('evtCastSpell3'), 'ability3'); assert.strictEqual(sem.guessCanonical('IA_Jump'), 'jump'); assert.strictEqual(sem.guessCanonical('+forward'), 'move_forward') })
  await t('requirements: LoL needs client, not in match', () => {
    const r = reqs.requirementsFor({ gameId: 'lol' }, 'lcu', [])
    assert(r.needsClientRunning && r.mustNotBeInMatch); assert(r.chips.some((c) => c.text === '需要客户端开着、不在对局中修改'))
    assert.strictEqual(reqs.checkWrite(r, { lcuRunning: false }).allowed, false)
    assert.strictEqual(reqs.checkWrite(r, { lcuRunning: true, lcuPhase: 'InProgress' }).allowed, false)
    assert.strictEqual(reqs.checkWrite(r, { lcuRunning: true, lcuPhase: 'None' }).allowed, true)
  })
  await t('requirements: config game must be closed, restart after write', () => {
    const r = reqs.requirementsFor({ gameId: 'unity-504370' }, 'config', [])
    assert(r.chips.some((c) => c.text === '修改后需重启游戏生效')); assert(r.cloudSync === 'steam')
    assert.strictEqual(reqs.checkWrite(r, { procs: ['battlerite.exe'], gameProcess: 'Battlerite.exe' }).allowed, false)
    assert.strictEqual(reqs.checkWrite(r, { procs: [], gameProcess: 'Battlerite.exe' }).afterWrite, '修改后需重启游戏生效')
  })
  await t('anti-cheat → unsupported, no strategy', () => {
    assert(reqs.requirementsFor({ gameId: 'x' }, null, ['EasyAntiCheat']).unsupported)
    assert.strictEqual(v2.selectStrategy({ gameId: 'x', engineType: 'ue4' }, { antiCheat: ['BattlEye'] }).chosen, null)
  })
  await t('strategy selection honors state + ineffective', () => {
    assert.strictEqual(v2.selectStrategy({ gameId: 'lol' }).chosen, 'lcu')
    assert.strictEqual(v2.selectStrategy({ gameId: 'ue4-1', engineType: 'ue4' }, { ue4State: { plan2b: {} } }).chosen, 'ue4ss')
    assert.strictEqual(v2.selectStrategy({ gameId: 'ue4-1', engineType: 'ue4' }, { history: [{ plan: 'ue4-clearArray', status: 'ineffective' }] }).chosen, 'ue4-pak')
    assert.strictEqual(v2.selectStrategy({ gameId: 'unity-1', engineType: 'unity', configPath: 'x', configFileName: 'KMInput.json' }).chosen, 'config')
    assert.strictEqual(v2.selectStrategy({ gameId: 'unity-2', engineType: 'unity' }).chosen, 'unity-ggm')
    assert.strictEqual(v2.selectStrategy({ gameId: 'unity-3', engineType: 'unity', configPath: 'x', configFileName: 'prefs.json' }).chosen, 'unity-ggm')
    assert.strictEqual(v2.selectStrategy({ gameId: 'unity-4', engineType: 'unity', configPath: 'x', configFileName: 'KMInput.json' }, { unityState: { planA: {} } }).chosen, 'unity-ggm')
  })
  await t('verified seeds', () => {
    assert.strictEqual(reqs.statusFor({ gameId: 'lol' }).status, 'verified-in-game')
    assert.strictEqual(reqs.statusFor({ gameId: 'ue4-1260760' }).status, 'verified-in-game')
    assert.strictEqual(reqs.statusFor({ gameId: 'unity-999', name: 'SHADOW PUPPET' }).status, 'verified-in-game')
    assert.strictEqual(reqs.statusFor({ gameId: 'unity-504370' }).status, 'verified-in-game')
  })
  await t('launch info', () => {
    assert.strictEqual(reqs.launchInfo({ gameId: 'ue4-1260760', steamAppId: '1260760' }).target, 'steam://rungameid/1260760')
    const l = reqs.launchInfo({ gameId: 'lol' }, { exists: (p) => p.endsWith('TCLS\\Client.exe') || p.endsWith('TCLS/Client.exe') })
    assert.strictEqual(l.type, 'exe')
  })
  await t('profiles CRUD (builtin protected)', () => {
    const s = v2.saveProfile({ name: '我的FPS', movementMode: 'keyboard', bindings: { move_forward: 'e', bogus: 'X' } })
    assert(s.success); assert.strictEqual(s.profile.bindings.move_forward, 'E'); assert(!('bogus' in s.profile.bindings))
    assert(v2.listProfiles().profiles.some((p) => p.id === s.profile.id))
    assert.strictEqual(v2.deleteProfile({ id: 'builtin-esdf' }).success, false)
    assert(v2.deleteProfile({ id: s.profile.id }).success)
    assert.strictEqual(v2.saveProfile({ name: 'x', movementMode: 'fly' }).success, false)
  })
  await t('mouse catalog has no WASD rows; mouse profile validated against it', () => {
    assert(!sem.MOUSE_CATALOG.some((a) => /^move_(forward|back|left|right)$/.test(a.id)))
    assert(sem.MOUSE_CATALOG.some((a) => a.id === 'move_click' && a.label.includes('鼠标右键')))
    const s = v2.saveProfile({ name: 'm', movementMode: 'mouse', bindings: { move_forward: 'E', ability1: 'w', stop: 's' } })
    assert(!('move_forward' in s.profile.bindings) && s.profile.bindings.ability1 === 'W' && s.profile.bindings.stop === 'S'); v2.deleteProfile({ id: s.profile.id })
  })
  await t('old seeds/presets migrate into categories (idempotent)', () => {
    const pd = path.join(tmpHome, 'Documents', 'Keyforge', 'presets'); fs.mkdirSync(pd, { recursive: true })
    fs.writeFileSync(path.join(pd, 'x.keyforge.json'), JSON.stringify({ id: 'x', name: '我的旧预设', category: 'fps', bindings: { forward: 'E', left: 'S', jump: 'Space', primary: 'Mouse 1' } }))
    const seeds = [{ id: 'lol-traditional', name: '英雄联盟·传统模式', category: 'moba', bindings: [{ id: 'ability1', key: 'Q' }, { id: 'secondary', key: 'Mouse 2' }, { id: 'forward', key: 'W' }] }]
    const r = v2.migrateProfiles({ seeds }); assert.strictEqual(r.created.length, 2)
    const all = v2.listProfiles().profiles
    const fps = all.find((p) => p.id === 'preset-x'); assert.strictEqual(fps.movementMode, 'keyboard'); assert.strictEqual(fps.bindings.move_forward, 'E'); assert.strictEqual(fps.bindings.jump, 'SPACE'); assert.strictEqual(fps.bindings.attack, 'MOUSE1')
    const moba = all.find((p) => p.id === 'seed-lol-traditional'); assert.strictEqual(moba.movementMode, 'mouse'); assert.strictEqual(moba.bindings.move_click, 'MOUSE2'); assert(!('move_forward' in moba.bindings))
    assert.strictEqual(v2.migrateProfiles({ seeds }).created.length, 0)
  })
  await t('method order per engine (fallback chain priority)', () => {
    assert.deepStrictEqual(v2.methodOrder({ gameId: 'lol' }), ['lcu'])
    assert.deepStrictEqual(v2.methodOrder({ gameId: 'x', engineType: 'ue4' }), ['ue4-clearArray', 'ue4-pak', 'ue4ss'])
    assert.deepStrictEqual(v2.methodOrder({ gameId: 'x', engineType: 'unity' }), ['unity-ggm', 'bepinex'])
    assert.deepStrictEqual(v2.methodOrder({ gameId: 'x', engineType: 'unity', configPath: 'C:/a', configFileName: 'KeyBindings.json' }), ['config', 'unity-ggm', 'bepinex'])
    assert.deepStrictEqual(v2.methodOrder({ gameId: 'x', engineType: 'source' }), ['config'])
  })
  await t('built-in profiles have no internal key conflicts', () => {
    for (const p of sem.BUILTIN_PROFILES) {
      const ids = new Set(sem.catalogFor(p.movementMode).map((a) => a.id)); const seen = {}
      for (const [id, k] of Object.entries(p.bindings)) { if (!k || !ids.has(id)) continue; assert(!seen[k], `${p.id}: ${k} used by ${seen[k]} and ${id}`); seen[k] = id }
    }
  })
  await t('double-shift guard: config write tracked, restore to oldest backup', () => {
    assert.strictEqual(v2.configWritten({ history: [{ plan: 'config (ESDF)', status: 'written' }] }), true)
    assert.strictEqual(v2.configWritten({ history: [{ plan: 'config (ESDF)', status: 'written' }, { plan: 'config (restore)', status: 'restored' }] }), false)
    assert.strictEqual(v2.configWritten({ history: [{ plan: 'ue4ss (ESDF)', status: 'written' }] }), false)
    const d = path.join(tmpHome, 'cfg'); fs.mkdirSync(path.join(d, 'keyforge_backups'), { recursive: true })
    fs.writeFileSync(path.join(d, 'Input.ini'), 'ESDF')
    fs.writeFileSync(path.join(d, 'keyforge_backups', 'g1_Input.ini.20260101_000000.bak'), 'WASD-ORIG')
    fs.writeFileSync(path.join(d, 'keyforge_backups', 'g1_Input.ini.20260201_000000.bak'), 'LATER')
    const r = v2.restoreConfig({ gameId: 'g1', configPath: d, configFileName: 'Input.ini' }, 'ue4-clearArray')
    assert(r.success, r.message); assert.strictEqual(fs.readFileSync(path.join(d, 'Input.ini'), 'utf8'), 'WASD-ORIG'); assert.strictEqual(fs.readFileSync(r.safety, 'utf8'), 'ESDF')
  })
  await t('LoL generic: keeps secondary binds, detects collisions, dry run', async () => {
    let state = { GameEvents: { evtCastSpell1: '[q]', evtLevelSpell1: '[Ctrl][q],[Alt][Button 2]', evtRadialEmoteInstantOpen: '[t]' } }
    const deps = { isGameRunning: () => false, findLcuApi: () => ({ port: 1, token: 'x' }), buildLolCandidates: () => [],
      lcuRequest: async (p, a, m, url) => (url.includes('gameflow') ? { status: 200, data: '"None"' } : { status: 200, data: JSON.stringify(state) }) }
    const r = await lolAb.applyLolUpdates(deps, { evtCastSpell1: '[w]', evtLevelSpell1: '[Ctrl][w]' }, { dryRun: true })
    assert(r.changes.find((c) => c.event === 'evtLevelSpell1').to === '[Ctrl][w],[Alt][Button 2]')
    const c = await lolAb.applyLolUpdates(deps, { evtCastSpell1: '[t]' }, { dryRun: true })
    assert(c.collisions.length === 1)
  })
  console.log(`${pass} passed, ${fail} failed`); fs.rmSync(tmpHome, { recursive: true, force: true }); process.exit(fail ? 1 : 0)
})()
