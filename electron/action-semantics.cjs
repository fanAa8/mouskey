// MousKey personal-profile semantics: one canonical action set + engine synonym tables + per-game adapters.
// A personal profile = { id, name, movementMode: 'keyboard'|'mouse', bindings: { <canonicalId>: 'E' | 'SPACE' | 'MOUSE1' ... } }
// Keys use MousKey's normalized names (single uppercase letters, digits, SPACE, LSHIFT, LCTRL, TAB, MOUSE1..5, F1..).

const CATALOG = [
  // group, id, label, wasdDefault, movement?
  ['movement', 'move_forward', '前进', 'W', true],
  ['movement', 'move_back', '后退', 'S', true],
  ['movement', 'move_left', '左移', 'A', true],
  ['movement', 'move_right', '右移', 'D', true],
  ['movement', 'jump', '跳跃', 'SPACE', true],
  ['movement', 'crouch', '蹲下', 'LCTRL', true],
  ['movement', 'sprint', '冲刺/奔跑', 'LSHIFT', true],
  ['action', 'interact', '交互/拾取', 'E'],
  ['action', 'reload', '换弹', 'R'],
  ['action', 'flashlight', '手电筒', 'F'],
  ['action', 'attack', '攻击/主键', 'MOUSE1'],
  ['action', 'aim', '瞄准/副键', 'MOUSE2'],
  ['abilities', 'ability1', '技能1', 'Q'],
  ['abilities', 'ability2', '技能2', 'W'],
  ['abilities', 'ability3', '技能3', 'E'],
  ['abilities', 'ability4', '技能4/大招', 'R'],
  ['abilities', 'ability5', '技能5', 'F'],
  ['abilities', 'ability6', '技能6', 'G'],
  ['summoner', 'summoner1', '召唤师技能1', 'D'],
  ['summoner', 'summoner2', '召唤师技能2', 'F'],
  ['items', 'item1', '物品1', '1'], ['items', 'item2', '物品2', '2'], ['items', 'item3', '物品3', '3'],
  ['items', 'item4', '物品4', '4'], ['items', 'item5', '物品5', '5'], ['items', 'item6', '物品6', '6'],
  ['items', 'trinket', '饰品/眼', '4'],
  ['system', 'map', '地图', 'M'],
  ['system', 'inventory', '背包', 'TAB'],
  ['system', 'emote', '表情轮盘', 'T'],
].map(([group, id, label, wasdDefault, movement]) => ({ group, id, label, wasdDefault, movement: !!movement, category: 'keyboard' }))

// 鼠标点击移动类（MOBA）：没有前后左右，鼠标语义 + 技能/召唤师/物品/饰品/指令
const MOUSE_CATALOG = [
  ['mouse', 'move_click', '鼠标右键：移动', 'MOUSE2', true],
  ['mouse', 'attack_select', '鼠标左键：攻击/选择', 'MOUSE1', true],
  ['command', 'attack_move', '攻击移动', 'A'],
  ['command', 'stop', '停止', 'S'],
  ['command', 'hold', '原地不动', 'H'],
  ['abilities', 'ability1', '技能1（Q）', 'Q'],
  ['abilities', 'ability2', '技能2（W）', 'W'],
  ['abilities', 'ability3', '技能3（E）', 'E'],
  ['abilities', 'ability4', '大招（R）', 'R'],
  ['summoner', 'summoner1', '召唤师技能1', 'D'],
  ['summoner', 'summoner2', '召唤师技能2', 'F'],
  ['items', 'item1', '物品1', '1'], ['items', 'item2', '物品2', '2'], ['items', 'item3', '物品3', '3'],
  ['items', 'item4', '物品4', '5'], ['items', 'item5', '物品5', '6'], ['items', 'item6', '物品6', '7'],
  ['items', 'trinket', '饰品/眼', '4'],
  ['system', 'recall', '回城', 'B'],
  ['system', 'shop', '商店', 'P'],
  ['system', 'ping', '信号', 'G'],
  ['system', 'camera_lock', '锁定视角', 'Y'],
  ['system', 'camera_snap', '视角回到英雄', 'SPACE'],
  ['system', 'emote', '表情轮盘', 'T'],
  ['system', 'map', '地图/记分板', 'TAB'],
].map(([group, id, label, wasdDefault, fixedMouse]) => ({ group, id, label, wasdDefault, movement: false, fixedMouse: !!fixedMouse, category: 'mouse' }))
const catalogFor = (movementMode) => (movementMode === 'mouse' ? MOUSE_CATALOG : CATALOG)
const BY_ID = Object.fromEntries([...MOUSE_CATALOG, ...CATALOG].map((a) => [a.id, a]))

// Engine-level synonym table: native action name (lowercased, punctuation stripped) → canonical id
const SYN = {
  move_forward: ['moveforward', 'forward', 'moveup', 'up', 'walkforward', 'movey+', 'vertical+', '+forward'],
  move_back: ['moveback', 'movebackward', 'back', 'backward', 'movedown', 'down', 'movey-', 'vertical-', '+back'],
  move_left: ['moveleft', 'left', 'strafeleft', 'movex-', 'horizontal-', '+moveleft'],
  move_right: ['moveright', 'right', 'straferight', 'movex+', 'horizontal+', '+moveright'],
  jump: ['jump', '+jump'],
  crouch: ['crouch', 'duck', '+duck', 'togglecrouch'],
  sprint: ['sprint', 'run', '+speed', 'dash'],
  interact: ['interact', 'use', '+use', 'examine', 'pickup', 'action'],
  reload: ['reload', '+reload'],
  flashlight: ['flashlight', 'torch', 'light', 'toggleflashlight'],
  attack: ['attack', 'fire', 'fire1', '+attack', 'primary'],
  aim: ['aim', 'fire2', '+attack2', 'secondary', 'ads'],
  ability1: ['ability1', 'skill1', 'castspell1', 'spell1'],
  ability2: ['ability2', 'skill2', 'castspell2', 'spell2'],
  ability3: ['ability3', 'skill3', 'castspell3', 'spell3'],
  ability4: ['ability4', 'skill4', 'castspell4', 'spell4', 'ultimate', 'ult'],
  ability5: ['ability5', 'skill5'], ability6: ['ability6', 'skill6'],
  summoner1: ['summoner1', 'castavatarspell1'], summoner2: ['summoner2', 'castavatarspell2'],
  item1: ['item1', 'useitem1', 'slot1', 'consumable1'], item2: ['item2', 'useitem2', 'slot2', 'consumable2'],
  item3: ['item3', 'useitem3', 'slot3', 'consumable3'], item4: ['item4', 'useitem4', 'slot4', 'consumable4'],
  item5: ['item5', 'useitem5', 'slot5'], item6: ['item6', 'useitem6', 'slot6'],
  trinket: ['trinket', 'usevisionitem', 'ward'],
  map: ['map', 'togglemap', 'showmap'],
  inventory: ['inventory', 'toggleinventory', 'bag', 'backpack'],
  emote: ['emote', 'emotewheel', 'radialemoteinstantopen', 'radialemote'],
}
const SYN_INDEX = {}
for (const [id, list] of Object.entries(SYN)) for (const n of list) SYN_INDEX[n] = id
const normName = (s) => String(s).toLowerCase().replace(/^evt/, '').replace(/[\s_.]/g, '')

/** Guess canonical id for a native action name (engine-agnostic). */
const guessCanonical = (native) => {
  const n = normName(native)
  if (SYN_INDEX[n]) return SYN_INDEX[n]
  // UE "IA_Jump" / "InputAction_Jump"
  const stripped = n.replace(/^(ia|inputaction|in)/, '')
  if (SYN_INDEX[stripped]) return SYN_INDEX[stripped]
  return null
}

// ─── Per-game adapters: canonical → native write targets ───
// LoL (click-to-move): abilities only; Shift/Alt/Ctrl variants follow the base key.
const lolAdapter = {
  id: 'lol', clickToMove: true, keyboardMovement: false,
  native: {
    ability1: ['evtCastSpell1', 'evtSmartCastSpell1:Shift', 'evtSelfCastSpell1:Alt', 'evtLevelSpell1:Ctrl'],
    ability2: ['evtCastSpell2', 'evtSmartCastSpell2:Shift', 'evtSelfCastSpell2:Alt', 'evtLevelSpell2:Ctrl'],
    ability3: ['evtCastSpell3', 'evtSmartCastSpell3:Shift', 'evtSelfCastSpell3:Alt', 'evtLevelSpell3:Ctrl'],
    ability4: ['evtCastSpell4', 'evtSmartCastSpell4:Shift', 'evtSelfCastSpell4:Alt', 'evtLevelSpell4:Ctrl'],
    summoner1: ['evtCastAvatarSpell1', 'evtSmartCastAvatarSpell1:Shift', 'evtSelfCastAvatarSpell1:Alt'],
    summoner2: ['evtCastAvatarSpell2', 'evtSmartCastAvatarSpell2:Shift', 'evtSelfCastAvatarSpell2:Alt'],
    item1: ['evtUseItem1'], item2: ['evtUseItem2'], item3: ['evtUseItem3'], item4: ['evtUseItem4'], item5: ['evtUseItem5'], item6: ['evtUseItem6'],
    trinket: ['evtUseVisionItem'], emote: ['evtRadialEmoteInstantOpen'],
    recall: ['evtUseItem7'], camera_lock: ['evtCameraLockToggle'], camera_snap: ['evtCameraSnap'],
  },
}
const battleriteAdapter = {
  id: 'battlerite', clickToMove: false, keyboardMovement: true,
  native: {
    move_forward: ['Move.Y.Pos'], move_back: ['Move.Y.Neg'], move_left: ['Move.X.Neg'], move_right: ['Move.X.Pos'],
    ability1: ['Ability4'], ability2: ['Ability5'], ability3: ['Ability6'], ability4: ['Ability7'],
    ability5: ['LimitBreak'], emote: ['EmoteWheel'],
  },
}
const sourceAdapter = {
  id: 'source', clickToMove: false, keyboardMovement: true,
  native: { move_forward: ['+forward'], move_back: ['+back'], move_left: ['+moveleft'], move_right: ['+moveright'], jump: ['+jump'], crouch: ['+duck'], sprint: ['+speed'], interact: ['+use'], reload: ['+reload'] },
}
const unityLegacyAdapter = {
  id: 'unity-legacy', clickToMove: false, keyboardMovement: true,
  native: { move_forward: ['Vertical+'], move_back: ['Vertical-'], move_left: ['Horizontal-'], move_right: ['Horizontal+'], jump: ['Jump'] },
}

/** Pick an adapter for a detected game. */
const adapterFor = (game) => {
  const id = String(game.gameId || '')
  if (id === 'lol' || /league/i.test(game.name || '')) return lolAdapter
  if (/504370$/.test(id) || /battlerite/i.test(game.name || '')) return battleriteAdapter
  if (game.engineType === 'ue4') return { id: 'ue4', clickToMove: false, keyboardMovement: true, native: null, dynamic: true }
  if (game.engineType === 'unity') return unityLegacyAdapter
  if (id === 'cs2' || game.format === 'source-cfg') return sourceAdapter
  return { id: 'generic', clickToMove: false, keyboardMovement: true, native: null, dynamic: true }
}

// LoL key format
const lolKey = (k, mod) => {
  const base = k.length === 1 ? `[${k.toLowerCase()}]` : ({ SPACE: '[Space]', MOUSE3: '[Button 3]', MOUSE4: '[Button 4]', MOUSE5: '[Button 5]', TAB: '[Tab]' }[k] || `[${k}]`)
  return mod ? `[${mod}]${base}` : base
}
const brKey = (k) => (k.length === 1 ? `k.${k.toUpperCase()}` : ({ SPACE: 'k.Space', LSHIFT: 'k.LeftShift', LCTRL: 'k.LeftControl', TAB: 'k.Tab', MOUSE1: 'm.0', MOUSE2: 'm.1', MOUSE3: 'm.2' }[k] || `k.${k}`))

/**
 * Map a personal profile onto one game.
 * nativeActions: optional list of the game's own action names (e.g. from UE DefaultInput) for dynamic adapters.
 * Returns { adapter, applies, mapped:[{canonical,native,key,value}], unknown:[native], skipped:[{canonical,reason}], movementMode }
 */
const mapProfileToGame = (profile, game, nativeActions = []) => {
  const ad = adapterFor(game)
  const out = { adapter: ad.id, mapped: [], unknown: [], skipped: [], movementMode: null, applies: true, notes: [] }
  const mouseMode = profile.movementMode === 'mouse'
  if (mouseMode) {
    if (ad.clickToMove) { out.movementMode = 'click'; out.notes.push('鼠标点击移动：将切换为点击移动，仅映射技能/物品') }
    else out.notes.push('该游戏不支持点击移动：鼠标方案只应用技能类动作，移动保持游戏原样')
  }
  const entries = Object.entries(profile.bindings || {})
  if (ad.native) {
    for (const [cid, key] of entries) {
      if (!key) continue
      const meta = BY_ID[cid]
      if (meta && meta.fixedMouse) { out.skipped.push({ canonical: cid, reason: '鼠标语义（游戏内固定，仅展示）' }); continue }
      if (meta && meta.movement && (mouseMode || !ad.keyboardMovement)) { out.skipped.push({ canonical: cid, reason: mouseMode ? '鼠标方案不改移动' : '该游戏无键盘移动' }); continue }
      const targets = ad.native[cid]
      if (!targets) { out.skipped.push({ canonical: cid, reason: '该游戏没有对应动作' }); continue }
      for (const t of targets) {
        const [native, mod] = t.split(':')
        const value = ad.id === 'lol' ? lolKey(key, mod) : ad.id === 'battlerite' ? brKey(key) : key
        out.mapped.push({ canonical: cid, native, key: mod ? `${mod}+${key}` : key, value })
      }
    }
  } else {
    // dynamic: match the game's own action names through the synonym table
    const byCanon = {}
    for (const n of nativeActions) { const c = guessCanonical(n); if (c) (byCanon[c] ||= []).push(n); else out.unknown.push(n) }
    for (const [cid, key] of entries) {
      if (!key) continue
      const meta = BY_ID[cid]
      if (meta && meta.fixedMouse) { out.skipped.push({ canonical: cid, reason: '鼠标语义（仅展示）' }); continue }
      if (meta && meta.movement && mouseMode) { out.skipped.push({ canonical: cid, reason: '鼠标方案不改移动' }); continue }
      const natives = byCanon[cid]
      if (!natives) { out.skipped.push({ canonical: cid, reason: nativeActions.length ? '游戏动作表中未找到' : '未读取到游戏动作表' }); continue }
      for (const n of natives) out.mapped.push({ canonical: cid, native: n, key, value: key })
    }
  }
  // collisions: same physical key on two different canonical actions
  const keyOwners = {}
  for (const m of out.mapped) { (keyOwners[m.key] ||= new Set()).add(m.canonical) }
  out.collisions = Object.entries(keyOwners).filter(([, s]) => s.size > 1).map(([k, s]) => ({ key: k, actions: [...s] }))
  if (!out.mapped.length) out.applies = false
  return out
}

/** Profile equal to "WASD shifted to ESDF"? (lets UE/Unity reuse the verified ESDF strategies) */
const isEsdfShiftOfWasd = (profile) => {
  const b = profile.bindings || {}
  return b.move_forward === 'E' && b.move_left === 'S' && b.move_back === 'D' && b.move_right === 'F'
}

const WASD_BASE = { move_forward: 'W', move_back: 'S', move_left: 'A', move_right: 'D', jump: 'SPACE', crouch: 'LCTRL', sprint: 'LSHIFT', interact: 'E', reload: 'R', flashlight: 'F', attack: 'MOUSE1', aim: 'MOUSE2', ability1: 'Q', ability2: 'E', ability3: 'R', ability4: 'F', item1: '1', item2: '2', item3: '3', map: 'M', inventory: 'TAB' }
const MOBA_QWER = { move_click: 'MOUSE2', attack_select: 'MOUSE1', attack_move: 'A', stop: 'S', hold: 'H', ability1: 'Q', ability2: 'W', ability3: 'E', ability4: 'R', summoner1: 'D', summoner2: 'F', item1: '1', item2: '2', item3: '3', item4: '5', item5: '6', item6: '7', trinket: '4', recall: 'B', shop: 'P', ping: 'G', camera_lock: 'Y', camera_snap: 'SPACE', emote: 'T', map: 'TAB' }

// ─── old (按键配置页) ActionId / key names → v2 ───
const OLD_ACTION = { forward: 'move_forward', back: 'move_back', left: 'move_left', right: 'move_right', primary: 'attack', secondary: 'aim', ability1: 'ability1', ability2: 'ability2', ability3: 'ability3', ultimate: 'ability4', summoner1: 'summoner1', summoner2: 'summoner2', interact: 'interact', inventory1: 'item1', inventory2: 'item2', inventory3: 'item3', inventory4: 'item4', inventory5: 'item5', inventory6: 'item6', trinket: 'trinket', jump: 'jump', map: 'map', ping: 'ping', recall: 'recall', shop: 'shop', camera_snap: 'camera_snap', camera_lock: 'camera_lock', stop: 'stop', hold_position: 'hold', attack_move: 'attack_move' }
const OLD_ACTION_MOUSE = { ...OLD_ACTION, primary: 'attack_select', secondary: 'move_click' }
const oldKeyToV2 = (k) => {
  if (!k) return ''
  const m = /^Mouse (\d)$/i.exec(k); if (m) return `MOUSE${m[1]}`
  const t = { Space: 'SPACE', Shift: 'LSHIFT', 'Shift R': 'RSHIFT', Ctrl: 'LCTRL', 'Ctrl R': 'RCTRL', Alt: 'LALT', 'Alt R': 'RALT', Tab: 'TAB', Caps: 'CAPS', Esc: 'ESC', Enter: 'ENTER', Backspace: 'BACKSPACE', 'Mouse Wheel': 'MOUSE3' }
  return t[k] || String(k).toUpperCase()
}
/** Convert an old profile/preset ({category, bindings: {actionId: key}} or [{id,key}]) to a v2 personal profile. */
const convertOldProfile = (old, idPrefix = 'migrated-') => {
  const mode = old.category === 'moba' ? 'mouse' : 'keyboard'
  const table = mode === 'mouse' ? OLD_ACTION_MOUSE : OLD_ACTION
  const src = Array.isArray(old.bindings) ? Object.fromEntries(old.bindings.map((b) => [b.id, b.key])) : (old.bindings || {})
  const allowed = new Set(catalogFor(mode).map((a) => a.id))
  const bindings = {}
  for (const [aid, key] of Object.entries(src)) { const c = table[aid]; if (c && allowed.has(c) && key) bindings[c] = oldKeyToV2(key) }
  return { id: `${idPrefix}${old.id}`, name: old.name, movementMode: mode, bindings, note: old.note || '从旧版预设迁移', migratedFrom: old.id }
}

// Built-in templates (read-only). Old 按键配置 seeds become profiles in their category.
const BUILTIN_PROFILES = [
  { id: 'builtin-wasd', name: 'WASD 标准', builtin: true, movementMode: 'keyboard', bindings: { ...WASD_BASE } },
  { id: 'builtin-esdf', name: 'ESDF 键盘移动', builtin: true, movementMode: 'keyboard',
    bindings: { move_forward: 'E', move_back: 'D', move_left: 'S', move_right: 'F', jump: 'SPACE', crouch: 'LCTRL', sprint: 'LSHIFT', interact: 'R', reload: 'T', flashlight: 'G', ability1: 'W', ability2: 'R', ability3: 'T', ability4: 'G', summoner1: 'D', summoner2: 'F', map: 'M', inventory: 'TAB' } },
  { id: 'builtin-lol-wert', name: 'MOBA 点击移动 · WERT', builtin: true, movementMode: 'mouse',
    bindings: { ...MOBA_QWER, ability1: 'W', ability2: 'E', ability3: 'R', ability4: 'T', emote: 'Q', stop: 'S' } },
  { id: 'builtin-moba-qwer', name: 'MOBA 点击移动 · 标准 QWER', builtin: true, movementMode: 'mouse', bindings: { ...MOBA_QWER } },
]

module.exports = { MOUSE_CATALOG, catalogFor, convertOldProfile, oldKeyToV2, OLD_ACTION, CATALOG, SYN, guessCanonical, adapterFor, mapProfileToGame, isEsdfShiftOfWasd, BUILTIN_PROFILES, lolKey, brKey }
