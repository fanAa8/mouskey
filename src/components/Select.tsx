import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export type SelectOption = { value: string; label: string; group?: string; disabled?: boolean }

/** Themed dropdown (replaces native <select>: no system white popups). Keyboard: ↑/↓/Home/End/Enter/Space/Esc, type-ahead. */
export function Select({ value, options, onChange, placeholder = '请选择', className = '', ariaLabel }: { value: string; options: SelectOption[]; onChange: (v: string) => void; placeholder?: string; className?: string; ariaLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const root = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const enabled = useMemo(() => options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0), [options])
  const cur = options.find((o) => o.value === value)
  useEffect(() => {
    if (!open) return
    const f = (e: MouseEvent) => { if (root.current && !root.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', f); return () => document.removeEventListener('mousedown', f)
  }, [open])
  useEffect(() => { if (open) list.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' }) }, [open, active])
  const openList = () => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true) }
  const pick = (i: number) => { const o = options[i]; if (!o || o.disabled) return; onChange(o.value); setOpen(false) }
  const move = (d: number) => {
    const pos = enabled.indexOf(active)
    const next = enabled[Math.min(enabled.length - 1, Math.max(0, (pos < 0 ? 0 : pos + d)))]
    if (next !== undefined) setActive(next)
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); openList(); return }
    if (!open) return
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(enabled[0]) }
    else if (e.key === 'End') { e.preventDefault(); setActive(enabled[enabled.length - 1]) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(active) }
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false)
    else if (e.key.length === 1) { const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(e.key.toLowerCase())); if (i >= 0) setActive(i) }
  }
  let lastGroup: string | undefined
  return (
    <div ref={root} className={`mk-select ${open ? 'is-open' : ''} ${className}`}>
      <button type="button" className="mk-select-trigger" aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKey}>
        <span className="mk-select-value">{cur?.label ?? placeholder}</span><ChevronDown size={14} />
      </button>
      {open && (
        <div ref={list} className="mk-select-list" role="listbox" aria-activedescendant={active >= 0 ? `mk-opt-${active}` : undefined}>
          {options.map((o, i) => {
            const head = o.group && o.group !== lastGroup ? <div className="mk-select-group" role="presentation">{o.group}</div> : null
            lastGroup = o.group
            return (
              <div key={o.value} style={{ display: 'contents' }}>
                {head}
                <div id={`mk-opt-${i}`} data-idx={i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled}
                  className={`mk-select-option ${o.value === value ? 'is-selected' : ''} ${i === active ? 'is-active' : ''} ${o.disabled ? 'is-disabled' : ''}`}
                  onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(i) }}>
                  <span>{o.label}</span>{o.value === value && <Check size={13} />}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
