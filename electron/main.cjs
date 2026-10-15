// Keyforge Electron Main Process
const { app, BrowserWindow, shell, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn } = require('child_process')
const http = require('http')
// Shared API handlers (game detection, config write, presets, LoL) — converted from vite.config.ts
const api = require('./api-handlers.cjs')
const v2 = require('./mouskey-v2.cjs')

const PORT = 4174
const SSE_PORT = 4175
const DEV_SERVER_URL = `http://127.0.0.1:${PORT}`
// Per-launch API token: the local HTTP server (127.0.0.1:4175) only accepts POSTs carrying it, so web pages
// open in a browser cannot drive config writes / patch installs. Passed to the renderer via the page URL (?t=).
const API_TOKEN = process.env.MOUSKEY_API_TOKEN || require('crypto').randomBytes(24).toString('hex')
const ALLOWED_ORIGINS = new Set(['null', 'file://', `http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`])

// Check if we're in development mode (vite exists)
const appDir = path.join(__dirname, '..')
const vitePath = path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js')
const isDev = fs.existsSync(vitePath)
const distPath = path.join(appDir, 'dist', 'index.html')
console.log('[Keyforge] Mode:', isDev ? 'development' : 'production')
console.log('[Keyforge] Dist path:', distPath, 'exists:', fs.existsSync(distPath))

// Settings file path
const settingsDir = path.join(app.getPath('userData'), 'keyforge')
const settingsFile = path.join(settingsDir, 'overlay-settings.json')

function ensureSettingsDir() {
  if (!fs.existsSync(settingsDir)) {
    fs.mkdirSync(settingsDir, { recursive: true })
  }
}

function saveOverlaySettings() {
  try {
    ensureSettingsDir()
    const bounds = overlayWindow && !overlayWindow.isDestroyed() ? overlayWindow.getBounds() : null
    const settings = {
      position: bounds ? { x: bounds.x, y: bounds.y } : null,
      mode: overlayMode,
      showMouse: overlayShowMouse,
      locked: overlayLocked,
      mouseSettings: overlayMouseSettings,
      customKeys: overlayCustomKeys,
      keyboardSettings: overlayKeyboardSettings,
      theme: overlayTheme,
    }
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
    console.log('[Keyforge] Overlay settings saved')
  } catch (err) {
    console.error('[Keyforge] Failed to save overlay settings:', err)
  }
}

function loadOverlaySettings() {
  try {
    if (fs.existsSync(settingsFile)) {
      const data = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'))
      console.log('[Keyforge] Overlay settings loaded:', JSON.stringify(data))
      return data
    }
  } catch (err) {
    console.error('[Keyforge] Failed to load overlay settings:', err)
  }
  return null
}

let mainWindow = null
let devServerProcess = null
let inputMonitorStarted = false
let mouseMonitorInterval = null
let sseServer = null
let sseClients = new Set()
let overlayWindow = null
let overlayPosition = 'bottom-left'
let overlayMode = 'keys-only'
let overlayShowMouse = false
let overlayLocked = false
let overlayMouseSettings = { x: -30, y: 40, width: 200, height: 220 }
let overlayCustomKeys = ['W', 'A', 'S', 'D', 'Space']
let overlayKeyboardSettings = { scale: 100, opacity: 100, highlightColor: '#00d4ff', highlightOpacity: 100 }
let overlayTheme = 'white'
let overlayTopmostTimer = null

// ─── Force overlay above fullscreen / games (Windows HWND_TOPMOST) ──────────
// Exclusive fullscreen (not borderless) often still cannot show third-party
// windows; borderless/windowed fullscreen will. We re-assert topmost because
// many games steal the z-order when they gain focus.
function forceOverlayTopmost() {
  if (!overlayWindow || overlayWindow.isDestroyed() || !overlayWindow.isVisible()) return
  try {
    // Highest Electron level on Windows
    overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch { /* ignore */ }

  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    // Same style as GetAsyncKeyState polling elsewhere in this file
    const SetWindowPos = user32.func('bool SetWindowPos(int64 hWnd, int64 hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags)')
    // HWND_TOPMOST = -1; keep position/size, do not activate (don't steal game focus)
    const SWP_NOSIZE = 0x0001
    const SWP_NOMOVE = 0x0002
    const SWP_NOACTIVATE = 0x0010
    const SWP_SHOWWINDOW = 0x0040
    const flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW
    const handle = overlayWindow.getNativeWindowHandle()
    const hwnd = process.arch === 'ia32'
      ? handle.readUInt32LE(0)
      : Number(handle.readBigUInt64LE(0))
    SetWindowPos(hwnd, -1, 0, 0, 0, 0, flags)
  } catch { /* koffi path optional */ }
}

function startOverlayTopmostKeeper() {
  stopOverlayTopmostKeeper()
  // Re-assert frequently enough to beat most games, light enough to ignore
  overlayTopmostTimer = setInterval(() => {
    forceOverlayTopmost()
  }, 1500)
}

function stopOverlayTopmostKeeper() {
  if (overlayTopmostTimer) {
    clearInterval(overlayTopmostTimer)
    overlayTopmostTimer = null
  }
}

// Create overlay window (always-on-top, transparent, frameless)
function createOverlayWindow() {
  if (overlayWindow) {
    overlayWindow.show()
    forceOverlayTopmost()
    startOverlayTopmostKeeper()
    return overlayWindow
  }

  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size
  const defaultWidth = 530
  const defaultHeight = 150

  // Load saved settings
  const savedSettings = loadOverlaySettings()
  if (savedSettings) {
    if (savedSettings.mode) overlayMode = savedSettings.mode
    if (savedSettings.showMouse !== undefined) overlayShowMouse = savedSettings.showMouse
    if (savedSettings.locked !== undefined) overlayLocked = savedSettings.locked
    if (savedSettings.mouseSettings) overlayMouseSettings = savedSettings.mouseSettings
    if (savedSettings.customKeys) overlayCustomKeys = savedSettings.customKeys
    if (savedSettings.keyboardSettings) overlayKeyboardSettings = { ...overlayKeyboardSettings, ...savedSettings.keyboardSettings }
    if (savedSettings.theme) overlayTheme = savedSettings.theme
  }

  // Determine initial position - use saved position if available, otherwise center
  let initialX = Math.floor((width - defaultWidth) / 2)
  let initialY = Math.floor((height - defaultHeight) / 2)
  if (savedSettings && savedSettings.position) {
    initialX = savedSettings.position.x
    initialY = savedSettings.position.y
    // Make sure window is within screen bounds
    if (initialX < 0 || initialX > width - 100) initialX = Math.floor((width - defaultWidth) / 2)
    if (initialY < 0 || initialY > height - 100) initialY = Math.floor((height - defaultHeight) / 2)
  }

  overlayWindow = new BrowserWindow({
    width: defaultWidth,
    height: defaultHeight,
    x: initialX,
    y: initialY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    // Keep clickability for lock/hide buttons, but avoid stealing keyboard focus
    focusable: false,
    hasShadow: false,
    show: true,
    backgroundColor: '#00000000',
    // Windows: small overlay toolbar sits better over other windows
    type: process.platform === 'win32' ? 'toolbar' : undefined,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'overlay-preload.cjs'),
    },
  })

  // screen-saver is the highest alwaysOnTop level Electron exposes on Windows
  overlayWindow.setAlwaysOnTop(true, 'screen-saver')
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  // Save position when window is moved
  overlayWindow.on('moved', () => {
    saveOverlaySettings()
  })

  // Save settings when window is closed
  overlayWindow.on('closed', () => {
    stopOverlayTopmostKeeper()
    saveOverlaySettings()
    overlayWindow = null
  })

  const overlayPath = path.join(__dirname, '..', 'public', 'overlay.html')
  overlayWindow.loadFile(overlayPath)

  overlayWindow.webContents.on('did-finish-load', () => {
    console.log('[Keyforge] Overlay page loaded')
    // Send current mode and settings to overlay
    setTimeout(() => {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.webContents.send('set-mode', overlayMode)
        overlayWindow.webContents.send('set-show-mouse', overlayShowMouse)
        overlayWindow.webContents.send('set-custom-keys', overlayCustomKeys)
        overlayWindow.webContents.send('set-keyboard-settings', overlayKeyboardSettings)
        overlayWindow.webContents.send('set-mouse-settings', overlayMouseSettings)
        overlayWindow.webContents.send('set-locked', overlayLocked)
        overlayWindow.webContents.send('set-theme', overlayTheme)
        // Set initial window size based on mode
        const sizes = {
          'keys-only': { width: 480, height: 340 },
          'game': { width: 540, height: 300 },
          'full': { width: 880, height: 300 },
          'custom': { width: overlayShowMouse ? 1080 : 880, height: overlayShowMouse ? 320 : 280 },
        }
        const size = sizes[overlayMode] || sizes['keys-only']
        overlayWindow.setSize(size.width, size.height)
      }
    }, 100)
    overlayWindow.show()
    forceOverlayTopmost()
    startOverlayTopmostKeeper()
  })

  overlayWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Keyforge] Overlay page failed to load:', errorCode, errorDescription)
  })

  overlayWindow.on('closed', () => {
    stopOverlayTopmostKeeper()
    overlayWindow = null
  })

  // Re-assert topmost when something tries to cover it
  overlayWindow.on('show', () => {
    forceOverlayTopmost()
    startOverlayTopmostKeeper()
  })
  overlayWindow.on('focus', () => forceOverlayTopmost())

  // Handle IPC from overlay
  const { ipcMain } = require('electron')
  ipcMain.on('close-overlay', () => {
    if (overlayWindow) {
      stopOverlayTopmostKeeper()
      overlayWindow.hide()
    }
  })

  ipcMain.on('overlay-resize', (event, size) => {
    if (overlayWindow && size.width && size.height) {
      overlayWindow.setSize(size.width, size.height)
    }
  })

  ipcMain.on('overlay-lock-state', (event, locked) => {
    overlayLocked = locked
  })

  console.log('[Keyforge] Overlay window created')
  return overlayWindow
}

// Set overlay position
function setOverlayPosition(position) {
  overlayPosition = position
  if (!overlayWindow) return

  const { screen } = require('electron')
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.workAreaSize
  const winWidth = 450
  const winHeight = 150
  const margin = 20

  let x, y
  switch (position) {
    case 'bottom-left':
      x = margin; y = height - winHeight - margin
      break
    case 'bottom-right':
      x = width - winWidth - margin; y = height - winHeight - margin
      break
    case 'top-left':
      x = margin; y = margin
      break
    case 'top-right':
      x = width - winWidth - margin; y = margin
      break
    case 'bottom-center':
      x = (width - winWidth) / 2; y = height - winHeight - margin
      break
    default:
      x = margin; y = height - winHeight - margin
  }

  overlayWindow.setPosition(Math.round(x), Math.round(y))
  overlayWindow.webContents.send('set-position', position)
}

// Toggle overlay visibility
function toggleOverlay() {
  if (overlayWindow) {
    if (overlayWindow.isVisible()) {
      saveOverlaySettings()
      stopOverlayTopmostKeeper()
      overlayWindow.hide()
    } else {
      overlayWindow.show()
      forceOverlayTopmost()
      startOverlayTopmostKeeper()
      // Don't reset position - keep user's last position
    }
  } else {
    createOverlayWindow()
    // Position is restored from saved settings in createOverlayWindow
  }
}

// Start independent SSE server for real-time input monitoring
function startSseServer() {
  if (sseServer) return

  sseServer = http.createServer(async (req, res) => {
    // CORS: only the app's own pages (file:// → Origin "null", or the dev server). Browsers always send Origin.
    const origin = req.headers.origin
    if (origin && !ALLOWED_ORIGINS.has(origin)) { res.writeHead(403); res.end('forbidden origin'); return }
    if (origin) res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MousKey-Token')
    if (req.method === 'POST' && req.headers['x-mouskey-token'] !== API_TOKEN) { res.writeHead(401, { 'Content-Type': 'application/json' }); res.end('{"success":false,"message":"missing/invalid API token"}'); return }

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    // SSE endpoint
    if (req.url === '/api/input/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write(': connected\n\n')
      const client = { res }
      sseClients.add(client)
      // Send connected event
      res.write(`data: ${JSON.stringify({ type: 'system', event: 'connected', clients: sseClients.size, timestamp: Date.now() })}\n\n`)
      // Heartbeat
      const heartbeat = setInterval(() => {
        try { res.write(': heartbeat\n\n') } catch { clearInterval(heartbeat) }
      }, 15000)
      req.on('close', () => {
        clearInterval(heartbeat)
        sseClients.delete(client)
      })
      return
    }

    // Emit endpoint (receive events from keyboard listener)
    if (req.url === '/api/input/emit' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          // Broadcast to all SSE clients
          const eventData = JSON.stringify({ ...data, timestamp: Date.now() })
          for (const client of sseClients) {
            try { client.res.write(`data: ${eventData}\n\n`) } catch { /* client disconnected */ }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String(err) }))
        }
      })
      return
    }

    // Overlay control endpoints
    if (req.url === '/api/overlay/show' && req.method === 'POST') {
      createOverlayWindow()
      // Don't reset position - keep user's last position
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, visible: true }))
      return
    }

    if (req.url === '/api/overlay/hide' && req.method === 'POST') {
      if (overlayWindow) {
        saveOverlaySettings()
        stopOverlayTopmostKeeper()
        overlayWindow.hide()
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, visible: false }))
      return
    }

    if (req.url === '/api/overlay/toggle' && req.method === 'POST') {
      toggleOverlay()
      const visible = overlayWindow ? overlayWindow.isVisible() : false
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, visible }))
      return
    }

    if (req.url === '/api/overlay/position' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          if (data.position) {
            setOverlayPosition(data.position)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, position: overlayPosition }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String(err) }))
        }
      })
      return
    }

    if (req.url === '/api/overlay/status' && req.method === 'GET') {
      const visible = overlayWindow ? overlayWindow.isVisible() : false
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ success: true, visible, position: overlayPosition, mode: overlayMode }))
      return
    }

    if (req.url === '/api/overlay/mode' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          if (data.mode) {
            overlayMode = data.mode
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.webContents.send('set-mode', data.mode)
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, mode: overlayMode }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String(err) }))
        }
      })
      return
    }

    if (req.url === '/api/overlay/show-mouse' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          overlayShowMouse = data.show !== false
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('set-show-mouse', overlayShowMouse)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, show: overlayShowMouse }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String(err) }))
        }
      })
      return
    }

    if (req.url === '/api/overlay/mouse-settings' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          overlayMouseSettings = { ...overlayMouseSettings, ...data }
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('set-mouse-settings', overlayMouseSettings)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, settings: overlayMouseSettings }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String(err) }))
        }
      })
      return
    }

    if (req.url === '/api/overlay/lock' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          overlayLocked = data.locked !== false
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('set-locked', overlayLocked)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, locked: overlayLocked }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String(err) }))
        }
      })
      return
    }

    if (req.url === '/api/overlay/settings' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        success: true,
        mode: overlayMode,
        showMouse: overlayShowMouse,
        locked: overlayLocked,
        mouseSettings: overlayMouseSettings,
        position: overlayPosition,
        customKeys: overlayCustomKeys,
      }))
      return
    }

    if (req.url === '/api/overlay/custom-keys' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          if (Array.isArray(data.keys)) {
            overlayCustomKeys = data.keys
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.webContents.send('set-custom-keys', overlayCustomKeys)
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, keys: overlayCustomKeys }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String(err) }))
        }
      })
      return
    }

    if (req.url === '/api/overlay/keyboard-settings' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          if (data.scale !== undefined) overlayKeyboardSettings.scale = data.scale
          if (data.opacity !== undefined) overlayKeyboardSettings.opacity = data.opacity
          if (data.highlightColor !== undefined) overlayKeyboardSettings.highlightColor = data.highlightColor
          if (data.highlightOpacity !== undefined) overlayKeyboardSettings.highlightOpacity = data.highlightOpacity
          if (overlayWindow && !overlayWindow.isDestroyed()) {
            overlayWindow.webContents.send('set-keyboard-settings', overlayKeyboardSettings)
          }
          saveOverlaySettings()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, settings: overlayKeyboardSettings }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String(err) }))
        }
      })
      return
    }

    if (req.url === '/api/overlay/theme' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => { body += chunk.toString() })
      req.on('end', () => {
        try {
          const data = JSON.parse(body || '{}')
          if (data.theme === 'white' || data.theme === 'black') {
            overlayTheme = data.theme
            if (overlayWindow && !overlayWindow.isDestroyed()) {
              overlayWindow.webContents.send('set-theme', overlayTheme)
            }
            saveOverlaySettings()
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, theme: overlayTheme }))
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: String(err) }))
        }
      })
      return
    }

    // ─── Game adapter & preset API routes (shared from api-handlers.cjs) ──────
    const urlPath = req.url.split('?')[0]
    const query = new URL(req.url, 'http://127.0.0.1').searchParams

    // Helper: read POST body as JSON
    const readBody = () => new Promise((resolve) => {
      let body = ''
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}) } catch { resolve({}) }
      })
    })

    const jsonOk = (data, code = 200) => {
      res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify(data))
    }

    // GET /api/adapters/detect?gameId=xxx
    if (urlPath === '/api/adapters/detect' && req.method === 'GET') {
      try { jsonOk(api.detectGame(query.get('gameId') ?? '')) }
      catch (err) { jsonOk({ success: false, message: `检测失败：${String(err)}` }, 500) }
      return
    }

    // GET /api/adapters/detect-all
    if (urlPath === '/api/adapters/detect-all' && req.method === 'GET') {
      try { jsonOk(api.detectAllGames()) }
      catch (err) { jsonOk({ success: false, message: `检测失败：${String(err)}` }, 500) }
      return
    }

    // GET /api/adapters/custom/list
    if (urlPath === '/api/adapters/custom/list' && req.method === 'GET') {
      try {
        const adapters = api.listCustomAdapters()
        jsonOk({ success: true, adapters, count: adapters.length, dir: api.getCustomAdaptersDir() })
      } catch (err) { jsonOk({ success: false, message: String(err) }, 500) }
      return
    }

    // POST /api/adapters/generate
    if (urlPath === '/api/adapters/generate' && req.method === 'POST') {
      const body = await readBody()
      try {
        const result = api.generateAdapterFromLudusavi(body.steamAppId)
        if (result.success && result.adapter) {
          const saveResult = api.saveCustomAdapter(result.adapter)
          jsonOk({ ...saveResult, adapter: result.adapter }, saveResult.success ? 200 : 400)
        } else {
          jsonOk({ success: false, message: result.message }, 400)
        }
      } catch (err) { jsonOk({ success: false, message: String(err) }, 500) }
      return
    }

    // POST /api/adapters/custom/delete
    if (urlPath === '/api/adapters/custom/delete' && req.method === 'POST') {
      const body = await readBody()
      try {
        const result = api.deleteCustomAdapter(body.id)
        jsonOk(result, result.success ? 200 : 400)
      } catch (err) { jsonOk({ success: false, message: String(err) }, 500) }
      return
    }




    // POST /api/v2/<action> — MousKey v2 (games overview, launch, personal profiles, plan/apply)
    if (urlPath.startsWith('/api/v2/') && req.method === 'POST') {
      const body = await readBody()
      try { const r = await v2.dispatch(urlPath.slice('/api/v2/'.length), body, { opener: (u) => require('electron').shell.openExternal(u) }); jsonOk(r, r.success === false && !r.needsConfirm ? 400 : 200) }
      catch (err) { jsonOk({ success: false, message: String(err) }, 500) }
      return
    }



    // GET /api/adapters/esdf-candidates — list migratable games after scan
    if (urlPath === '/api/adapters/esdf-candidates' && req.method === 'GET') {
      try { jsonOk(api.listEsdfCandidates()) }
      catch (err) { jsonOk({ success: false, message: `列出候选失败：${String(err)}` }, 500) }
      return
    }

    // POST /api/adapters/esdf-preview — dry-run one game
    if (urlPath === '/api/adapters/esdf-preview' && req.method === 'POST') {
      const body = await readBody()
      try { jsonOk(api.previewEsdfConfig(body)) }
      catch (err) { jsonOk({ success: false, message: `预览失败：${String(err)}` }, 500) }
      return
    }


    // POST /api/adapters/read
    if (urlPath === '/api/adapters/read' && req.method === 'POST') {
      const body = await readBody()
      try {
        const result = api.readGameConfig(body)
        jsonOk(result, result.success ? 200 : 400)
      } catch (err) { jsonOk({ success: false, message: '读取游戏配置失败。' }, 400) }
      return
    }

    // GET /api/adapters/lol/read
    if (urlPath === '/api/adapters/lol/read' && req.method === 'GET') {
      try { jsonOk(api.readLolSettings()) }
      catch { jsonOk({ status: 'error', message: '读取本机英雄联盟设置时发生错误。' }, 500) }
      return
    }

    // POST /api/adapters/lol/watch/start
    if (urlPath === '/api/adapters/lol/watch/start' && req.method === 'POST') {
      jsonOk(api.startLolSaveWatch())
      return
    }

    // GET /api/adapters/lol/watch/status
    if (urlPath === '/api/adapters/lol/watch/status' && req.method === 'GET') {
      jsonOk(api.getLolWatchStatus())
      return
    }

    // GET /api/presets/list
    if (urlPath === '/api/presets/list' && req.method === 'GET') {
      try { jsonOk(api.listLocalPresets()) }
      catch (err) { jsonOk({ success: false, message: String(err) }, 500) }
      return
    }

    // POST /api/presets/save
    if (urlPath === '/api/presets/save' && req.method === 'POST') {
      const body = await readBody()
      try {
        const result = api.saveLocalPreset(body)
        jsonOk(result, result.success ? 200 : 400)
      } catch (err) { jsonOk({ success: false, message: `无效的预设数据：${String(err)}` }, 400) }
      return
    }

    // GET /api/presets/load?id=xxx
    if (urlPath === '/api/presets/load' && req.method === 'GET') {
      const id = query.get('id') ?? ''
      if (!id) { jsonOk({ success: false, message: '缺少预设 ID。' }, 400); return }
      try {
        const result = api.loadLocalPreset(id)
        jsonOk(result, result.success ? 200 : 404)
      } catch (err) { jsonOk({ success: false, message: String(err) }, 500) }
      return
    }

    // POST /api/presets/delete
    if (urlPath === '/api/presets/delete' && (req.method === 'POST' || req.method === 'DELETE')) {
      const body = await readBody()
      const id = body.id ?? query.get('id') ?? ''
      if (!id) { jsonOk({ success: false, message: '缺少预设 ID。' }, 400); return }
      try {
        const result = api.deleteLocalPreset(id)
        jsonOk(result, result.success ? 200 : 400)
      } catch (err) { jsonOk({ success: false, message: String(err) }, 500) }
      return
    }

    res.writeHead(404)
    res.end()
  })

  sseServer.listen(SSE_PORT, '127.0.0.1', () => {
    console.log(`[Keyforge] SSE server started on port ${SSE_PORT}`)
  })

  sseServer.on('error', (err) => {
    console.error('[Keyforge] SSE server error:', err)
  })
}

// Broadcast input event to all SSE clients directly (in-process)
function broadcastInputEvent(eventData) {
  const data = JSON.stringify({ ...eventData, timestamp: Date.now() })
  for (const client of sseClients) {
    try { client.res.write(`data: ${data}\n\n`) } catch { /* client disconnected */ }
  }
  // Send to overlay window via IPC
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.webContents.send('input-event', eventData)
  }
}

// Start global keyboard listener in Electron main process (using Windows API polling)
function startKeyboardListener() {
  if (inputMonitorStarted) return
  inputMonitorStarted = true

  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const GetAsyncKeyState = user32.func('short GetAsyncKeyState(int vKey)')

    // Common virtual key codes mapping
    const KEY_MAP = {
      // Letters
      0x41: 'A', 0x42: 'B', 0x43: 'C', 0x44: 'D', 0x45: 'E',
      0x46: 'F', 0x47: 'G', 0x48: 'H', 0x49: 'I', 0x4A: 'J',
      0x4B: 'K', 0x4C: 'L', 0x4D: 'M', 0x4E: 'N', 0x4F: 'O',
      0x50: 'P', 0x51: 'Q', 0x52: 'R', 0x53: 'S', 0x54: 'T',
      0x55: 'U', 0x56: 'V', 0x57: 'W', 0x58: 'X', 0x59: 'Y', 0x5A: 'Z',
      // Numbers
      0x30: '0', 0x31: '1', 0x32: '2', 0x33: '3', 0x34: '4',
      0x35: '5', 0x36: '6', 0x37: '7', 0x38: '8', 0x39: '9',
      // Function keys
      0x70: 'F1', 0x71: 'F2', 0x72: 'F3', 0x73: 'F4', 0x74: 'F5', 0x75: 'F6',
      0x76: 'F7', 0x77: 'F8', 0x78: 'F9', 0x79: 'F10', 0x7A: 'F11', 0x7B: 'F12',
      // Modifiers
      0x10: 'Shift', 0xA0: 'LShift', 0xA1: 'RShift',
      0x11: 'Ctrl', 0xA2: 'LCtrl', 0xA3: 'RCtrl',
      0x12: 'Alt', 0xA4: 'LAlt', 0xA5: 'RAlt',
      0x5B: 'LWin', 0x5C: 'RWin',
      // Other keys
      0x20: 'Space', 0x0D: 'Enter', 0x08: 'Backspace', 0x09: 'Tab', 0x1B: 'Esc',
      0x25: 'ArrowLeft', 0x26: 'ArrowUp', 0x27: 'ArrowRight', 0x28: 'ArrowDown',
      0x2C: 'PrintScreen', 0x2D: 'Insert', 0x2E: 'Delete',
      0x21: 'PageUp', 0x22: 'PageDown', 0x24: 'Home', 0x23: 'End',
      0xBA: ';', 0xBB: '=', 0xBC: ',', 0xBD: '-', 0xBE: '.', 0xBF: '/',
      0xC0: '`', 0xDB: '[', 0xDC: '\\', 0xDD: ']', 0xDE: "'",
      // Numpad
      0x60: 'Num0', 0x61: 'Num1', 0x62: 'Num2', 0x63: 'Num3', 0x64: 'Num4',
      0x65: 'Num5', 0x66: 'Num6', 0x67: 'Num7', 0x68: 'Num8', 0x69: 'Num9',
      0x6A: 'Num*', 0x6B: 'Num+', 0x6D: 'Num-', 0x6E: 'Num.', 0x6F: 'Num/',
    }

    const keyCodes = Object.keys(KEY_MAP).map(Number)
    let previousKeyState = {}

    // Initialize previous state
    for (const vk of keyCodes) {
      previousKeyState[vk] = false
    }

    // Poll keyboard state at 50ms interval
    setInterval(() => {
      for (const vk of keyCodes) {
        const pressed = GetAsyncKeyState(vk) !== 0
        if (pressed !== previousKeyState[vk]) {
          previousKeyState[vk] = pressed
          const keyName = KEY_MAP[vk]
          broadcastInputEvent({
            type: 'keyboard',
            key: keyName,
            state: pressed ? 'down' : 'up',
            vKey: vk,
            scanCode: 0,
          })
        }
      }
    }, 50)

    console.log('[Keyforge] Global keyboard listener started (Windows API polling, 50ms)')
  } catch (err) {
    console.error('[Keyforge] Failed to start keyboard listener:', err)
  }

  // Start mouse button monitoring via Windows API GetAsyncKeyState
  try {
    const koffi = require('koffi')
    const user32 = koffi.load('user32.dll')
    const GetAsyncKeyState = user32.func('short GetAsyncKeyState(int vKey)')

    const MOUSE_VKEYS = {
      left: 1,    // VK_LBUTTON
      right: 2,   // VK_RBUTTON
      middle: 4,  // VK_MBUTTON
      x1: 6,      // VK_XBUTTON2 (用户鼠标侧键1实际触发XBUTTON2)
      x2: 5,      // VK_XBUTTON1 (用户鼠标侧键2实际触发XBUTTON1)
    }

    let currentMouseState = { left: false, right: false, middle: false, x1: false, x2: false }

    mouseMonitorInterval = setInterval(() => {
      for (const [button, vkey] of Object.entries(MOUSE_VKEYS)) {
        const pressed = GetAsyncKeyState(vkey) !== 0
        if (pressed !== currentMouseState[button]) {
          currentMouseState[button] = pressed
          broadcastInputEvent({
            type: 'mouse',
            button,
            state: pressed ? 'down' : 'up',
          })
        }
      }
    }, 50)
    console.log('[Keyforge] Mouse monitor started in main process (polling at 50ms)')
  } catch (err) {
    console.error('[Keyforge] Failed to start mouse monitor:', err)
  }
}

// Check if dev server is already running
function checkServerRunning(url, timeout = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now()
    const check = () => {
      http.get(url, (res) => {
        resolve(true)
      }).on('error', () => {
        if (Date.now() - startTime < timeout) {
          setTimeout(check, 500)
        } else {
          resolve(false)
        }
      })
    }
    check()
  })
}

// Start vite dev server
function startDevServer() {
  return new Promise((resolve, reject) => {
    console.log('[Keyforge] Starting dev server...')

    const appDir = path.join(__dirname, '..')
    const vitePath = path.join(appDir, 'node_modules', 'vite', 'bin', 'vite.js')

    console.log('[Keyforge] Vite path:', vitePath)
    console.log('[Keyforge] App dir:', appDir)
    console.log('[Keyforge] Exec path:', process.execPath)

    // Use ELECTRON_RUN_AS_NODE=1 to run electron.exe as Node.js
    devServerProcess = spawn(process.execPath, [vitePath, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
      cwd: appDir,
      stdio: 'inherit',
      shell: false,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        ELECTRON_RUN_AS_NODE: '1',
      },
    })

    devServerProcess.on('error', (err) => {
      console.error('[Keyforge] Failed to start dev server:', err)
      reject(err)
    })

    // Wait for server to be ready
    checkServerRunning(DEV_SERVER_URL, 30000).then((running) => {
      if (running) {
        console.log('[Keyforge] Dev server is running')
        resolve()
      } else {
        reject(new Error('Dev server failed to start within 30 seconds'))
      }
    })
  })
}

function createWindow() {
  // Hide default menu bar
  Menu.setApplicationMenu(null)

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#0a0e17',
    title: 'MousKey - 游戏键位管理器',
    icon: resolveAsset('app-icon-256.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    frame: true,
    show: false,
  })

  // Load the app
  if (isDev) {
    console.log('[Keyforge] Loading dev server URL:', DEV_SERVER_URL)
    mainWindow.loadURL(`${DEV_SERVER_URL}/?t=${API_TOKEN}`)
  } else {
    console.log('[Keyforge] Loading production file:', distPath)
    mainWindow.loadFile(distPath, { query: { t: API_TOKEN } })
  }

  // Handle page load errors
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('[Keyforge] Page load failed:', errorCode, errorDescription)
    // Retry after 2 seconds (only in dev mode)
    if (isDev) {
      setTimeout(() => {
        console.log('[Keyforge] Retrying page load...')
        mainWindow.loadURL(`${DEV_SERVER_URL}/?t=${API_TOKEN}`)
      }, 2000)
    }
  })

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[Keyforge] Page loaded successfully')
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

let tray = null
function resolveAsset(file) {
  // Production: resources/app/dist/<file>; Dev: resources/app/public/<file>
  const distCandidate = path.join(appDir, 'dist', file)
  if (fs.existsSync(distCandidate)) return distCandidate
  return path.join(appDir, 'public', file)
}
function createTray() {
  try {
    // Destroy any existing tray first to prevent duplicate icons
    if (tray) {
      try { tray.destroy() } catch { /* ignore */ }
      tray = null
    }
    // Load the tray icon (32px PNG; Windows handles DPI scaling automatically)
    let trayIcon = nativeImage.createFromPath(resolveAsset('tray-icon-32.png'))
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createFromPath(resolveAsset('tray-icon-16.png'))
    }
    if (trayIcon.isEmpty()) {
      // Last-resort fallback: 16x16 solid icon so the tray still appears
      trayIcon = nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAIUlEQVR4nGNQuvyOgRJMkWZ0A/6TiEcNGDVguBowMLkRABBwco8v3/xnAAAAAElFTkSuQmCC')
    }

    tray = new Tray(trayIcon)
    tray.setToolTip('MousKey - 游戏键位管理器')

    const contextMenu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } else { createWindow() } } },
      { label: '显示/隐藏悬浮窗', click: () => toggleOverlay() },
      { type: 'separator' },
      { label: '退出', click: () => { app.quit() } }
    ])

    tray.setContextMenu(contextMenu)

    // Click tray icon to show main window
    tray.on('click', () => {
      if (mainWindow) {
        mainWindow.show()
        mainWindow.focus()
      } else {
        createWindow()
      }
    })

    console.log('[Keyforge] System tray created')
  } catch (err) {
    console.error('[Keyforge] Failed to create tray:', err)
  }
}

// ─── Single instance lock: prevent duplicate processes / tray icons ────────
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  // Another instance is already running — quit this one immediately
  app.quit()
} else {
  app.on('second-instance', () => {
    // User tried to launch a second copy: focus the existing window instead
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    } else {
      createWindow()
    }
  })
}

// App lifecycle
app.whenReady().then(async () => {
  try {
    // In development mode, check if server is already running and start dev server
    if (isDev) {
      const alreadyRunning = await checkServerRunning(DEV_SERVER_URL, 2000)

      if (!alreadyRunning) {
        await startDevServer()
      } else {
        console.log('[Keyforge] Dev server already running, connecting...')
      }
    } else {
      console.log('[Keyforge] Production mode, skipping dev server startup')
    }

    // Start independent SSE server for real-time input monitoring
    startSseServer()

    createWindow()

    // Create the system tray exactly once per app process
    createTray()

    // Start global input monitoring in main process (has Windows message loop)
    startKeyboardListener()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  } catch (err) {
    console.error('[Keyforge] Failed to start:', err)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // Kill dev server process
  if (devServerProcess) {
    console.log('[Keyforge] Stopping dev server...')
    devServerProcess.kill()
  }
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Clean up on exit
app.on('before-quit', () => {
  stopOverlayTopmostKeeper()
  if (devServerProcess) {
    devServerProcess.kill()
  }
  if (mouseMonitorInterval) {
    clearInterval(mouseMonitorInterval)
  }
  if (tray) {
    try { tray.destroy() } catch { /* ignore */ }
    tray = null
  }
})
