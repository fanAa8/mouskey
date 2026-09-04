/**
 * 键盘按键图片资源映射工具
 *
 * 将键名映射到素材图片文件名，用于在 UI 上渲染真实的键盘按键图片。
 * 素材来源：vector-keyboard-controls (Outline 风格)
 */

const KEYS_BASE = '/keyboard/keys'

/** 键名到图片文件名的映射（不区分大小写） */
const KEY_IMAGE_MAP: Record<string, string> = {
  // 字母键
  q: 'q.png', w: 'w.png', e: 'e.png', r: 'r.png', t: 't.png',
  y: 'y.png', u: 'u.png', i: 'i.png', o: 'o.png', p: 'p.png',
  a: 'a.png', s: 's.png', d: 'd.png', f: 'f.png', g: 'g.png',
  h: 'h.png', j: 'j.png', k: 'k.png', l: 'l.png',
  z: 'z.png', x: 'x.png', c: 'c.png', v: 'v.png', b: 'b.png',
  n: 'n.png', m: 'm.png',
  // 数字键
  '0': '0.png', '1': '1.png', '2': '2.png', '3': '3.png', '4': '4.png',
  '5': '5.png', '6': '6.png', '7': '7.png', '8': '8.png', '9': '9.png',
  // 修饰键
  shift: 'shift.png',
  ctrl: 'ctrl.png',
  alt: 'alt.png',
  tab: 'tab.png',
  caps: 'caps.png',
  capslock: 'caps.png',
  // 功能键
  enter: 'enter.png',
  return: 'enter.png',
  backspace: 'backspace.png',
  escape: 'escape.png',
  esc: 'escape.png',
  space: 'space_md.png',
  spacebar: 'space_md.png',
  // 方向键
  arrowup: 'arrow-up.png',
  arrowdown: 'arrow-down.png',
  arrowleft: 'arrow-left.png',
  arrowright: 'arrow-right.png',
  up: 'arrow-up.png',
  down: 'arrow-down.png',
  left: 'arrow-left.png',
  right: 'arrow-right.png',
  // Windows 键
  win: 'windows.png',
  windows: 'windows.png',
  super: 'windows.png',
  // 功能键 F1-F12（素材里可能没有，用空白键）
}

/** 空白键图片（用于没有对应素材的键） */
const BLANK_KEYS = {
  sm: 'blank_sm.png',
  md: 'blank_md.png',
  lg: 'blank_lg.png',
}

/**
 * 获取键名对应的图片 URL
 *
 * @param keyName - 键名（如 'Q', 'Shift', 'Space'）
 * @param size - 空白键尺寸（当键没有对应图片时使用），默认 'md'
 * @returns 图片 URL，如果键有对应图片则返回图片 URL，否则返回空白键 URL
 */
export function getKeyImage(keyName: string, size: 'sm' | 'md' | 'lg' = 'md'): string {
  const normalized = keyName.toLowerCase().trim()
  // 移除 " R" 后缀（右 Shift/右 Ctrl 等）
  const cleaned = normalized.replace(/\s+r$/, '').trim()

  if (cleaned in KEY_IMAGE_MAP) {
    return `${KEYS_BASE}/${KEY_IMAGE_MAP[cleaned]}`
  }

  // 没有对应图片，返回空白键
  return `${KEYS_BASE}/${BLANK_KEYS[size]}`
}

/**
 * 判断键名是否有对应的图片素材
 */
export function hasKeyImage(keyName: string): boolean {
  const normalized = keyName.toLowerCase().trim()
  const cleaned = normalized.replace(/\s+r$/, '').trim()
  return cleaned in KEY_IMAGE_MAP
}

/**
 * 获取键名的显示文字（用于没有图片时显示在空白键上）
 */
export function getKeyDisplayText(keyName: string): string {
  // 移除 " R" 后缀
  return keyName.replace(/\s+R$/, '').trim()
}

/**
 * 鼠标控制图片资源
 */
const MOUSE_BASE = '/keyboard/mouse'

export const MOUSE_IMAGES = {
  mouse: `${MOUSE_BASE}/Mouse_Black.png`,
  leftClick: `${MOUSE_BASE}/LeftClick_Black.png`,
  rightClick: `${MOUSE_BASE}/RightClick_Black.png`,
  middleClick: `${MOUSE_BASE}/MiddleClick_Black.png`,
  move: `${MOUSE_BASE}/Move_Black.png`,
  moveUp: `${MOUSE_BASE}/MoveUp_Black.png`,
  moveDown: `${MOUSE_BASE}/MoveDown_Black.png`,
  moveLeft: `${MOUSE_BASE}/MoveLeft_Black.png`,
  moveRight: `${MOUSE_BASE}/MoveRight_Black.png`,
  scroll: `${MOUSE_BASE}/Scroll_Black.png`,
  scrollUp: `${MOUSE_BASE}/ScrollUp_Black.png`,
  scrollDown: `${MOUSE_BASE}/ScrollDown_Black.png`,
}
