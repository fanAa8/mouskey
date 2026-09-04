/**
 * ESDF 键位迁移规则模块
 *
 * 核心准则：QAZ 三行字母开始的键位整体右移一个单位
 * - 移动键：WASD → ESDF
 * - 技能键：QWER → WERT
 * - 互动键：F → G
 * - QAZ 三个键空出来，由玩家自行配置
 * - 修饰键（Ctrl/Shift/Alt/Tab/CapsLock）保持不变
 * - 数字键保持不变
 */

/** 右移映射表：原键 → 右移后的目标键 */
export const ESDF_SHIFT_MAP: Record<string, string> = {
  // 第一行（Q W E R T）
  q: 'w',
  w: 'e',
  e: 'r',
  r: 't',
  // 第二行（A S D F G）
  a: 's',
  s: 'd',
  d: 'f',
  f: 'g',
  // 第三行（Z X C V B）
  z: 'x',
  x: 'c',
  c: 'v',
  v: 'b',
}

/** 右移后空出来的键（QAZ） */
export const ESDF_EMPTY_KEYS = ['q', 'a', 'z']

/** 修饰键（保持不变） */
export const ESDF_MODIFIER_KEYS = [
  'shift', 'ctrl', 'alt', 'tab', 'capslock', 'caps',
  'left shift', 'right shift', 'left ctrl', 'right ctrl',
  'left alt', 'right alt', 'windows', 'win', 'command', 'fn',
]

/** 数字键（保持不变） */
export const ESDF_NUMBER_KEYS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '0',
]

/** 功能键（保持不变） */
export const ESDF_FUNCTION_KEYS = [
  'escape', 'esc', 'enter', 'return', 'space', 'backspace', 'delete',
  'insert', 'home', 'end', 'pageup', 'pagedown',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
]

/** 方向键（保持不变） */
export const ESDF_ARROW_KEYS = [
  'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  'up', 'down', 'left', 'right',
]

/** 鼠标键（保持不变） */
export const ESDF_MOUSE_KEYS = [
  'mouse 1', 'mouse 2', 'mouse 3', 'mouse 4', 'mouse 5',
  'left mouse', 'right mouse', 'middle mouse',
  'mouse wheel up', 'mouse wheel down',
]

/**
 * 判断一个键是否需要右移
 */
export function shouldShiftKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return normalized in ESDF_SHIFT_MAP
}

/**
 * 判断一个键是否是右移后空出来的 QAZ 键
 */
export function isEmptyKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return ESDF_EMPTY_KEYS.includes(normalized)
}

/**
 * 判断一个键是否是修饰键（保持不变）
 */
export function isModifierKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return ESDF_MODIFIER_KEYS.includes(normalized)
}

/**
 * 获取一个键右移后的目标键
 * @returns 右移后的键名，如果不需要右移则返回原键
 */
export function getShiftTarget(key: string): string {
  const normalized = normalizeKey(key)
  if (normalized in ESDF_SHIFT_MAP) {
    return ESDF_SHIFT_MAP[normalized]
  }
  return key
}

/**
 * 规范化键名（小写、去空格、统一别名）
 */
export function normalizeKey(key: string): string {
  let k = key.toLowerCase().trim()
  // 统一别名
  const aliases: Record<string, string> = {
    'leftshift': 'left shift',
    'rightshift': 'right shift',
    'leftcontrol': 'left ctrl',
    'rightcontrol': 'right ctrl',
    'leftalt': 'left alt',
    'rightalt': 'right alt',
    'lshift': 'left shift',
    'rshift': 'right shift',
    'lctrl': 'left ctrl',
    'rctrl': 'right ctrl',
    'lalt': 'left alt',
    'ralt': 'right alt',
    'control': 'ctrl',
    'capslock': 'caps',
    'return': 'enter',
    'escape': 'esc',
    'spacebar': 'space',
    ' ': 'space',
  }
  if (k in aliases) {
    k = aliases[k]
  }
  return k
}

/**
 * 对一套键位绑定应用 ESDF 右移规则
 *
 * @param bindings - 原始键位绑定数组 [{ action, key }]
 * @returns 应用 ESDF 后的键位绑定数组
 */
export type KeyBinding = {
  action: string
  key: string
  label?: string
  category?: string
}

export function applyEsdfMigration(bindings: KeyBinding[]): KeyBinding[] {
  return bindings.map((binding) => {
    const key = binding.key
    if (shouldShiftKey(key)) {
      return {
        ...binding,
        key: getShiftTarget(key),
      }
    }
    return binding
  })
}

/**
 * 检测一套键位绑定中是否有冲突（多个动作绑定到同一个键）
 *
 * @param bindings - 键位绑定数组（支持 { key, id } 或 { key, action } 格式）
 * @returns 冲突信息 { key: [actionIds] }
 */
export function detectKeyConflicts(bindings: Array<{ key: string; id?: string; action?: string; label?: string }>): Record<string, string[]> {
  const keyMap: Record<string, string[]> = {}
  for (const binding of bindings) {
    const normalized = normalizeKey(binding.key)
    if (!keyMap[normalized]) {
      keyMap[normalized] = []
    }
    const actionId = binding.id ?? binding.action ?? binding.label ?? 'unknown'
    keyMap[normalized].push(actionId)
  }
  // 只返回有冲突的（多个动作绑定到同一个键）
  const conflicts: Record<string, string[]> = {}
  for (const [key, actions] of Object.entries(keyMap)) {
    if (actions.length > 1) {
      conflicts[key] = actions
    }
  }
  return conflicts
}

/**
 * 生成 ESDF 布局的默认键位绑定（基于一套通用动作）
 *
 * @returns ESDF 默认键位绑定
 */
export function generateEsdfDefaults(): KeyBinding[] {
  return [
    // 移动（ESDF）
    { action: 'forward', key: 'e', label: '前进', category: 'movement' },
    { action: 'left', key: 's', label: '左移', category: 'movement' },
    { action: 'back', key: 'd', label: '后退', category: 'movement' },
    { action: 'right', key: 'f', label: '右移', category: 'movement' },
    // 技能（WERT，原QWER右移）
    { action: 'ability1', key: 'w', label: '技能1', category: 'abilities' },
    { action: 'ability2', key: 'e', label: '技能2', category: 'abilities' },
    { action: 'ability3', key: 'r', label: '技能3', category: 'abilities' },
    { action: 'ultimate', key: 't', label: '终极技能', category: 'abilities' },
    // 互动（G，原F右移）
    { action: 'interact', key: 'g', label: '交互', category: 'items' },
    // 攻击（鼠标）
    { action: 'primary', key: 'mouse 1', label: '主操作', category: 'combat' },
    { action: 'secondary', key: 'mouse 2', label: '副操作', category: 'combat' },
    // 系统
    { action: 'jump', key: 'space', label: '跳跃', category: 'system' },
    { action: 'sprint', key: 'shift', label: '冲刺', category: 'system' },
    { action: 'crouch', key: 'ctrl', label: '蹲伏', category: 'system' },
    { action: 'map', key: 'm', label: '地图', category: 'system' },
    // QAZ 空着（玩家自行配置）
  ]
}

/**
 * 获取 ESDF 布局的说明文本
 */
export function getEsdfDescription(): string {
  return [
    'ESDF 布局 = WASD 整体右移一个键位',
    '',
    '移动：WASD → ESDF',
    '技能：QWER → WERT',
    '互动：F → G',
    '',
    'QAZ 三个键空出，可自行配置高频功能',
    '修饰键（Ctrl/Shift/Alt/Tab）保持不变',
    '数字键保持不变',
  ].join('\n')
}
