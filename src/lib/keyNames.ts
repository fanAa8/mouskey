// Visual map key names (keyboard104Grid / MouseMap) <-> v2 canonical key names
const G2V: Record<string, string> = {
  Space: 'SPACE', Shift: 'LSHIFT', 'Shift R': 'RSHIFT', Ctrl: 'LCTRL', 'Ctrl R': 'RCTRL', Alt: 'LALT', 'Alt R': 'RALT',
  Tab: 'TAB', Caps: 'CAPSLOCK', Esc: 'ESCAPE', Enter: 'ENTER', Backspace: 'BACKSPACE', '`': 'TILDE',
  '←': 'LEFT', '→': 'RIGHT', '↑': 'UP', '↓': 'DOWN', DEL: 'DELETE', INS: 'INSERT', HOME: 'HOME', END: 'END', PGUP: 'PAGEUP', PGDN: 'PAGEDOWN',
  'Mouse 1': 'MOUSE1', 'Mouse 2': 'MOUSE2', 'Mouse Wheel': 'MOUSE3', 'Mouse 4': 'MOUSE4', 'Mouse 5': 'MOUSE5',
}
const V2G: Record<string, string> = Object.fromEntries(Object.entries(G2V).map(([g, v]) => [v, g]))
export const gridToV2 = (k: string) => G2V[k] ?? k.toUpperCase()
export const v2ToGrid = (k: string) => (k ? V2G[k] ?? k : '')
