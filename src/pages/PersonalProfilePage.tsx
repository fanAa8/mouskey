import { useEffect, useMemo, useState } from 'react'
import { Copy, Mouse, Keyboard, Plus, Save, Trash2 } from 'lucide-react'
import { v2, type CatalogAction, type PersonalProfile } from '../lib/v2api'

const GROUP_LABEL: Record<string, string> = { movement: '移动', action: '动作', abilities: '技能', summoner: '召唤师/特殊技能', items: '物品', system: '系统' }

const normalizeKey = (e: React.KeyboardEvent): string => {
  const map: Record<string, string> = { ' ': 'SPACE', Shift: 'LSHIFT', Control: 'LCTRL', Alt: 'LALT', Tab: 'TAB', Escape: '', Backspace: '' }
  if (e.key in map) return map[e.key]
  if (/^F\d+$/.test(e.key)) return e.key
  if (e.key.length === 1) return e.key.toUpperCase()
  return e.key.toUpperCase()
}

export function PersonalProfilePage({ onToast }: { onToast: (m: string) => void }) {
  const [catalog, setCatalog] = useState<CatalogAction[]>([])
  const [profiles, setProfiles] = useState<PersonalProfile[]>([])
  const [draft, setDraft] = useState<PersonalProfile | null>(null)
  const [capturing, setCapturing] = useState<string | null>(null)

  const refresh = async (selectId?: string) => {
    const r = await v2<{ profiles: PersonalProfile[]; catalog: CatalogAction[] }>('profiles.list')
    if (!r.profiles) { onToast(r.message || '读取个人方案失败'); return }
    setProfiles(r.profiles); setCatalog(r.catalog)
    const pick = r.profiles.find((p) => p.id === (selectId ?? draft?.id)) || r.profiles[0]
    if (pick) setDraft(JSON.parse(JSON.stringify(pick)))
  }
  useEffect(() => { void refresh() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const groups = useMemo(() => {
    const g: Record<string, CatalogAction[]> = {}
    for (const a of catalog) (g[a.group] ||= []).push(a)
    return g
  }, [catalog])

  const conflicts = useMemo(() => {
    if (!draft) return new Set<string>()
    const seen: Record<string, string[]> = {}
    for (const [id, k] of Object.entries(draft.bindings)) {
      if (!k) continue
      const a = catalog.find((c) => c.id === id)
      if (draft.movementMode === 'mouse' && a?.movement) continue
      ;(seen[k] ||= []).push(id)
    }
    return new Set(Object.values(seen).filter((l) => l.length > 1).flat())
  }, [draft, catalog])

  if (!draft) return <section className="v2-page"><p className="v2-muted">正在加载个人方案…</p></section>

  const setKey = (id: string, key: string) => setDraft({ ...draft, bindings: { ...draft.bindings, [id]: key } })
  const save = async () => {
    const r = await v2<{ profile: PersonalProfile }>('profiles.save', { ...draft, id: draft.builtin ? undefined : draft.id })
    if (r.success) { onToast(`已保存方案「${r.profile.name}」`); void refresh(r.profile.id) } else onToast(r.message || '保存失败')
  }
  const remove = async () => {
    if (draft.builtin) { onToast('内置方案不能删除，可另存为新方案后修改'); return }
    const r = await v2('profiles.delete', { id: draft.id })
    if (r.success) { onToast('已删除'); void refresh('') } else onToast(r.message || '删除失败')
  }
  const newProfile = (mode: 'keyboard' | 'mouse') => {
    const bindings: Record<string, string> = {}
    for (const a of catalog) if (mode === 'keyboard' || !a.movement) bindings[a.id] = a.wasdDefault
    setDraft({ id: '', name: mode === 'keyboard' ? '新键盘移动方案' : '新点击移动方案', movementMode: mode, bindings })
  }

  return (
    <section className="v2-page">
      <div className="v2-toolbar">
        <select className="profile-select" value={draft.id} onChange={(e) => { const p = profiles.find((x) => x.id === e.target.value); if (p) setDraft(JSON.parse(JSON.stringify(p))) }}>
          {!draft.id && <option value="">（未保存的新方案）</option>}
          {profiles.map((p) => <option key={p.id} value={p.id}>{p.builtin ? '内置 · ' : ''}{p.name} · {p.movementMode === 'mouse' ? '鼠标点击移动' : '键盘移动'}</option>)}
        </select>
        <button className="subtle-button v2-btn" onClick={() => newProfile('keyboard')}><Plus size={14} />新建键盘方案</button>
        <button className="subtle-button v2-btn" onClick={() => newProfile('mouse')}><Plus size={14} />新建点击方案</button>
        <button className="subtle-button v2-btn" onClick={() => setDraft({ ...draft, id: '', builtin: false, name: `${draft.name} 副本` })}><Copy size={14} />另存为</button>
        <button className="subtle-button v2-btn v2-danger" onClick={remove}><Trash2 size={14} />删除</button>
        <button className="command-button" onClick={save}><Save size={15} />保存方案</button>
      </div>

      <div className="v2-card">
        <label className="v2-field">方案名字
          <input className="v2-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} disabled={draft.builtin} />
        </label>
        <div className="v2-field">移动方式
          <div className="v2-seg">
            <button className={draft.movementMode === 'keyboard' ? 'is-active' : ''} onClick={() => setDraft({ ...draft, movementMode: 'keyboard' })}><Keyboard size={14} />键盘移动（WASD 类，如 ESDF）</button>
            <button className={draft.movementMode === 'mouse' ? 'is-active' : ''} onClick={() => setDraft({ ...draft, movementMode: 'mouse' })}><Mouse size={14} />鼠标点击移动（MOBA，只改技能）</button>
          </div>
        </div>
        <p className="v2-muted">
          {draft.movementMode === 'mouse'
            ? '点击移动方案：支持点击移动的游戏（英雄联盟）会切到点击移动，只映射技能/物品；其他游戏只应用技能类动作，移动保持原样。'
            : '键盘移动方案：移动、跳跃、技能等全部按语义映射到每个游戏的原生动作；未识别的游戏动作会在批量迁移页让你确认。'}
          {draft.builtin && ' 内置方案只读，点「另存为」后可修改。'}
        </p>
      </div>

      <div className="v2-grid">
        {Object.entries(groups).map(([g, list]) => (
          <div key={g} className={`v2-card ${draft.movementMode === 'mouse' && g === 'movement' ? 'v2-disabled' : ''}`}>
            <div className="v2-card-title">{GROUP_LABEL[g] || g}{draft.movementMode === 'mouse' && g === 'movement' && <span className="v2-muted">（点击移动模式下不使用）</span>}</div>
            {list.map((a) => (
              <div key={a.id} className="v2-row">
                <span className="v2-row-label">{a.label}</span>
                <button
                  className={`v2-keycap ${capturing === a.id ? 'is-capturing' : ''} ${conflicts.has(a.id) ? 'is-conflict' : ''}`}
                  disabled={draft.builtin || (draft.movementMode === 'mouse' && a.movement)}
                  onClick={() => setCapturing(a.id)}
                  onKeyDown={(e) => { if (capturing !== a.id) return; e.preventDefault(); const k = normalizeKey(e); setKey(a.id, k); setCapturing(null) }}
                  onMouseDown={(e) => { if (capturing === a.id && e.button > 0) { e.preventDefault(); setKey(a.id, `MOUSE${e.button + 1}`); setCapturing(null) } }}
                  onBlur={() => setCapturing(null)}
                  title="点击后按下键盘键（或鼠标侧键）；Esc/Backspace 清空"
                >{capturing === a.id ? '请按键…' : (draft.bindings[a.id] || '—')}</button>
              </div>
            ))}
          </div>
        ))}
      </div>
      {conflicts.size > 0 && <p className="v2-warn">⚠ 同一个键绑定了多个动作（红框），保存前建议处理。</p>}
    </section>
  )
}
