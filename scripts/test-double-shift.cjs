process.env.MOUSKEY_TARGETS_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mk-targets-'))
// Double-shift guard + restore ordering tests (no game files touched; uses a temp dir + a throwaway gameId).
const assert = require('node:assert')
const fs = require('node:fs'); const path = require('node:path'); const os = require('node:os')
const v2 = require('../electron/mouskey-v2.cjs')
const api = require('../electron/api-handlers.cjs')
let pass = 0; const ok = (name, fn) => { fn(); pass++; console.log('  ✓', name) }

// 1. restore ordering: local "YYYYMMDD_HHmmss" vs old UTC "before-restore" names must never pick the before-restore copy
ok('oldest original ignores before-restore copies', () => {
  const names = ['g_KM.json.20261016_043800.bak', 'g_KM.json.20261015203900.before-restore.bak', 'g_KM.json.20261016_050000.bak', 'g_KM.json.20261016_043800-1.bak']
  assert.deepStrictEqual(v2.sortOriginalBackups(names), ['g_KM.json.20261016_043800.bak', 'g_KM.json.20261016_043800-1.bak', 'g_KM.json.20261016_050000.bak'])
})
ok('ordering by parsed timestamp, not string', () => {
  assert.deepStrictEqual(v2.sortOriginalBackups(['x.20261016_000001.bak', 'x.20251231_235959.bak']), ['x.20251231_235959.bak', 'x.20261016_000001.bak'])
})

// 2. createBackup throws instead of silently continuing
ok('createBackup throws when backup fails', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-'))
  const file = path.join(d, 'cfg.ini'); fs.writeFileSync(file, 'a')
  fs.writeFileSync(path.join(d, 'keyforge_backups'), 'not a dir') // makes mkdir/copy fail
  assert.throws(() => api.createBackup(file, 'g'), /已停止写入/)
  assert.strictEqual(api.createBackup(path.join(d, 'missing.ini'), 'g'), null)
})

// 3. guard: written / backups-without-restore / restored
const gid = `test-guard-${Date.now()}`
const d = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-'))
const raw = { gameId: gid, name: 'T', configPath: d, configFileName: 'Input.ini' }
ok('clean game → no reason', () => assert.strictEqual(v2.alreadyModifiedReason(raw, { history: [] }), null))
ok('config written → blocked', () => assert.match(v2.alreadyModifiedReason(raw, { history: [{ plan: 'config (ESDF)', status: 'written' }] }), /已写入/))
fs.writeFileSync(path.join(d, 'Input.ini'), 'ORIGINAL')
const bak = api.createBackup(path.join(d, 'Input.ini'), gid)
ok('backup exists but status lost → still blocked', () => assert.ok(v2.alreadyModifiedReason(raw, { history: [] })))
ok('after restore → allowed again', () => assert.strictEqual(v2.alreadyModifiedReason({ ...raw, configPath: path.join(d, 'none') }, { history: [{ plan: 'config (ESDF)', status: 'written' }, { plan: 'config (restore)', status: 'restored' }] }), null))

// 4. multi-file restore: main + sibling platform file both go back to originals
ok('restore covers every file of the ESDF write', () => {
  const sib = path.join(d, 'sib', 'Input.ini'); fs.mkdirSync(path.dirname(sib), { recursive: true }); fs.writeFileSync(sib, 'SIB-ORIG')
  const sbak = api.createBackup(sib, gid)
  const created = path.join(d, 'new', 'Input.ini'); fs.mkdirSync(path.dirname(created), { recursive: true })
  api.recordEsdfTarget(gid, path.join(d, 'Input.ini'), bak); api.recordEsdfTarget(gid, sib, sbak); api.recordEsdfTarget(gid, created, null)
  api.recordEsdfTarget(gid, sib, 'SHOULD-NOT-OVERRIDE-FIRST')
  fs.writeFileSync(path.join(d, 'Input.ini'), 'SHIFTED'); fs.writeFileSync(sib, 'SHIFTED'); fs.writeFileSync(created, 'NEW')
  const r = v2.restoreConfig(raw, 'config')
  assert.ok(r.success, r.message)
  assert.strictEqual(fs.readFileSync(path.join(d, 'Input.ini'), 'utf8'), 'ORIGINAL')
  assert.strictEqual(fs.readFileSync(sib, 'utf8'), 'SIB-ORIG')
  assert.ok(!fs.existsSync(created))
  assert.ok(!fs.existsSync(api.esdfTargetsFile(gid)))
  // a second restore must still choose the ORIGINAL, not the before-restore copy just made
  fs.writeFileSync(path.join(d, 'Input.ini'), 'SHIFTED-AGAIN')
  assert.ok(v2.restoreConfig(raw, 'config').success)
  assert.strictEqual(fs.readFileSync(path.join(d, 'Input.ini'), 'utf8'), 'ORIGINAL')
})

// 5. non-games / known online titles
ok('non-game filter', () => { assert.ok(v2.NON_GAME.test('Blender')); assert.ok(!v2.NON_GAME.test('Battlerite')) })
ok('known online anti-cheat list', () => { assert.ok(v2.KNOWN_ANTICHEAT.test('VALORANT')); assert.ok(!v2.KNOWN_ANTICHEAT.test('Battlerite')) })

fs.rmSync(d, { recursive: true, force: true }); try { fs.unlinkSync(api.esdfTargetsFile(gid)) } catch { /* gone */ }
{ const reqs = require('../electron/game-requirements.cjs'); const s = reqs.loadStatus(); for (const k of Object.keys(s.games)) if (k.startsWith('test-guard-')) delete s.games[k]; fs.writeFileSync(reqs.STATUS_FILE(), JSON.stringify(s, null, 2)) }
console.log(`test-double-shift: ${pass} passed`)

