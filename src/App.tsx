import { useEffect, useState } from 'react'
import {
  Activity,
  ArrowRightLeft,
  Check,
  X,
  UserRound,
  Moon, Sun,
} from 'lucide-react'
import {
  type ActionId,
  type Profile,
  profileSeeds,
} from './adapters'
import { KeyboardMap, } from './components/InputMaps'
import { BatchPage } from './pages/BatchPage'
import { PersonalProfilePage } from './pages/PersonalProfilePage'

// Key name to asset file mapping
const KEY_ASSET_MAP: Record<string, string> = {
  // Letters
  'A': 'a_white.png', 'B': 'b_white.png', 'C': 'c_white.png', 'D': 'd_white.png',
  'E': 'e_white.png', 'F': 'f_white.png', 'G': 'g_white.png', 'H': 'h_white.png',
  'I': 'i_white.png', 'J': 'j_white.png', 'K': 'k_white.png', 'L': 'l_white.png',
  'M': 'm_white.png', 'N': 'n_white.png', 'O': 'o_white.png', 'P': 'p_white.png',
  'Q': 'q_white.png', 'R': 'r_white.png', 'S': 's_white.png', 'T': 't_white.png',
  'U': 'u_white.png', 'V': 'v_white.png', 'W': 'w_white.png', 'X': 'x_white.png',
  'Y': 'y_white.png', 'Z': 'z_white.png',
  // Numbers
  '0': '0_white.png', '1': '1_white.png', '2': '2_white.png', '3': '3_white.png',
  '4': '4_white.png', '5': '5_white.png', '6': '6_white.png', '7': '7_white.png',
  '8': '8_white.png', '9': '9_white.png',
  // Function keys
  'F1': 'f1_white.png', 'F2': 'f2_white.png', 'F3': 'f3_white.png', 'F4': 'f4_white.png',
  'F5': 'f5_white.png', 'F6': 'f6_white.png', 'F7': 'f7_white.png', 'F8': 'f8_white.png',
  'F9': 'f9_white.png', 'F10': 'f10_white.png', 'F11': 'f11_white.png', 'F12': 'f12_white.png',
  // Special keys
  'Space': 'space_lg_white.png',
  'Enter': 'enter_white.png',
  'Backspace': 'backspace_white.png',
  'Tab': 'tab_white.png',
  'Esc': 'escape_white.png',
  'Escape': 'escape_white.png',
  'Shift': 'shift_white.png', 'LShift': 'shift_white.png', 'RShift': 'shift_white.png',
  'Ctrl': 'ctrl_white.png', 'LCtrl': 'ctrl_white.png', 'RCtrl': 'ctrl_white.png',
  'Alt': 'alt_white.png', 'LAlt': 'alt_white.png', 'RAlt': 'alt_white.png',
  'LWin': 'windows_white.png', 'RWin': 'windows_white.png',
  // Arrow keys
  'ArrowLeft': 'arrow-left_white.png', 'ArrowUp': 'arrow-up_white.png',
  'ArrowRight': 'arrow-right_white.png', 'ArrowDown': 'arrow-down_white.png',
  // Navigation
  'Delete': 'delete_white.png', 'Insert': 'insert_white.png',
  'Home': 'home_white.png', 'End': 'end_white.png',
  'PageUp': 'page-up_white.png', 'PageDown': 'page-down_white.png',
  'CapsLock': 'caps_white.png', 'Caps': 'caps_white.png',
  // Symbols
  ';': 'semicolon_white.png', '=': 'equals_white.png', ',': 'comma_white.png',
  '-': 'minus_white.png', '.': 'period_white.png', '/': 'slash_white.png',
  '`': 'backtick_white.png', '[': 'bracket-open_white.png',
  '\\': 'backslash_white.png', ']': 'bracket-close_white.png',
}

const getKeyAsset = (key: string): string | null => {
  const fileName = KEY_ASSET_MAP[key]
  return fileName ? `${import.meta.env.BASE_URL}keyboard-assets/keys/${fileName}` : null
}

// Mouse button to asset file mapping
const MOUSE_ASSET_MAP: Record<string, string> = {
  'left': 'LeftClick_White.png',
  'right': 'RightClick_White.png',
  'middle': 'MiddleClick_White.png',
  'x1': 'Mouse_White.png',
  'x2': 'Mouse_White.png',
}

const getMouseAsset = (button: string): string | null => {
  const fileName = MOUSE_ASSET_MAP[button]
  return fileName ? `${import.meta.env.BASE_URL}keyboard-assets/mouse/${fileName}` : null
}

const getMouseBadge = (button: string): string | null => {
  if (button === 'x1') return '1'
  if (button === 'x2') return '2'
  return null
}

function App() {
  const [profiles, setProfiles] = useState<Profile[]>(profileSeeds)
  const [activeProfileId, setActiveProfileId] = useState(profileSeeds[0].id)
  const [toast, setToast] = useState('')

  // ─── Real-time input monitoring ────────────────────────────────────────────
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set())
  const [pressedMouseButtons, setPressedMouseButtons] = useState<Set<string>>(new Set())
  const [inputMonitorConnected, setInputMonitorConnected] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [overlayMode, setOverlayMode] = useState('keys-only')
  const [showMouse, setShowMouse] = useState(false)
  const [overlayLocked, setOverlayLocked] = useState(false)
  const [mouseSettings, setMouseSettings] = useState({ x: 0, y: 40, width: 200, height: 220 })
  const [customKeySets, setCustomKeySets] = useState<Record<string, string[]>>({
    custom1: ['W', 'A', 'S', 'D', 'Space'],
    custom2: ['Q', 'W', 'E', 'R', 'Space'],
    custom3: ['E', 'S', 'D', 'F', 'Space'],
  })
  const [customKeys, setCustomKeys] = useState<string[]>(['W', 'A', 'S', 'D', 'Space'])
  const [isEditingCustom, setIsEditingCustom] = useState(false)
  const [showMouseForMode, setShowMouseForMode] = useState<Record<string, boolean>>({
    'keys-only': false,
    'game': true,
    'full': true,
    'custom1': false,
    'custom2': false,
    'custom3': false,
  })
  const [historyExpanded, setHistoryExpanded] = useState(true)
  const [keyboardScale, setKeyboardScale] = useState(100)
  const [keyboardOpacity, setKeyboardOpacity] = useState(100)
  const [keyboardHighlightColor, setKeyboardHighlightColor] = useState('#00d4ff')
  const [keyboardHighlightOpacity, setKeyboardHighlightOpacity] = useState(100)
  const [overlayTheme, setOverlayTheme] = useState('white')
  const [showFull104, setShowFull104] = useState(false)
  const [showKeyboardAdjust, setShowKeyboardAdjust] = useState(true)
  const [lastInputEvent, setLastInputEvent] = useState<{ key: string; state: string; time: number } | null>(null)
  const [inputHistory, setInputHistory] = useState<Array<{ key: string; state: string; time: number }>>([])
  const [totalKeyPresses, setTotalKeyPresses] = useState(0)
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const q = new URLSearchParams(window.location.search).get('theme')
    if (q === 'light' || q === 'dark') return q
    return localStorage.getItem('mk-theme') === 'light' ? 'light' : 'dark'
  })
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('mk-theme', theme) }, [theme])
  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  const [activePage, setActivePage] = useState<'config' | 'personal' | 'games' | 'sync'>('personal')

  const activeProfile = profiles.find((profile) => profile.id === activeProfileId) ?? profiles[0]

  useEffect(() => {
    if (!toast) return undefined
    const timeout = window.setTimeout(() => setToast(''), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  // ─── Real-time input monitoring SSE ────────────────────────────────────────
  useEffect(() => {
    const normalizeInputKey = (raw: string): string => {
      const k = raw.toUpperCase().trim()
      const map: Record<string, string> = {
        'SPACE': 'Space', ' ': 'Space',
        'LEFT CTRL': 'Ctrl', 'RIGHT CTRL': 'Ctrl R', 'LCONTROL': 'Ctrl', 'RCONTROL': 'Ctrl R',
        'LEFT SHIFT': 'Shift', 'RIGHT SHIFT': 'Shift R', 'LSHIFT': 'Shift', 'RSHIFT': 'Shift R',
        'LEFT ALT': 'Alt', 'RIGHT ALT': 'Alt R', 'LALT': 'Alt', 'RALT': 'Alt R',
        'TAB': 'Tab', 'CAPS LOCK': 'Caps', 'CAPSLOCK': 'Caps', 'CAPITAL': 'Caps',
        'RETURN': 'Enter', 'ENTER': 'Enter',
        'BACKSPACE': 'Backspace', 'BACK': 'Backspace',
        'ESCAPE': 'Esc', 'ESC': 'Esc',
        'LEFT WINDOWS': 'Win', 'RIGHT WINDOWS': 'Win', 'LWIN': 'Win', 'RWIN': 'Win',
        'APPS': 'Menu', 'APPLICATION': 'Menu',
        'UP': '↑', 'DOWN': '↓', 'LEFT': '←', 'RIGHT': '→',
      }
      if (map[k]) return map[k]
      // Single char keys (letters, numbers, symbols) - capitalize first letter
      if (k.length === 1) return k.toUpperCase()
      // F1-F12
      if (/^F\d{1,2}$/.test(k)) return k
      return raw
    }

    let eventSource: EventSource | null = null
    try {
      eventSource = new EventSource('http://127.0.0.1:4175/api/input/events')
      eventSource.onopen = () => setInputMonitorConnected(true)
      eventSource.onerror = () => setInputMonitorConnected(false)
      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === 'keyboard') {
            const key = normalizeInputKey(data.key)
            setPressedKeys((prev) => {
              const next = new Set(prev)
              if (data.state === 'down') next.add(key)
              else next.delete(key)
              return next
            })
            const event = { key, state: data.state, time: data.timestamp }
            setLastInputEvent(event)
            setInputHistory((prev) => [event, ...prev].slice(0, 20))
            if (data.state === 'down') setTotalKeyPresses((prev) => prev + 1)
          } else if (data.type === 'mouse') {
            const buttonLabel = data.button === 'left' ? '左键' : data.button === 'right' ? '右键' : data.button === 'middle' ? '中键' : data.button === 'x1' ? '侧键1' : '侧键2'
            setPressedMouseButtons((prev) => {
              const next = new Set(prev)
              if (data.state === 'down') next.add(data.button)
              else next.delete(data.button)
              return next
            })
            const event = { key: buttonLabel, state: data.state, time: data.timestamp }
            setLastInputEvent(event)
            setInputHistory((prev) => [event, ...prev].slice(0, 20))
            if (data.state === 'down') setTotalKeyPresses((prev) => prev + 1)
          } else if (data.type === 'system' && data.event === 'connected') {
            setInputMonitorConnected(true)
          }
        } catch { /* ignore parse errors */ }
      }
    } catch {
      setInputMonitorConnected(false)
    }
    return () => {
      if (eventSource) eventSource.close()
      setInputMonitorConnected(false)
      setPressedKeys(new Set())
      setPressedMouseButtons(new Set())
    }
  }, [])

  return (
    <main className="app-shell">
      <section className="workspace">
        <header className="workspace-header">
          <div>
            <div className="breadcrumb">控制中心 <span>/</span> {({ config: '配置档', personal: '个人方案', games: '游戏迁移', sync: '实时显示' } as const)[activePage]}</div>
            <div className="title-row">
              <h1>{activePage === 'personal' ? '个人方案' : activePage === 'games' ? '游戏迁移' : '实时按键显示'}</h1>
            </div>
          </div>
          <div className="page-tabs">
            <button className={`page-tab ${activePage === 'personal' ? 'is-active' : ''}`} onClick={() => setActivePage('personal')}>
              <UserRound size={14} /> 个人方案
            </button>
            <button className={`page-tab ${activePage === 'games' ? 'is-active' : ''}`} onClick={() => setActivePage('games')}>
              <ArrowRightLeft size={14} /> 游戏迁移
            </button>
            <button className={`page-tab ${activePage === 'sync' ? 'is-active' : ''}`} onClick={() => setActivePage('sync')}>
              <Activity size={14} /> 实时显示
            </button>
          </div>
          <div className="header-actions">
            <button className="theme-toggle" onClick={toggleTheme} title="切换深色/浅色主题" aria-label="切换主题">
              {theme === 'dark' ? <><Moon size={14} /> 深色</> : <><Sun size={14} /> 浅色</>}
            </button>
          </div>
        </header>

        {activePage === 'personal' && <PersonalProfilePage onToast={setToast} pressedKeys={pressedKeys} pressedButtons={pressedMouseButtons} />}
        {activePage === 'games' && <BatchPage onToast={setToast} />}

        {activePage === 'sync' && (
          <section className="realtime-page">
            {/* 第一行：显示模式 + 悬浮窗控制 */}
            <div className="display-mode-bar">
              <span className="display-mode-label">显示模式：</span>
              <div className="display-mode-buttons">
                {[
                  { id: 'keys-only', label: '仅按键' },
                  { id: 'game', label: '游戏模式' },
                  { id: 'full', label: '全键盘' },
                  { id: 'custom1', label: '自定义1' },
                  { id: 'custom2', label: '自定义2' },
                  { id: 'custom3', label: '自定义3' },
                ].map((mode) => (
                  <div key={mode.id} className="mode-with-mouse-toggle">
                    <button
                      className={`overlay-mode-btn ${overlayMode === mode.id ? 'is-active' : ''}`}
                      onClick={async () => {
                        setOverlayMode(mode.id)
                        // If switching to a custom mode, load its key set
                        if (mode.id.startsWith('custom')) {
                          const keys = customKeySets[mode.id] || []
                          setCustomKeys(keys)
                          try {
                            await fetch('http://127.0.0.1:4175/api/overlay/custom-keys', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ keys }),
                            })
                          } catch (err) {
                            console.error('Set custom keys failed:', err)
                          }
                        }
                        // Apply this mode's mouse setting
                        const shouldShowMouse = showMouseForMode[mode.id] ?? false
                        setShowMouse(shouldShowMouse)
                        try {
                          await fetch('http://127.0.0.1:4175/api/overlay/mode', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ mode: mode.id.startsWith('custom') ? 'custom' : mode.id }),
                          })
                          await fetch('http://127.0.0.1:4175/api/overlay/show-mouse', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ show: shouldShowMouse }),
                          })
                        } catch (err) {
                          console.error('Set overlay mode failed:', err)
                        }
                      }}
                    >
                      {mode.label}
                    </button>
                    <button
                      className={`mouse-toggle-btn ${showMouseForMode[mode.id] ? 'is-active' : ''}`}
                      onClick={() => {
                        const newVal = !showMouseForMode[mode.id]
                        setShowMouseForMode(prev => ({ ...prev, [mode.id]: newVal }))
                        // If this is the current mode, apply immediately
                        if (overlayMode === mode.id) {
                          setShowMouse(newVal)
                          fetch('http://127.0.0.1:4175/api/overlay/show-mouse', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ show: newVal }),
                          }).catch(console.error)
                        }
                      }}
                      title={showMouseForMode[mode.id] ? '隐藏鼠标' : '显示鼠标'}
                    >
                      🖱
                    </button>
                  </div>
                ))}
              </div>
              <div className="display-mode-right">
                <label className="full104-toggle">
                  <input
                    type="checkbox"
                    checked={showFull104}
                    onChange={(e) => setShowFull104(e.target.checked)}
                  />
                  <span>104键</span>
                </label>
                <button
                  className={`overlay-toggle-btn ${overlayVisible ? 'is-active' : ''}`}
                  onClick={async () => {
                    try {
                      const resp = await fetch('http://127.0.0.1:4175/api/overlay/toggle', { method: 'POST' })
                      const data = await resp.json()
                      setOverlayVisible(data.visible)
                    } catch (err) {
                      console.error('Toggle overlay failed:', err)
                    }
                  }}
                >
                  {overlayVisible ? '👁 隐藏悬浮窗' : '👁 显示悬浮窗'}
                </button>
                <button
                  className={`overlay-toggle-btn ${overlayLocked ? 'is-active' : ''}`}
                  onClick={async () => {
                    const newVal = !overlayLocked
                    setOverlayLocked(newVal)
                    try {
                      await fetch('http://127.0.0.1:4175/api/overlay/lock', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ locked: newVal }),
                      })
                    } catch (err) {
                      console.error('Set lock failed:', err)
                    }
                  }}
                >
                  {overlayLocked ? '🔒 已锁定' : '🔓 未锁定'}
                </button>
              </div>
            </div>

            {/* 统一调整面板（可收起展开，两排并排式结构） */}
            <div className="keyboard-adjust-bar">
              <div className="adjust-bar-header" onClick={() => setShowKeyboardAdjust(!showKeyboardAdjust)}>
                <div className="keyboard-adjust-title">⚙ 调整面板</div>
                <span className="adjust-bar-toggle">{showKeyboardAdjust ? '▲' : '▼'}</span>
              </div>
              {showKeyboardAdjust && (
              <div className="adjust-items-grid">
                {/* 第一排 */}
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>缩放</label>
                    <span>{keyboardScale}%</span>
                  </div>
                  <input type="range" min="50" max="150" value={keyboardScale}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setKeyboardScale(val)
                      fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ scale: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>透明度</label>
                    <span>{keyboardOpacity}%</span>
                  </div>
                  <input type="range" min="30" max="100" value={keyboardOpacity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setKeyboardOpacity(val)
                      fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ opacity: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <label>高亮色</label>
                  <div className="color-picker-row">
                    <input
                      type="color"
                      value={keyboardHighlightColor}
                      onChange={(e) => {
                        const val = e.target.value
                        setKeyboardHighlightColor(val)
                        fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ highlightColor: val }),
                        }).catch(console.error)
                      }}
                      className="color-input"
                    />
                    {['#00d4ff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7'].map(color => (
                      <button
                        key={color}
                        className={`color-dot ${keyboardHighlightColor === color ? 'is-active' : ''}`}
                        style={{ background: color }}
                        onClick={() => {
                          setKeyboardHighlightColor(color)
                          fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ highlightColor: color }),
                          }).catch(console.error)
                        }}
                      />
                    ))}
                  </div>
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>高光透明度</label>
                    <span>{keyboardHighlightOpacity}%</span>
                  </div>
                  <input type="range" min="10" max="100" value={keyboardHighlightOpacity}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setKeyboardHighlightOpacity(val)
                      fetch('http://127.0.0.1:4175/api/overlay/keyboard-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ highlightOpacity: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>X偏移</label>
                    <span>{mouseSettings.x}</span>
                  </div>
                  <input type="range" min="-100" max="100" value={mouseSettings.x}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setMouseSettings(s => ({ ...s, x: val }))
                      fetch('http://127.0.0.1:4175/api/overlay/mouse-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ x: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>Y偏移</label>
                    <span>{mouseSettings.y}</span>
                  </div>
                  <input type="range" min="-100" max="200" value={mouseSettings.y}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setMouseSettings(s => ({ ...s, y: val }))
                      fetch('http://127.0.0.1:4175/api/overlay/mouse-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ y: val }),
                      }).catch(console.error)
                    }} />
                </div>
                {/* 第二排 */}
                <div className="adjust-row-item">
                  <label>主题</label>
                  <div className="theme-toggle-row">
                    <button
                      className={`theme-btn ${overlayTheme === 'white' ? 'is-active' : ''}`}
                      onClick={() => {
                        setOverlayTheme('white')
                        fetch('http://127.0.0.1:4175/api/overlay/theme', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ theme: 'white' }),
                        }).catch(console.error)
                      }}
                    >⬜ 白色</button>
                    <button
                      className={`theme-btn ${overlayTheme === 'black' ? 'is-active' : ''}`}
                      onClick={() => {
                        setOverlayTheme('black')
                        fetch('http://127.0.0.1:4175/api/overlay/theme', {
                          method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ theme: 'black' }),
                        }).catch(console.error)
                      }}
                    >⬛ 黑色</button>
                  </div>
                </div>
                <div className="adjust-row-item">
                  <label>重置</label>
                  <button className="adjust-reset-btn" onClick={() => {
                    setKeyboardScale(100)
                    setKeyboardOpacity(100)
                    setKeyboardHighlightColor('#00d4ff')
                    setKeyboardHighlightOpacity(100)
                  }}>恢复默认</button>
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>宽度</label>
                    <span>{mouseSettings.width}</span>
                  </div>
                  <input type="range" min="100" max="350" value={mouseSettings.width}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setMouseSettings(s => ({ ...s, width: val }))
                      fetch('http://127.0.0.1:4175/api/overlay/mouse-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ width: val }),
                      }).catch(console.error)
                    }} />
                </div>
                <div className="adjust-row-item">
                  <div className="adjust-item-header">
                    <label>高度</label>
                    <span>{mouseSettings.height}</span>
                  </div>
                  <input type="range" min="100" max="350" value={mouseSettings.height}
                    onChange={(e) => {
                      const val = parseInt(e.target.value)
                      setMouseSettings(s => ({ ...s, height: val }))
                      fetch('http://127.0.0.1:4175/api/overlay/mouse-settings', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ height: val }),
                      }).catch(console.error)
                    }} />
                </div>
              </div>
              )}
            </div>

            <div className="realtime-main-layout">
              {/* 左侧栏：当前按键 + 鼠标状态 */}
              <div className="realtime-left-panel">
                <div className="realtime-card realtime-current-keys">
                  <h3>当前按键</h3>
                  <div className="realtime-keys-display">
                    {pressedKeys.size === 0 && pressedMouseButtons.size === 0 ? (
                      <span className="realtime-placeholder">等待按键输入...</span>
                    ) : (
                      <>
                        {Array.from(pressedKeys).map((key) => {
                          const keyImg = getKeyAsset(key)
                          return (
                            <span key={key} className="realtime-keycap has-image">
                              {keyImg ? (
                                <img src={keyImg} alt={key} className="keycap-img" />
                              ) : (
                                key === 'Space' ? '空格' : key
                              )}
                            </span>
                          )
                        })}
                        {Array.from(pressedMouseButtons).map((btn) => {
                          const label = btn === 'left' ? '左键' : btn === 'right' ? '右键' : btn === 'middle' ? '中键' : btn === 'x1' ? '侧键1' : '侧键2'
                          const mouseImg = getMouseAsset(btn)
                          const badge = getMouseBadge(btn)
                          return (
                            <span key={btn} className="realtime-keycap is-mouse has-image">
                              {mouseImg ? (
                                <span className="keycap-img-wrapper">
                                  <img src={mouseImg} alt={label} className="keycap-img" />
                                  {badge && <span className="keycap-badge">{badge}</span>}
                                </span>
                              ) : (
                                label
                              )}
                            </span>
                          )
                        })}
                      </>
                    )}
                  </div>
                </div>

                <div className="realtime-card">
                  <h3>鼠标状态</h3>
                  <div className="realtime-mouse-display">
                    {[
                      { id: 'left', label: '左键' },
                      { id: 'right', label: '右键' },
                      { id: 'middle', label: '中键' },
                      { id: 'x1', label: '侧键1' },
                      { id: 'x2', label: '侧键2' },
                    ].map((btn) => {
                      const mouseImg = getMouseAsset(btn.id)
                      const badge = getMouseBadge(btn.id)
                      return (
                        <div key={btn.id} className={`realtime-mouse-btn ${pressedMouseButtons.has(btn.id) ? 'is-pressed' : ''}`}>
                          {mouseImg ? (
                            <span className="mouse-btn-img-wrapper">
                              <img src={mouseImg} alt={btn.label} className="mouse-btn-img" />
                              {badge && <span className="mouse-btn-badge">{badge}</span>}
                            </span>
                          ) : (
                            <span className="mouse-btn-icon" />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* 右侧主内容：实时键盘可视化 */}
              <div className="realtime-right-panel">
                <div className="realtime-card">
                  <div className="realtime-card-header">
                    <h3>实时键盘可视化</h3>
                    <div className="realtime-card-actions">
                      {isEditingCustom ? (
                        <>
                          <span className="custom-edit-hint">已选 {customKeys.length} 个</span>
                          <button
                            className="overlay-toggle-btn is-active"
                            onClick={async () => {
                              setIsEditingCustom(false)
                              // Save to current custom mode's key set
                              if (overlayMode.startsWith('custom')) {
                                setCustomKeySets(prev => ({
                                  ...prev,
                                  [overlayMode]: [...customKeys],
                                }))
                              }
                              try {
                                await fetch('http://127.0.0.1:4175/api/overlay/custom-keys', {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ keys: customKeys }),
                                })
                                setToast('自定义按键已保存')
                              } catch (err) {
                                console.error('Save custom keys failed:', err)
                              }
                            }}
                          >
                            ✓ 保存
                          </button>
                          <button
                            className="overlay-toggle-btn"
                            onClick={() => {
                              setIsEditingCustom(false)
                              setCustomKeys(['W', 'A', 'S', 'D', 'Space'])
                            }}
                          >
                            ✕ 取消
                          </button>
                        </>
                      ) : (
                        <button
                          className="overlay-toggle-btn"
                          onClick={() => setIsEditingCustom(true)}
                        >
                          ✎ 编辑自定义
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={`realtime-keyboard-full ${isEditingCustom ? 'is-editing' : ''} ${showFull104 ? 'is-104' : ''}`}>
                    <KeyboardMap
                      bindings={activeProfile.bindings}
                      selectedActionId={'' as ActionId}
                      onAssign={(key) => {
                        if (isEditingCustom) {
                          setCustomKeys(prev => {
                            if (prev.includes(key)) {
                              return prev.filter(k => k !== key)
                            } else {
                              return [...prev, key]
                            }
                          })
                        }
                      }}
                      pressedKeys={pressedKeys}
                      customKeys={isEditingCustom ? customKeys : null}
                      full104={showFull104}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* 底部：按键历史（可展开/收起） */}
            <div className="realtime-card realtime-history-card">
              <div className="history-header" onClick={() => setHistoryExpanded(!historyExpanded)}>
                <h3>按键历史 <span className="realtime-history-count">最近 {inputHistory.length} 条</span></h3>
                <span className="history-toggle-icon">{historyExpanded ? '▲' : '▼'}</span>
              </div>
              {historyExpanded && (
                <div className="realtime-history-list">
                  {inputHistory.length === 0 ? (
                    <span className="realtime-placeholder">暂无按键记录</span>
                  ) : (
                    inputHistory.map((event, index) => (
                      <div key={`${event.time}-${index}`} className={`realtime-history-item ${event.state === 'down' ? 'is-down' : 'is-up'} ${index === 0 ? 'is-latest' : ''}`}>
                        <span className="history-key">{event.key}</span>
                        <span className="history-state">{event.state === 'down' ? '按下' : '释放'}</span>
                        <span className="history-time">{new Date(event.time).toLocaleTimeString('zh-CN', { hour12: false })}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </section>
        )}
      </section>

      {toast && <div className="toast" role="status"><Check size={16} />{toast}<button onClick={() => setToast('')} aria-label="关闭提示"><X size={15} /></button></div>}
    </main>
  )
}

export default App
