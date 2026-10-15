// Overlay window bridge: exposes only the IPC channels overlay.html needs (no Node in the page).
const { contextBridge, ipcRenderer } = require('electron')
const SEND = new Set(['overlay-resize', 'close-overlay', 'overlay-lock-state'])
const RECV = new Set(['input-event', 'set-mode', 'set-show-mouse', 'set-mouse-settings', 'set-locked', 'set-custom-keys', 'set-keyboard-settings', 'set-theme', 'set-position'])
contextBridge.exposeInMainWorld('overlayIpc', {
  send: (ch, data) => { if (SEND.has(ch)) ipcRenderer.send(ch, data) },
  on: (ch, cb) => { if (RECV.has(ch)) ipcRenderer.on(ch, (_e, ...args) => cb({}, ...args)) },
})
