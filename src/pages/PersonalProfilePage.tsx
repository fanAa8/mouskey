import { useEffect, useMemo, useState } from 'react'
import { Copy, Keyboard, Mouse, Plus, Save, Trash2 } from 'lucide-react'
import { v2, CATEGORY_LABEL, type CatalogActionX, type PersonalProfile } from '../lib/v2api'
import { KeyboardMap, MouseMap, type MapBinding } from '../components/InputMaps'
import { gridToV2, v2ToGrid } from '../lib/keyNames'
import { profileSeeds } from '../adapters/games'

type Mode = 'keyboard' | 'mouse'
const GROUP_LABEL: Record<string, string> = { movement: '移动', action: '动作', mouse: '鼠标', command: '指令（攻击移动/停止）', abilities: '技能', summoner: '召唤师技能', items: '物品 / 饰品（眼）', camera: '镜头', system: '系统' }

const normalizeKey = (e: React.KeyboardEvent): string => {
  const map: Record<string, string> = { ' ': 'SPACE', Shift: 'LSHIFT', Control: 'LCTRL', Alt: 'LALT', Tab: 'TAB', Escape: '', Backspace: '' }
  if (e.key in map) return map[e.key]
  return e.key.length === 1 ? e.key.toUpperCase() : e.key.toUpperCase()
}

export function PersonalProfilePage({ onToast, pressedKeys, pressedButtons }: { onToast: (m: string) => void; pressedKeys: Set<string>; pressedButtons: Set<string> }) {
  const [catalogs, setCatalogs] = useState<Record<Mode, CatalogActionX[]>>({ keyboard: [], mouse: [] })
  const [profiles, setProfiles] = useState<PersonalProfile[]>([])
  const [mode, setMode] = useState<Mode>('keyboard')
  const [draft, setDraft] = useState<PersonalProfile | null>(null)
  const [selected, setSelected] = useState<string>('')
  const [capturing, setCapturing] = useState<string | null>(null)

  const refresh = async (selectId?: string, m: Mode = mode) => {
    const r = await v2<{ profiles: PersonalProfile[]; catalog: CatalogActionX[]; mouseCatalog: CatalogActionX[] }>('profiles.list')
    if (!r.profiles) { onToast(r.message || '读取个人方案失败'); return }
    setProfiles(r.profiles); setCatalogs({ keyboard: r.catalog, mouse: r.mouseCatalog })
    const inMode = r.profiles.filter((p) => p.movementMode === m)
    const pick = inMode.find((p) => p.id === (selectId ?? draft?.id)) || inMode[0]
    setDraft(pick ? JSON.parse(JSON.stringify(pick)) : null)
  }
  useEffect(() => {
    // one-time (idempotent) migration of the old 按键配置 presets into personal profiles
    const seeds = profileSeeds.map((p) => ({ id: p.id, name: p.name, category: p.category, bindings: p.bindings.map((b) => ({ id: b.id, key: b.key })) }))
    void v2<{ created: Array<{ name: string }> }>('profiles.migrate', { seeds }).then((r) => {
      if (r.created?.length) onToast(`已把 ${r.created.length} 个旧预设迁移为个人方案`)
      void refresh()
    }).catch(() => void refresh())
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const catalog = catalogs[mode]
  const groups = useMemo(() => {
    const g: Record<string, CatalogActionX[]> = {}
    for (const a of catalog) (g[a.group] ||= []).push(a)
    return g
  }, [catalog])

  const conflicts = useMemo(() => {
    const seen: Record<string, string[]> = {}
    if (draft) for (const [id, k] of Object.entries(draft.bindings)) if (k && catalog.some((c) => c.id === id)) (seen[k] ||= []).push(id)
    const bad = Object.entries(seen).filter(([, l]) => l.length > 1)
    return { ids: new Set(bad.flatMap(([, l]) => l)), keys: new Set(bad.map(([k]) => v2ToGrid(k))) }
  }, [draft, catalog])

  const mapBindings: MapBinding[] = useMemo(() => !draft ? [] : catalog.map((a) => ({ id: a.id, label: a.label.replace(/^鼠标[左右]键：/, ''), key: v2ToGrid(draft.bindings[a.id] || '') })).filter((b) => b.key), [draft, catalog])

  const switchMode = (m: Mode) => { setMode(m); setSelected(''); void refresh('', m) }
  const setKey = (id: string, key: string) => draft && setDraft({ ...draft, bindings: { ...draft.bindings, [id]: key } })
  const isFixed = (id: string) => !!catalog.find((a) => a.id === id)?.fixedMouse
  const assignFromMap = (gridKey: string) => {
    if (!draft) return
    if (!selected) { onToast('先在左侧动作列表选中一个动作，再点击键位绑定'); return }
    if (isFixed(selected)) { onToast('鼠标移动/攻击固定为右键/左键'); return }
    setKey(selected, gridToV2(gridKey))
  }
  const clearFromMap = (gridKey: string) => {
    if (!draft) return
    const v = gridToV2(gridKey); const b = { ...draft.bindings }
    for (const [id, k] of Object.entries(b)) if (k === v && !isFixed(id)) b[id] = ''
    setDraft({ ...draft, bindings: b })
  }
  const save = async () => {
    if (!draft) return
    const r = await v2<{ profile: PersonalProfile }>('profiles.save', { ...draft, id: draft.builtin ? undefined : draft.id })
    if (r.success) { onToast(`已保存方案「${r.profile.name}」`); void refresh(r.profile.id) } else onToast(r.message || '保存失败')
  }
  const remove = async () => {
    if (!draft) return
    if (draft.builtin) { onToast('内置方案不能删除，可另存为新方案后修改'); return }
    const r = await v2('profiles.delete', { id: draft.id })
    if (r.success) { onToast('已删除'); void refresh('') } else onToast(r.message || '删除失败')
  }
  const newProfile = () => {
    const b: Record<string, string> = {}
    for (const a of catalog) b[a.id] = a.wasdDefault
    setDraft({ id: '', name: mode === 'mouse' ? '新的点击移动方案' : '新的键盘方案', movementMode: mode, bindings: b })
  }
  const duplicate = () => draft && setDraft({ ...draft, id: '', builtin: false, name: `${draft.name} 副本` })
  const list = profiles.filter((p) => p.movementMode === mode)

  return (
    <section className="v2-page">
      <div className="v2-cat-tabs">
        {(['keyboard', 'mouse'] as Mode[]).map((m) => (
          <button key={m} className={`v2-cat-tab ${mode === m ? 'is-active' : ''}`} onClick={() => switchMode(m)}>
            {m === 'mouse' ? <Mouse size={15} /> : <Keyboard size={15} />} {CATEGORY_LABEL[m]} <span className="v2-muted">({profiles.filter((p) => p.movementMode === m).length})</span>
          </button>
        ))}
      </div>
      <div className="v2-profile-layout">
        <aside className="v2-profile-list">
          {list.map((p) => (
            <button key={p.id} className={`v2-profile-item ${draft?.id === p.id ? 'is-active' : ''}`} onClick={() => { setDraft(JSON.parse(JSON.stringify(p))); setSelected('') }}>
              <span>{p.name}</span>{p.builtin && <em className="v2-chip info">内置</em>}
            </button>
          ))}
          <button className="secondary-button" onClick={newProfile}><Plus size={14} /> 在「{CATEGORY_LABEL[mode]}」新建</button>
        </aside>
        {draft ? (
          <div className="v2-profile-editor">
            <div className="v2-row">
              <input className="v2-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              <span className="v2-chip info">{CATEGORY_LABEL[draft.movementMode]}</span>
              <button className="primary-button" onClick={save}><Save size={14} /> {draft.builtin ? '另存为我的方案' : '保存'}</button>
              <button className="secondary-button" onClick={duplicate}><Copy size={14} /> 复制</button>
              <button className="secondary-button" onClick={remove}><Trash2 size={14} /> 删除</button>
            </div>
            {draft.note && <p className="v2-muted">{draft.note}</p>}
            {conflicts.ids.size > 0 && <p className="v2-chip warn">有按键冲突：{[...conflicts.keys].join('、')}（已标红）</p>}
            <div className="v2-profile-split">
              <div className="v2-action-list">
                {Object.entries(groups).map(([g, acts]) => (
                  <div key={g} className="v2-group">
                    <h3>{GROUP_LABEL[g] ?? g}</h3>
                    {acts.map((a) => (
                      <div key={a.id} className={`v2-bind-row ${conflicts.ids.has(a.id) ? 'is-conflict' : ''} ${selected === a.id ? 'is-selected' : ''}`} onClick={() => setSelected(a.id)}>
                        <span>{a.label}</span>
                        {a.fixedMouse ? <span className="v2-key fixed">{v2ToGrid(draft.bindings[a.id] || '')}</span> : (
                          <button className={`v2-key ${capturing === a.id ? 'is-capturing' : ''}`} onClick={(e) => { e.stopPropagation(); setSelected(a.id); setCapturing(a.id) }}
                            onKeyDown={(e) => { if (capturing !== a.id) return; e.preventDefault(); const k = normalizeKey(e); setKey(a.id, k); setCapturing(null) }}
                            onBlur={() => setCapturing(null)}>
                            {capturing === a.id ? '按下按键…' : (draft.bindings[a.id] || '未绑定')}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <div className="v2-visual">
                <p className="v2-muted">{selected ? `点击键位绑定到「${catalog.find((a) => a.id === selected)?.label}」，右键键位清除` : '选中一个动作后点击键位绑定'}</p>
                <KeyboardMap full104 bindings={mapBindings} selectedActionId={selected} onAssign={assignFromMap} pressedKeys={pressedKeys} conflictKeys={conflicts.keys} />
                <MouseMap bindings={mapBindings} selectedActionId={selected} onAssign={assignFromMap} onClearBinding={clearFromMap} pressedButtons={pressedButtons} />
              </div>
            </div>
          </div>
        ) : <p className="v2-muted">此分类下还没有方案，点击左侧新建。</p>}
      </div>
    </section>
  )
}
