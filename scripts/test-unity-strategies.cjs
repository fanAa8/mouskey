// Synthetic tests for electron/unity-strategies.cjs (no game files touched)
const assert = require('assert'); const path = require('path')
const u = require(path.join(__dirname, '..', 'electron', 'unity-strategies.cjs'))
let pass = 0, fail = 0
const t = (n, f) => { try { f(); pass++; console.log('ok', n) } catch (e) { fail++; console.log('FAIL', n, e.message) } }
const str = (s) => { const b = Buffer.from(s, 'utf8'); const pad = (4 - (b.length % 4)) % 4; const h = Buffer.alloc(4); h.writeInt32LE(b.length); return Buffer.concat([h, b, Buffer.alloc(pad)]) }
const axis = (name, neg, pos, an, ap) => Buffer.concat([str(name), str(''), str(''), str(neg), str(pos), str(an), str(ap), Buffer.alloc(32)])
const buf = Buffer.concat([Buffer.alloc(16), axis('Horizontal', 'left', 'right', 'a', 'd'), axis('Vertical', 'down', 'up', 's', 'w'), axis('Fire1', 'left ctrl', '', '', 'mouse 0')])
t('findAxes finds Horizontal/Vertical', () => { const a = u.findAxes(buf).map((x) => x.name); assert(a.includes('Horizontal') && a.includes('Vertical')) })
t('ESDF patch keeps size and shifts', () => {
  const r = u.patchInputManagerBuffer(buf, u.ESDF_MAP); const out = r.buf
  assert.strictEqual(out.length, buf.length)
  const s = out.toString('latin1'); assert(s.includes('\x01\x00\x00\x00s') && s.includes('\x01\x00\x00\x00f') && s.includes('\x01\x00\x00\x00e'))
  assert(s.includes('left ctrl') && s.includes('mouse 0'))
})
t('empty map changes nothing', () => assert.strictEqual(u.patchInputManagerBuffer(buf, {}).changes.length, 0))
t('detectUnityGame null for missing dir', () => assert.strictEqual(u.detectUnityGame('Z:\\nope'), null))
console.log(`${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0)
