process.env.MOUSKEY_TARGETS_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mk-targets-'))
/**
 * Smoke test for ESDF preview + batch migration.
 * Run: node scripts/test-esdf-batch.cjs
 */
const { mkdtempSync, writeFileSync, readFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const api = require('../electron/api-handlers.cjs')

const dir = mkdtempSync(join(tmpdir(), 'mouskey-batch-'))
let passed = 0
let failed = 0
function assert(cond, label) {
  if (cond) { passed++; console.log(`  PASS  ${label}`) }
  else { failed++; console.log(`  FAIL  ${label}`) }
}

function writeGame(name, fileName, content) {
  const caseDir = join(dir, name)
  mkdirSync(caseDir, { recursive: true })
  const filePath = join(caseDir, fileName)
  writeFileSync(filePath, content, 'utf8')
  return { caseDir, filePath, fileName }
}

// Preview does not write
console.log('\n[preview dry-run]')
{
  const g = writeGame('p1', 'KMInput.json', JSON.stringify({
    'Move.Y.Pos': ['k.W'], 'Move.X.Neg': ['k.A'], 'Ability1': ['k.Q'],
  }, null, 2))
  const before = readFileSync(g.filePath, 'utf8')
  const r = api.previewEsdfConfig({ gameId: 'p1', configPath: g.caseDir, fileName: g.fileName })
  const after = readFileSync(g.filePath, 'utf8')
  assert(r.success === true, `success=${r.success}`)
  assert(r.status === 'wasd' || r.status === 'shiftable', `status=${r.status}`)
  assert(r.changedCount > 0, `changedCount=${r.changedCount}`)
  assert(before === after, 'file not modified by preview')
}

// Batch processes multiple, skips already-ESDF
console.log('\n[batch migrate]')
{
  const wasd = writeGame('b-wasd', 'settings.ini', [
    '[controls]',
    'move_up = W',
    'move_down = S',
    'move_left = A',
    'move_right = D',
  ].join('\n'))
  const esdf = writeGame('b-esdf', 'KMInput.json', JSON.stringify({
    'Move.Y.Pos': ['k.E'], 'Move.X.Neg': ['k.S'], 'Move.Y.Neg': ['k.D'], 'Move.X.Pos': ['k.F'],
  }, null, 2))

  // batch uses resolveConfigTarget via gameId — we pass configPath only through migrate
  // so call migrate for each via batchMigrateEsdf after monkey-patching is not available.
  // Instead test batchMigrateEsdf with gameIds that won't resolve, then direct migrate.
  const r1 = api.migrateEsdfConfig({ gameId: 'b-wasd', configPath: wasd.caseDir, fileName: wasd.fileName })
  const r2 = api.migrateEsdfConfig({ gameId: 'b-esdf', configPath: esdf.caseDir, fileName: esdf.fileName })
  assert(r1.success && r1.changedCount > 0, `wasd migrated count=${r1.changedCount}`)
  assert(r2.skipped === true, `esdf skipped=${r2.skipped}`)
  const wasdAfter = readFileSync(wasd.filePath, 'utf8')
  assert(wasdAfter.includes('move_up = E'), 'wasd file shifted')
  assert(wasdAfter.includes('move_right = F'), 'wasd right→F')
}

// batchMigrateEsdf empty
console.log('\n[batch empty]')
{
  const r = api.batchMigrateEsdf({ gameIds: [] })
  assert(r.success === false, 'empty batch rejected')
}

console.log(`\n===== ${passed} passed, ${failed} failed =====`)
process.exit(failed > 0 ? 1 : 0)
