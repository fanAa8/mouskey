/**
 * Smoke test for ESDF migration helpers in electron/api-handlers.cjs
 * Run: node scripts/test-esdf-migrate.cjs
 */
const { mkdtempSync, writeFileSync, readFileSync, mkdirSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

// Load only the functions we need by requiring the module and using migrateEsdfConfig
// against temp files (resolveConfigTarget needs gameId; we pass configPath+fileName).
const api = require('../electron/api-handlers.cjs')

const dir = mkdtempSync(join(tmpdir(), 'mouskey-esdf-'))
let passed = 0
let failed = 0

function assert(cond, label) {
  if (cond) {
    passed++
    console.log(`  PASS  ${label}`)
  } else {
    failed++
    console.log(`  FAIL  ${label}`)
  }
}

function writeCase(name, fileName, content) {
  const caseDir = join(dir, name)
  mkdirSync(caseDir, { recursive: true })
  const filePath = join(caseDir, fileName)
  writeFileSync(filePath, content, 'utf8')
  return { caseDir, filePath }
}

// ─── 1. UE4 Input.ini ───
console.log('\n[1] UE4 Input.ini')
{
  const { caseDir, fileName, filePath } = (() => {
    const c = writeCase('ue4', 'Input.ini', [
      '[/Script/Engine.InputSettings]',
      'AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=W)',
      'AxisMappings=(AxisName="MoveForward",Scale=-1.000000,Key=S)',
      'AxisMappings=(AxisName="MoveRight",Scale=1.000000,Key=D)',
      'AxisMappings=(AxisName="MoveRight",Scale=-1.000000,Key=A)',
      'ActionMappings=(ActionName="Jump",Key=SpaceBar)',
      'ActionMappings=(ActionName="Interact",Key=E)',
      '+DebugExecBindings=()',
      'bCaptureMouseOnLaunch=True',
    ].join('\n'))
    return { caseDir: c.caseDir, fileName: 'Input.ini', filePath: c.filePath }
  })()

  const result = api.migrateEsdfConfig({
    gameId: 'test-ue4',
    configPath: caseDir,
    fileName,
  })
  assert(result.success === true, `success=${result.success} msg=${result.message}`)
  const after = readFileSync(filePath, 'utf8')
  assert(after.includes('Key=E'), 'forward W→E')
  assert(after.includes('Key=D'), 'back S→D')
  assert(after.includes('Key=F'), 'right D→F')
  assert(after.includes('Key=S'), 'left A→S')
  assert(after.includes('Key=SpaceBar'), 'SpaceBar unchanged')
  assert(after.includes('Key=R'), 'interact E→R')
  assert(after.includes('+DebugExecBindings=()'), 'preserves other settings')
  assert(after.includes('bCaptureMouseOnLaunch=True'), 'preserves bool settings')
  assert(result.changedCount >= 5, `changedCount=${result.changedCount}`)
}

// ─── 2. Battlerite-style JSON ───
console.log('\n[2] Battlerite JSON')
{
  const c = writeCase('json', 'KMInput.json', JSON.stringify({
    'Move.Y.Pos': ['k.W'],
    'Move.Y.Neg': ['k.S'],
    'Move.X.Neg': ['k.A'],
    'Move.X.Pos': ['k.D'],
    'Ability1': ['k.Q'],
    'Jump': ['k.Space'],
    'EX.Modifier': ['m.4'],
    'UI.Misc': ['k.G'],
  }, null, 2))
  const result = api.migrateEsdfConfig({
    gameId: 'test-json',
    configPath: c.caseDir,
    fileName: 'KMInput.json',
  })
  assert(result.success === true, `success=${result.success}`)
  const after = JSON.parse(readFileSync(c.filePath, 'utf8'))
  assert(after['Move.Y.Pos'][0] === 'k.E', `forward k.W→k.E got=${after['Move.Y.Pos'][0]}`)
  assert(after['Move.Y.Neg'][0] === 'k.D', `back k.S→k.D got=${after['Move.Y.Neg'][0]}`)
  assert(after['Move.X.Neg'][0] === 'k.S', `left k.A→k.S got=${after['Move.X.Neg'][0]}`)
  assert(after['Move.X.Pos'][0] === 'k.F', `right k.D→k.F got=${after['Move.X.Pos'][0]}`)
  assert(after['Ability1'][0] === 'k.W', `ability1 k.Q→k.W got=${after['Ability1'][0]}`)
  assert(after['Jump'][0] === 'k.Space', 'space unchanged')
  assert(after['EX.Modifier'][0] === 'm.4', 'mouse unchanged')
  assert('UI.Misc' in after, 'preserves other keys')
}

// ─── 3. Generic INI ───
console.log('\n[3] Generic INI')
{
  const c = writeCase('ini', 'settings.ini', [
    '[controls]',
    'move_up = W',
    'move_down = S',
    'move_left = A',
    'move_right = D',
    'interact = E',
    'map = M',
    'volume = 0.8',
    'fullscreen = true',
  ].join('\n'))
  const result = api.migrateEsdfConfig({
    gameId: 'test-ini',
    configPath: c.caseDir,
    fileName: 'settings.ini',
  })
  assert(result.success === true, `success=${result.success}`)
  const after = readFileSync(c.filePath, 'utf8')
  assert(after.includes('move_up = E'), 'move_up W→E')
  assert(after.includes('move_down = D'), 'move_down S→D')
  assert(after.includes('move_left = S'), 'move_left A→S')
  assert(after.includes('move_right = F'), 'move_right D→F')
  assert(after.includes('interact = R'), 'interact E→R')
  assert(after.includes('map = M'), 'map M unchanged (not in shift map)')
  assert(after.includes('volume = 0.8'), 'volume unchanged')
  assert(after.includes('fullscreen = true'), 'bool unchanged')
}

// ─── 4. Source CFG ───
console.log('\n[4] Source CFG')
{
  const c = writeCase('source', 'config.cfg', [
    'bind "w" "+forward"',
    'bind "s" "+back"',
    'bind "a" "+moveleft"',
    'bind "d" "+moveright"',
    'bind "e" "+use"',
    'bind "space" "+jump"',
    'bind "mouse1" "+attack"',
  ].join('\n'))
  const result = api.migrateEsdfConfig({
    gameId: 'test-source',
    configPath: c.caseDir,
    fileName: 'config.cfg',
  })
  assert(result.success === true, `success=${result.success}`)
  const after = readFileSync(c.filePath, 'utf8')
  assert(after.includes('bind "e" "+forward"'), 'forward w→e')
  assert(after.includes('bind "d" "+back"'), 'back s→d')
  assert(after.includes('bind "s" "+moveleft"'), 'left a→s')
  assert(after.includes('bind "f" "+moveright"'), 'right d→f')
  assert(after.includes('bind "r" "+use"'), 'use e→r')
  assert(after.includes('bind "space" "+jump"'), 'space unchanged')
  assert(after.includes('bind "mouse1" "+attack"'), 'mouse unchanged')
}

// ─── 5. Already-ESDF (idempotent) ───
console.log('\n[5] Idempotent (already ESDF)')
{
  const c = writeCase('idem', 'KMInput.json', JSON.stringify({
    'Move.Y.Pos': ['k.E'],
    'Move.X.Neg': ['k.S'],
    'Move.Y.Neg': ['k.D'],
    'Move.X.Pos': ['k.F'],
  }, null, 2))
  const result = api.migrateEsdfConfig({
    gameId: 'test-idem',
    configPath: c.caseDir,
    fileName: 'KMInput.json',
  })
  assert(result.success === true, `success=${result.success}`)
  assert(result.skipped === true, `skipped=true got=${result.skipped}`)
  assert(result.changedCount === 0, `changedCount=0 got=${result.changedCount}`)
  const after = JSON.parse(readFileSync(c.filePath, 'utf8'))
  assert(after['Move.Y.Pos'][0] === 'k.E', 'file not modified')
}

// ─── 6. Custom keys on top of ESDF ───
console.log('\n[6] Custom keys overlay')
{
  const c = writeCase('custom', 'KMInput.json', JSON.stringify({
    'Move.Y.Pos': ['k.W'],
    'Move.X.Neg': ['k.A'],
    'Ability1': ['k.Q'],
  }, null, 2))
  const result = api.migrateEsdfConfig({
    gameId: 'test-custom',
    configPath: c.caseDir,
    fileName: 'KMInput.json',
    customKeys: { ability1: 'Z' },
  })
  assert(result.success === true, `success=${result.success}`)
  const after = JSON.parse(readFileSync(c.filePath, 'utf8'))
  assert(after['Move.Y.Pos'][0] === 'k.E', `movement still ESDF got=${after['Move.Y.Pos'][0]}`)
  assert(after['Ability1'][0] === 'k.Z', `custom ability1→k.Z got=${after['Ability1'][0]}`)
}

console.log(`\n===== ${passed} passed, ${failed} failed =====`)
process.exit(failed > 0 ? 1 : 0)
