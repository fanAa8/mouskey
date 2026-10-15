// Visual 104/87-key keyboard + mouse maps (shared by 个人方案 and 实时显示)
import type React from 'react'
import { isEmptyKey } from '../lib/esdfMigration'

export type MapBinding = { id: string; label: string; key: string }

// 104-key keyboard grid layout - strictly based on real keyboard reference
// Unit: 0.25u per column, 92 columns total, 6 rows
// Column ranges: main(0-59), gap(60-61), nav(62-73), gap(74-75), numpad(76-91)
// Numpad shifted down 1 row, row 1 numpad area stays empty (blue box)
// Backslash key stretched to 1.5u to right-align with Backspace
export const keyboard104Grid: { key: string; col: number; row: number; colSpan?: number; rowSpan?: number }[] = [
  // === Row 1: Function keys + nav cluster row 1 + numpad area empty (blue box) ===
  { key: 'Esc', col: 0, row: 1, colSpan: 4 },
  { key: 'F1', col: 8, row: 1, colSpan: 4 },
  { key: 'F2', col: 12, row: 1, colSpan: 4 },
  { key: 'F3', col: 16, row: 1, colSpan: 4 },
  { key: 'F4', col: 20, row: 1, colSpan: 4 },
  { key: 'F5', col: 26, row: 1, colSpan: 4 },
  { key: 'F6', col: 30, row: 1, colSpan: 4 },
  { key: 'F7', col: 34, row: 1, colSpan: 4 },
  { key: 'F8', col: 38, row: 1, colSpan: 4 },
  { key: 'F9', col: 44, row: 1, colSpan: 4 },
  { key: 'F10', col: 48, row: 1, colSpan: 4 },
  { key: 'F11', col: 52, row: 1, colSpan: 4 },
  { key: 'F12', col: 56, row: 1, colSpan: 4 },
  // Nav cluster row 1
  { key: 'PRTSC', col: 62, row: 1, colSpan: 4 },
  { key: 'LOCK', col: 66, row: 1, colSpan: 4 },
  { key: 'PAUSE', col: 70, row: 1, colSpan: 4 },
  // Numpad area col 76-91 stays empty (blue box)

  // === Row 2: Number row + nav cluster row 2 + numpad row 1 (shifted down) ===
  { key: '`', col: 0, row: 2, colSpan: 4 },
  { key: '1', col: 4, row: 2, colSpan: 4 },
  { key: '2', col: 8, row: 2, colSpan: 4 },
  { key: '3', col: 12, row: 2, colSpan: 4 },
  { key: '4', col: 16, row: 2, colSpan: 4 },
  { key: '5', col: 20, row: 2, colSpan: 4 },
  { key: '6', col: 24, row: 2, colSpan: 4 },
  { key: '7', col: 28, row: 2, colSpan: 4 },
  { key: '8', col: 32, row: 2, colSpan: 4 },
  { key: '9', col: 36, row: 2, colSpan: 4 },
  { key: '0', col: 40, row: 2, colSpan: 4 },
  { key: '-', col: 44, row: 2, colSpan: 4 },
  { key: '=', col: 48, row: 2, colSpan: 4 },
  { key: 'Backspace', col: 52, row: 2, colSpan: 8 },
  // Nav cluster row 2
  { key: 'INS', col: 62, row: 2, colSpan: 4 },
  { key: 'HOME', col: 66, row: 2, colSpan: 4 },
  { key: 'PGUP', col: 70, row: 2, colSpan: 4 },
  // Numpad row 1 (shifted down from row 1)
  { key: 'NUM', col: 76, row: 2, colSpan: 4 },
  { key: '/', col: 80, row: 2, colSpan: 4 },
  { key: '*', col: 84, row: 2, colSpan: 4 },
  { key: '-', col: 88, row: 2, colSpan: 4 },

  // === Row 3: Tab row + nav cluster row 3 + numpad row 2 ===
  { key: 'Tab', col: 0, row: 3, colSpan: 6 },
  { key: 'Q', col: 6, row: 3, colSpan: 4 },
  { key: 'W', col: 10, row: 3, colSpan: 4 },
  { key: 'E', col: 14, row: 3, colSpan: 4 },
  { key: 'R', col: 18, row: 3, colSpan: 4 },
  { key: 'T', col: 22, row: 3, colSpan: 4 },
  { key: 'Y', col: 26, row: 3, colSpan: 4 },
  { key: 'U', col: 30, row: 3, colSpan: 4 },
  { key: 'I', col: 34, row: 3, colSpan: 4 },
  { key: 'O', col: 38, row: 3, colSpan: 4 },
  { key: 'P', col: 42, row: 3, colSpan: 4 },
  { key: '[', col: 46, row: 3, colSpan: 4 },
  { key: ']', col: 50, row: 3, colSpan: 4 },
  { key: '\\', col: 54, row: 3, colSpan: 6 },
  // Nav cluster row 3
  { key: 'DEL', col: 62, row: 3, colSpan: 4 },
  { key: 'END', col: 66, row: 3, colSpan: 4 },
  { key: 'PGDN', col: 70, row: 3, colSpan: 4 },
  // Numpad row 2
  { key: '7', col: 76, row: 3, colSpan: 4 },
  { key: '8', col: 80, row: 3, colSpan: 4 },
  { key: '9', col: 84, row: 3, colSpan: 4 },
  { key: '+', col: 88, row: 3, colSpan: 4, rowSpan: 2 },

  // === Row 4: Caps row + nav cluster row 4 (empty) + numpad row 3 ===
  { key: 'Caps', col: 0, row: 4, colSpan: 7 },
  { key: 'A', col: 7, row: 4, colSpan: 4 },
  { key: 'S', col: 11, row: 4, colSpan: 4 },
  { key: 'D', col: 15, row: 4, colSpan: 4 },
  { key: 'F', col: 19, row: 4, colSpan: 4 },
  { key: 'G', col: 23, row: 4, colSpan: 4 },
  { key: 'H', col: 27, row: 4, colSpan: 4 },
  { key: 'J', col: 31, row: 4, colSpan: 4 },
  { key: 'K', col: 35, row: 4, colSpan: 4 },
  { key: 'L', col: 39, row: 4, colSpan: 4 },
  { key: ';', col: 43, row: 4, colSpan: 4 },
  { key: "'", col: 47, row: 4, colSpan: 4 },
  { key: 'Enter', col: 51, row: 4, colSpan: 9 },
  // Nav cluster row 4 stays empty
  // Numpad row 3 (+ continues from row 3)
  { key: '4', col: 76, row: 4, colSpan: 4 },
  { key: '5', col: 80, row: 4, colSpan: 4 },
  { key: '6', col: 84, row: 4, colSpan: 4 },

  // === Row 5: Shift row + arrow up + numpad row 4 ===
  { key: 'Shift', col: 0, row: 5, colSpan: 9 },
  { key: 'Z', col: 9, row: 5, colSpan: 4 },
  { key: 'X', col: 13, row: 5, colSpan: 4 },
  { key: 'C', col: 17, row: 5, colSpan: 4 },
  { key: 'V', col: 21, row: 5, colSpan: 4 },
  { key: 'B', col: 25, row: 5, colSpan: 4 },
  { key: 'N', col: 29, row: 5, colSpan: 4 },
  { key: 'M', col: 33, row: 5, colSpan: 4 },
  { key: ',', col: 37, row: 5, colSpan: 4 },
  { key: '.', col: 41, row: 5, colSpan: 4 },
  { key: '/', col: 45, row: 5, colSpan: 4 },
  { key: 'Shift R', col: 49, row: 5, colSpan: 11 },
  // Arrow up
  { key: '↑', col: 66, row: 5, colSpan: 4 },
  // Numpad row 4
  { key: '1', col: 76, row: 5, colSpan: 4 },
  { key: '2', col: 80, row: 5, colSpan: 4 },
  { key: '3', col: 84, row: 5, colSpan: 4 },
  { key: 'Enter', col: 88, row: 5, colSpan: 4, rowSpan: 2 },

  // === Row 6: Ctrl row + arrow keys + numpad row 5 ===
  { key: 'Ctrl', col: 0, row: 6, colSpan: 5 },
  { key: 'Win', col: 5, row: 6, colSpan: 5 },
  { key: 'Alt', col: 10, row: 6, colSpan: 5 },
  { key: 'Space', col: 15, row: 6, colSpan: 25 },
  { key: 'Alt R', col: 40, row: 6, colSpan: 5 },
  { key: 'Win R', col: 45, row: 6, colSpan: 5 },
  { key: 'Menu', col: 50, row: 6, colSpan: 5 },
  { key: 'Ctrl R', col: 55, row: 6, colSpan: 5 },
  // Arrow keys
  { key: '←', col: 62, row: 6, colSpan: 4 },
  { key: '↓', col: 66, row: 6, colSpan: 4 },
  { key: '→', col: 70, row: 6, colSpan: 4 },
  // Numpad row 5 (Enter continues from row 5)
  { key: '0', col: 76, row: 6, colSpan: 8 },
  { key: '.', col: 84, row: 6, colSpan: 4 },
]

export function KeyboardMap({ bindings, selectedActionId, onAssign, pressedKeys, customKeys, full104 = false, conflictKeys }: { bindings: MapBinding[]; selectedActionId: string; conflictKeys?: Set<string>; onAssign: (key: string) => void; pressedKeys: Set<string>; customKeys?: string[] | null; full104?: boolean }) {
  const boundActionForKey = (key: string) => bindings.find((action) => action.key === key)
  const isCustomSelected = (key: string) => customKeys ? customKeys.includes(key) : false

  if (full104) {
    return (
      <div className="keyboard-wrap keyboard-104" aria-label="104键虚拟键盘">
        <div className="keyboard-grid-104">
          {keyboard104Grid.map((item, idx) => {
            const key = item.key
            const boundAction = boundActionForKey(key)
            const isActive = Boolean(boundAction)
            const isSelected = boundAction?.id === selectedActionId
            const isQazEmpty = isEmptyKey(key) && !isActive
            const isPressed = pressedKeys.has(key)
            const isCustom = isCustomSelected(key)
            const style: React.CSSProperties = {
              gridColumn: `${item.col + 1}${item.colSpan ? ` / span ${item.colSpan}` : ''}`,
              gridRow: `${item.row}${item.rowSpan ? ` / span ${item.rowSpan}` : ''}`,
            }
            return (
              <button
                className={`key key-grid-104 ${isActive ? 'is-mapped' : ''} ${isSelected ? 'is-selected' : ''} ${isQazEmpty ? 'is-qaz-empty' : ''} ${isPressed ? 'is-pressed' : ''} ${isCustom ? 'is-custom-selected' : ''} ${conflictKeys?.has(key) ? 'is-conflict' : ''}`}
                key={`${key}-${idx}`}
                onClick={() => onAssign(key)}
                title={boundAction ? `${boundAction.label}：${key}` : `设为 ${key}`}
                style={style}
              >
                <span>{key === 'Space' ? '' : key.replace(' R', '')}</span>
                {boundAction && <small>{boundAction.label}</small>}
                {isQazEmpty && <small className="key-qaz-hint">可自定义</small>}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="keyboard-wrap keyboard-87" aria-label="虚拟键盘">
      <div className="keyboard-grid-87">
        {keyboard104Grid.filter(item => item.col < 60).map((item, idx) => {
          const key = item.key
          const boundAction = boundActionForKey(key)
          const isActive = Boolean(boundAction)
          const isSelected = boundAction?.id === selectedActionId
          const isQazEmpty = isEmptyKey(key) && !isActive
          const isPressed = pressedKeys.has(key)
          const isCustom = isCustomSelected(key)
          const style: React.CSSProperties = {
            gridColumn: `${item.col + 1}${item.colSpan ? ` / span ${item.colSpan}` : ''}`,
            gridRow: `${item.row}${item.rowSpan ? ` / span ${item.rowSpan}` : ''}`,
          }
          return (
            <button
              className={`key key-grid-87 ${isActive ? 'is-mapped' : ''} ${isSelected ? 'is-selected' : ''} ${isQazEmpty ? 'is-qaz-empty' : ''} ${isPressed ? 'is-pressed' : ''} ${isCustom ? 'is-custom-selected' : ''} ${conflictKeys?.has(key) ? 'is-conflict' : ''}`}
              key={`${key}-${idx}`}
              onClick={() => onAssign(key)}
              title={boundAction ? `${boundAction.label}：${key}` : `设为 ${key}`}
              style={style}
            >
              <span>{key === 'Space' ? '' : key.replace(' R', '')}</span>
              {boundAction && <small>{boundAction.label}</small>}
              {isQazEmpty && <small className="key-qaz-hint">可自定义</small>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function MouseMap({ bindings, selectedActionId, onAssign, onClearBinding, pressedButtons }: { bindings: MapBinding[]; selectedActionId: string; onAssign: (key: string) => void; onClearBinding?: (key: string) => void; pressedButtons: Set<string> }) {
  const mouseBindings = ['Mouse 1', 'Mouse 2', 'Mouse 4', 'Mouse 5']
  const bindingFor = (key: string) => bindings.find((action) => action.key === key)
  // Map mouse key names to monitor button names
  const buttonKeyMap: Record<string, string> = { 'Mouse 1': 'left', 'Mouse 2': 'right', 'Mouse Wheel': 'middle', 'Mouse 4': 'x1', 'Mouse 5': 'x2' }
  const handleContextMenu = (e: React.MouseEvent, key: string) => {
    e.preventDefault()
    if (onClearBinding) onClearBinding(key)
  }
  return (
    <div className="mouse-map" aria-label="虚拟鼠标">
      <div className="mouse-device">
        {mouseBindings.slice(0, 2).map((key) => {
          const action = bindingFor(key)
          const isPressed = pressedButtons.has(buttonKeyMap[key] ?? '')
          return <button key={key} className={`mouse-button ${key === 'Mouse 1' ? 'left-click' : 'right-click'} ${action ? 'is-mapped' : ''} ${action?.id === selectedActionId ? 'is-selected' : ''} ${isPressed ? 'is-pressed' : ''}`} onClick={() => onAssign(key)} onContextMenu={(e) => handleContextMenu(e, key)} title={action ? `${action.label}：${key}（右键清除）` : `设为 ${key}`}><span>{action?.label ?? key}</span></button>
        })}
        <button className={`mouse-wheel ${pressedButtons.has('middle') ? 'is-pressed' : ''}`} onClick={() => onAssign('Mouse Wheel')} onContextMenu={(e) => handleContextMenu(e, 'Mouse Wheel')} title="设为鼠标滚轮（右键清除）" aria-label="将当前动作设为鼠标滚轮"><span /></button>
        {mouseBindings.slice(2).map((key, index) => {
          const action = bindingFor(key)
          const isPressed = pressedButtons.has(buttonKeyMap[key] ?? '')
          return <button key={key} className={`mouse-side mouse-side-${index} ${action ? 'is-mapped' : ''} ${action?.id === selectedActionId ? 'is-selected' : ''} ${isPressed ? 'is-pressed' : ''}`} onClick={() => onAssign(key)} onContextMenu={(e) => handleContextMenu(e, key)} title={action ? `${action.label}：${key}（右键清除）` : `设为 ${key}`}>{action?.label ?? (index ? '侧键 2' : '侧键 1')}</button>
        })}
      </div>
    </div>
  )
}

