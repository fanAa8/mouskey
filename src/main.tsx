import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App'

// Attach the per-launch API token (given by Electron as ?t=) to every request to the local MousKey server.
const API_TOKEN = new URLSearchParams(window.location.search).get('t') || ''
const nativeFetch = window.fetch.bind(window)
window.fetch = (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const local = url.startsWith('/api/') || url.startsWith('http://127.0.0.1:4175/')
  if (!local || !API_TOKEN) return nativeFetch(input, init)
  const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
  headers.set('X-MousKey-Token', API_TOKEN)
  return nativeFetch(input, { ...init, headers })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
