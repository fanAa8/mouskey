import type { ActionId, ControlAction, GameDefinition, Profile } from './types'
// Re-export game registry so consumers importing from './adapters' get everything
export { games, getGame, getGameModes, getDefaultMode, getNativeNames, getDefaults, getModeSection, gameCount } from '../lib/gameRegistry'

// ─── Action template (shared with App) ────────────────────────────────────

export const actionTemplate: Omit<ControlAction, 'key' | 'device'>[] = [
  // 移动 (WASD movement — FPS/RPG/WASD-MOBA)
  { id: 'forward', label: '前进', detail: '向前移动', category: 'movement' },
  { id: 'left', label: '向左', detail: '向左移动', category: 'movement' },
  { id: 'back', label: '后退', detail: '向后移动', category: 'movement' },
  { id: 'right', label: '向右', detail: '向右移动', category: 'movement' },
  // 操作 (mouse actions)
  { id: 'primary', label: '主操作', detail: '攻击 / 选择', category: 'combat' },
  { id: 'secondary', label: '副操作', detail: '移动 / 瞄准', category: 'combat' },
  // 技能 (abilities)
  { id: 'ability1', label: '技能 1', detail: '第一核心技能', category: 'abilities' },
  { id: 'ability2', label: '技能 2', detail: '第二核心技能', category: 'abilities' },
  { id: 'ability3', label: '技能 3', detail: '第三核心技能', category: 'abilities' },
  { id: 'ultimate', label: '终极技能', detail: '大招 / 高优先级', category: 'abilities' },
  // 召唤师技能 (MOBA summoner spells)
  { id: 'summoner1', label: '召唤师技能 1', detail: '闪现 / 传送等', category: 'summoner' },
  { id: 'summoner2', label: '召唤师技能 2', detail: '闪现 / 传送等', category: 'summoner' },
  // 物品 (items)
  { id: 'interact', label: '交互', detail: '使用 / 拾取', category: 'items' },
  { id: 'inventory1', label: '物品栏 1', detail: '快捷物品 1', category: 'items' },
  { id: 'inventory2', label: '物品栏 2', detail: '快捷物品 2', category: 'items' },
  { id: 'inventory3', label: '物品栏 3', detail: '快捷物品 3', category: 'items' },
  { id: 'inventory4', label: '物品栏 4', detail: '快捷物品 4', category: 'items' },
  { id: 'inventory5', label: '物品栏 5', detail: '快捷物品 5', category: 'items' },
  { id: 'inventory6', label: '物品栏 6', detail: '快捷物品 6', category: 'items' },
  { id: 'trinket', label: '饰品', detail: '视野饰品 / 扫描', category: 'items' },
  { id: 'role_quest', label: '角色任务', detail: '分路任务 / 职业任务', category: 'items' },
  // 系统 (system / utility)
  { id: 'jump', label: '跳跃', detail: '垂直移动', category: 'system' },
  { id: 'map', label: '地图 / 计分板', detail: '信息视图', category: 'system' },
  { id: 'ping', label: '标记', detail: '地图标记 / 信号', category: 'system' },
  { id: 'recall', label: '回城', detail: '返回基地', category: 'system' },
  { id: 'shop', label: '商店', detail: '打开商店', category: 'system' },
  { id: 'camera_snap', label: '镜头回中', detail: '视角回到英雄', category: 'system' },
  { id: 'camera_lock', label: '锁定视角', detail: '锁定 / 解锁视角跟随', category: 'system' },
  { id: 'stop', label: '停止', detail: '停止当前动作', category: 'system' },
  { id: 'hold_position', label: '原地待命', detail: '保持位置不移动', category: 'system' },
  { id: 'attack_move', label: '攻击移动', detail: '移动并攻击沿路目标', category: 'combat' },
  { id: 'cancel_cast', label: '取消施法', detail: '取消当前技能施放', category: 'system' },
  { id: 'confirm_cast', label: '确认施法', detail: '确认技能施放方向', category: 'system' },
]

export const createBindings = (keys: Partial<Record<ActionId, string>>): ControlAction[] =>
  actionTemplate.map((action) => ({
    ...action,
    key: keys[action.id] ?? '',
    device: (keys[action.id] ?? '').startsWith('Mouse') ? 'mouse' : 'keyboard',
  }))

// ─── Preset seeds ──────────────────────────────────────────────────────────

export const universalKeys: Partial<Record<ActionId, string>> = {
  forward: 'E', left: 'S', back: 'D', right: 'F',
  primary: 'Mouse 1', secondary: 'Mouse 2',
  ability1: 'W', ability2: 'R', ability3: 'T', ultimate: 'V',
  interact: 'G', jump: 'Space', inventory1: '1', map: 'Tab',
}

// 标准 WASD 布局（传统移动方式）
export const wasdKeys: Partial<Record<ActionId, string>> = {
  forward: 'W', left: 'A', back: 'S', right: 'D',
  primary: 'Mouse 1', secondary: 'Mouse 2',
  ability1: 'Q', ability2: 'E', ability3: 'R', ultimate: 'F',
  interact: 'G', jump: 'Space', inventory1: '1', map: 'Tab',
}

// 英雄联盟·传统模式（鼠标移动 + QWER 技能）
export const lolTraditionalKeys: Partial<Record<ActionId, string>> = {
  primary: 'Mouse 1',
  secondary: 'Mouse 2',
  attack_move: 'A',
  ability1: 'Q',
  ability2: 'W',
  ability3: 'E',
  ultimate: 'R',
  summoner1: 'D',
  summoner2: 'F',
  inventory1: '1',
  inventory2: '2',
  inventory3: '3',
  inventory4: '5',
  inventory5: '6',
  inventory6: '7',
  trinket: '4',
  role_quest: 'V',
  ping: 'G',
  recall: 'B',
  shop: 'P',
  camera_snap: 'Space',
  camera_lock: 'Y',
  map: 'Tab',
  stop: 'S',
  hold_position: 'H',
}

// 英雄联盟·WASD 模式（WASD 移动 + MB2/Shift/E/R 技能）
export const lolWasdKeys: Partial<Record<ActionId, string>> = {
  forward: 'W',
  left: 'A',
  back: 'S',
  right: 'D',
  primary: 'Mouse 1',
  secondary: 'Mouse 2',
  confirm_cast: 'Mouse 1',
  cancel_cast: 'C',
  ability1: 'Mouse 2',
  ability2: 'Shift',
  ability3: 'E',
  ultimate: 'R',
  summoner1: 'Q',
  summoner2: 'F',
  inventory1: '1',
  inventory2: '2',
  inventory3: '3',
  inventory4: '5',
  inventory5: '6',
  inventory6: '7',
  trinket: '4',
  role_quest: 'V',
  ping: 'G',
  recall: 'B',
  shop: 'P',
  camera_snap: 'Space',
  camera_lock: 'Y',
  map: 'Tab',
  stop: 'S',
  hold_position: 'H',
}

// 纯键盘方案（不使用鼠标，全键盘操作）
export const keyboardOnlyKeys: Partial<Record<ActionId, string>> = {
  forward: 'W', left: 'A', back: 'S', right: 'D',
  primary: 'J', secondary: 'K',
  ability1: 'Q', ability2: 'E', ability3: 'R', ultimate: 'F',
  interact: 'G', jump: 'Space', inventory1: '1', map: 'Tab',
  attack_move: 'H', stop: 'X', hold_position: 'C',
}

export const profileSeeds: Profile[] = [
  {
    id: 'northstar',
    name: '通用方案',
    note: '通用 · ESDF 移动',
    category: 'universal',
    bindings: createBindings(universalKeys),
  },
  {
    id: 'lol-traditional',
    name: '英雄联盟·传统模式',
    note: '鼠标移动 · QWER · DF',
    category: 'moba',
    bindings: createBindings(lolTraditionalKeys),
  },
  {
    id: 'lol-wasd',
    name: '英雄联盟·WASD模式',
    note: 'WASD移动 · MB2/Shift · QF',
    category: 'wasd',
    bindings: createBindings(lolWasdKeys),
  },
  {
    id: 'precision',
    name: '射击优先',
    note: 'CS / CF · FPS 方案',
    category: 'fps',
    bindings: createBindings({ ...universalKeys, ability1: 'Mouse 4', ability2: 'Mouse 5', interact: 'E', ultimate: 'X' }),
  },
  {
    id: 'keyboard-only',
    name: '纯键盘操作',
    note: '全键盘 · 不使用鼠标',
    category: 'keyboard-only',
    bindings: createBindings(keyboardOnlyKeys),
  },
  {
    id: 'survival',
    name: '生存轻量',
    note: '饥荒 · 生存方案',
    category: 'survival',
    bindings: createBindings({ ...universalKeys, ability1: 'F', ability2: 'R', ability3: 'C', ultimate: 'V', interact: 'E' }),
  },
]
