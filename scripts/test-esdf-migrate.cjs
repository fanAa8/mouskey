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


// ─── 7. Empty UE Input.ini (UTF-16 BOM only, like real games) → override entries ───
console.log('\n[7] Empty UE Input.ini → -/+ overrides')
{
  const root = join(dir, 'ue-empty', 'Saved', 'Config')
  const win = join(root, 'Windows')
  mkdirSync(win, { recursive: true })
  const filePath = join(win, 'Input.ini')
  writeFileSync(filePath, Buffer.from([0xFF, 0xFE]))
  const pv = api.previewEsdfConfig({ gameId: 'test-ue-empty', configPath: win, fileName: 'Input.ini' })
  assert(pv.format === 'ue4-override', `preview format=ue4-override got=${pv.format}`)
  assert(pv.changedCount >= 4, `preview changedCount>=4 got=${pv.changedCount}`)
  assert(readFileSync(filePath).length === 2, 'preview did not write')
  const r = api.migrateEsdfConfig({ gameId: 'test-ue-empty', configPath: win, fileName: 'Input.ini' })
  assert(r.success === true && r.verified === true, `write+verify ok (${r.message})`)
  const raw = readFileSync(filePath)
  assert(raw[0] === 0xFF && raw[1] === 0xFE, 'UTF-16 BOM preserved')
  const text = raw.slice(2).toString('utf16le')
  assert(text.includes('[/Script/Engine.InputSettings]'), 'section created')
  assert(text.includes('-AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=W)'), 'removes W forward')
  assert(text.includes('+AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=E)'), 'adds E forward')
  assert(text.includes('+AxisMappings=(AxisName="MoveRight",Scale=-1.000000,Key=S)'), 'adds S left')
  const again = api.migrateEsdfConfig({ gameId: 'test-ue-empty', configPath: win, fileName: 'Input.ini' })
  assert(again.skipped === true, 'second run skipped (no double shift)')
}

// ─── 8. Missing Input.ini, neither platform dir exists → write Windows + WindowsNoEditor ───
console.log('\n[8] Missing Input.ini → create both platform dirs')
{
  const root = join(dir, 'ue-missing', 'Saved', 'Config')
  mkdirSync(root, { recursive: true })
  const win = join(root, 'Windows')
  const r = api.migrateEsdfConfig({ gameId: 'test-ue-missing', configPath: win, fileName: 'Input.ini', ue4Project: 'Demo' })
  assert(r.success === true && r.verified === true, `created+verified (${r.message})`)
  const { existsSync } = require('node:fs')
  assert(existsSync(join(win, 'Input.ini')), 'Windows/Input.ini created')
  assert(existsSync(join(root, 'WindowsNoEditor', 'Input.ini')), 'WindowsNoEditor/Input.ini created')
  assert(r.backupPath == null, 'no backup for new file')
}

// ─── 9. Existing user content kept when adding overrides ───
console.log('\n[9] Keep existing Input.ini content')
{
  const c = writeCase('ue-keep', 'Input.ini', '[/Script/Engine.InputSettings]\r\nbEnableMouseSmoothing=False\r\n')
  const r = api.migrateEsdfConfig({ gameId: 'test-ue-keep', configPath: c.caseDir, fileName: 'Input.ini' })
  const after = readFileSync(c.filePath, 'utf8')
  assert(r.success && after.includes('bEnableMouseSmoothing=False'), 'existing setting kept')
  assert(after.split('[/Script/Engine.InputSettings]').length === 2, 'single section header')
}

// ─── 10. No arbitrary fallback file ───
console.log('\n[10] No arbitrary fallback file')
{
  const c = writeCase('nofallback', 'graphics.ini', 'quality=W\n')
  const r = api.migrateEsdfConfig({ gameId: 'test-nofb', configPath: c.caseDir, fileName: 'keybinds.json' })
  assert(r.success === false, `not-found reported (${r.message})`)
  assert(readFileSync(c.filePath, 'utf8') === 'quality=W\n', 'unrelated file untouched')
}

// ─── 11. Shift map: no collisions, QAZ empty ───
console.log('\n[11] Shift map collisions')
{
  const m = api.ue4Generic.LETTER_SHIFT
  const targets = Object.values(m)
  assert(new Set(targets).size === targets.length, 'targets unique')
  assert(!targets.includes('q') && !targets.includes('a') && !targets.includes('z'), 'Q/A/Z left empty')
  assert(api.ue4Generic.shiftUe4Key('T') === 'Y', 'T→Y (was colliding with R→T)')
  assert(api.ue4Generic.shiftUe4Key('P') === 'LeftBracket', 'P→LeftBracket')
  assert(api.ue4Generic.shiftUe4Key('SpaceBar') === null, 'SpaceBar not shifted')
  const c = writeCase('ini-row', 'settings.ini', 'a1 = R\na2 = T\n')
  api.migrateEsdfConfig({ gameId: 'test-row', configPath: c.caseDir, fileName: 'settings.ini' })
  const after = readFileSync(c.filePath, 'utf8')
  assert(after.includes('a1 = T') && after.includes('a2 = Y'), 'R→T and T→Y no collision')
}

// ─── 12. Pak platform hint ───
console.log('\n[12] Pak platform hint')
{
  const u = api.ue4Generic
  assert(u.pakPlatform(['Locked_Up-WindowsNoEditor.pak']) === 'WindowsNoEditor', 'UE4 pak → WindowsNoEditor')
  assert(u.pakPlatform(['Game-Windows.pak']) === 'Windows', 'UE5 pak → Windows')
  const d = u.ue4ConfigDirs('NoSuchProj', join(dir, 'lad'), ['X-WindowsNoEditor.pak'])
  assert(d.length === 1 && d[0].endsWith('WindowsNoEditor'), 'unlaunched game uses pak platform only')
}

// ─── 13. Replace-style override + idempotency after game strips comments ───
console.log('\n[13] Replace-style override')
{
  const u = api.ue4Generic
  const defs = ['[/Script/Engine.InputSettings]',
    '+AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=W)',
    '+AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=Up)',
    '+ActionMappings=(ActionName="Use",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=LeftMouseButton)'].join('\n')
  const r = u.buildUe4ReplaceOverride('\r\n', defs)
  assert(r.content.includes('!AxisMappings=ClearArray') && r.content.includes('!ActionMappings=ClearArray'), 'clears arrays')
  assert(r.content.includes('+AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=E)'), 'W→E re-added')
  assert(r.content.includes('Key=Up)') && r.content.includes('Key=LeftMouseButton)'), 'unshifted defaults kept in full list')
  assert(!r.content.includes('Key=W)'), 'no W left')
  const stripped = r.content.split('\r\n').filter((l) => !l.startsWith(';')).join('\r\n')
  assert(u.hasUe4Override(stripped), 'detected as already overridden after comment stripped')
}

console.log(`\n===== ${passed} passed, ${failed} failed =====`)
process.exit(failed > 0 ? 1 : 0)
