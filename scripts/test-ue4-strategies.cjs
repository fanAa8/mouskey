process.env.MOUSKEY_TARGETS_DIR = require('node:fs').mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'mk-targets-'))
/** Tests for electron/ue4-strategies.cjs (no game files needed). Run: node scripts/test-ue4-strategies.cjs */
const s = require('../electron/ue4-strategies.cjs')
let passed = 0, failed = 0
const assert = (c, l) => { if (c) { passed++; console.log(`  PASS  ${l}`) } else { failed++; console.log(`  FAIL  ${l}`) } }

// Synthetic cooked uasset header + name map
const fstr = (str) => { const b = Buffer.alloc(4 + str.length + 1); b.writeInt32LE(str.length + 1, 0); b.write(str, 4, 'latin1'); return b }
const buildAsset = (names) => {
  const head = []
  const i32 = (v) => { const b = Buffer.alloc(4); b.writeInt32LE(v); return b }
  head.push(i32(0x9E2A83C1 | 0), i32(-7), i32(864), i32(0), i32(0), i32(0) /*custom count*/, i32(0) /*total header*/, fstr('None'), i32(0) /*flags*/)
  const pre = Buffer.concat(head)
  const nameOffset = pre.length + 8
  const entries = names.map((n) => Buffer.concat([fstr(n), Buffer.from([s.nameHashNoCase(n) & 0xff, s.nameHashNoCase(n) >> 8, s.nameHashCase(n) & 0xff, s.nameHashCase(n) >> 8])]))
  return Buffer.concat([pre, i32(names.length), i32(nameOffset), ...entries, Buffer.from('TAIL')])
}

console.log('\n[1] name hashes match UE4 (values taken from a real 4.22 cooked asset)')
assert(s.nameHashNoCase('W') === 0xfb02 && s.nameHashCase('W') === 0xe807, 'W')
assert(s.nameHashNoCase('/Script/Engine') === 0x4086 && s.nameHashCase('/Script/Engine') === 0x4985, '/Script/Engine')

console.log('\n[2] same-length FName shift')
{
  const a = buildAsset(['/Script/Engine', 'A', 'D', 'KeyName', 'S', 'Up', 'W', 'P'])
  const r = s.shiftKeyNamesInUasset(a)
  const after = s.readNameMap(r.buf).map((n) => n.str)
  assert(r.buf.length === a.length, 'length unchanged')
  assert(JSON.stringify(after) === JSON.stringify(['/Script/Engine', 'S', 'F', 'KeyName', 'D', 'Up', 'E', 'P']), `names shifted: ${after}`)
  assert(r.buf.slice(-4).toString() === 'TAIL', 'rest of file untouched')
  const e = s.readNameMap(r.buf).find((n) => n.str === 'E')
  assert(r.buf.readUInt16LE(e.strOffset + e.len) === s.nameHashNoCase('E'), 'hash recomputed')
}

console.log('\n[3] DefaultInput.ini shift keeps structure')
{
  const ini = '[/Script/Engine.InputSettings]\n+AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=W)\n+ActionMappings=(ActionName="Jump",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=SpaceBar)\nbEnableMouseSmoothing=True\n'
  const r = s.shiftDefaultInputIni(ini)
  assert(r.text.includes('Key=E)') && r.text.includes('Key=SpaceBar') && r.text.includes('bEnableMouseSmoothing=True'), 'W→E, others unchanged')
}

console.log('\n[4] Lua mod rules')
{
  const r = s.buildLuaMod('+AxisMappings=(AxisName="MoveForward",Scale=1.000000,Key=W)\n+ActionMappings=(ActionName="Use",bShift=False,bCtrl=False,bAlt=False,bCmd=False,Key=LeftMouseButton)')
  assert(r.rules.length === 1 && r.rules[0].to === 'E', 'one rule W→E')
  assert(r.lua.includes('ForceRebuildKeymaps') && r.lua.includes('"MoveForward"'), 'lua content')
}

console.log('\n[5] anti-cheat detection')
{
  const fs = require('node:fs'); const os = require('node:os'); const p = require('node:path')
  const d = fs.mkdtempSync(p.join(os.tmpdir(), 'mk-ac-'))
  fs.mkdirSync(p.join(d, 'EasyAntiCheat'))
  assert(s.detectAntiCheat(d).includes('EasyAntiCheat'), 'EAC found')
  const d2 = fs.mkdtempSync(p.join(os.tmpdir(), 'mk-ac-'))
  assert(s.detectAntiCheat(d2).length === 0, 'clean dir')
}

console.log(`\n===== ${passed} passed, ${failed} failed =====`)
process.exit(failed ? 1 : 0)
