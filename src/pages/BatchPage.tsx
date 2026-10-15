import { useEffect, useMemo, useState } from 'react'
import { Play, RefreshCw, Eye, Wand2, ShieldAlert } from 'lucide-react'
import { v2, STATUS_LABEL, type PersonalProfile, type PlanResult, type V2Game } from '../lib/v2api'

type Mode = 'esdf' | 'profile'
type ApplyResult = { success?: boolean; message?: string; blocked?: boolean; needsConfirm?: boolean; unknown?: string[]; afterWrite?: string | null; stub?: boolean }

export function BatchPage({ onToast }: { onToast: (m: string) => void }) {
  const [games, setGames] = useState<V2Game[]>([])
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState<Mode>('esdf')
  const [profiles, setProfiles] = useState<PersonalProfile[]>([])
  const [profileId, setProfileId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [plans, setPlans] = useState<Record<string, PlanResult>>({})
  const [results, setResults] = useState<Record<string, ApplyResult>>({})
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [g, p] = await Promise.all([v2<{ games: V2Game[] }>('games'), v2<{ profiles: PersonalProfile[] }>('profiles.list')])
      if (g.games) setGames(g.games); else onToast(g.message || '扫描失败')
      if (p.profiles) { setProfiles(p.profiles); if (!profileId && p.profiles[0]) setProfileId(p.profiles[0].id) }
    } finally { setLoading(false) }
  }
  useEffect(() => { void load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n) }
  const profile = useMemo(() => profiles.find((p) => p.id === profileId) || null, [profiles, profileId])

  const preview = async () => {
    if (!selected.size) { onToast('先勾选游戏'); return }
    setBusy(true)
    try {
      const r = await v2<{ results: PlanResult[] }>('plan', { mode, profileId, gameIds: [...selected] })
      if (!r.results) { onToast(r.message || '预览失败'); return }
      setPlans(Object.fromEntries(r.results.map((x) => [x.gameId, x])))
    } finally { setBusy(false) }
  }

  const apply = async () => {
    if (!selected.size) { onToast('先勾选游戏'); return }
    setBusy(true)
    const out: Record<string, ApplyResult> = { ...results }
    try {
      for (const gid of selected) {
        const g = games.find((x) => x.gameId === gid)
        if (g?.requirements.unsupported) { out[gid] = { success: false, blocked: true, message: '反作弊：不支持' }; continue }
        out[gid] = await v2<ApplyResult>('apply', { mode, profileId, gameId: gid, confirmUnknown: confirmed.has(gid) })
        setResults({ ...out })
      }
    } finally { setBusy(false) }
    void load()
  }

  const launch = async (gid: string) => {
    const r = await v2('launch', { gameId: gid })
    onToast(r.message || (r.success ? '已启动' : '启动失败'))
  }

  return (
    <section className="v2-page">
      <div className="v2-card">
        <div className="v2-field">迁移方式
          <div className="v2-seg">
            <button className={mode === 'esdf' ? 'is-active' : ''} onClick={() => { setMode('esdf'); setPlans({}) }}>WASD 整体平移 ESDF</button>
            <button className={mode === 'profile' ? 'is-active' : ''} onClick={() => { setMode('profile'); setPlans({}) }}>应用我的个人方案</button>
          </div>
          {mode === 'profile' && (
            <select className="profile-select" value={profileId} onChange={(e) => { setProfileId(e.target.value); setPlans({}) }}>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.movementMode === 'mouse' ? '鼠标点击移动' : '键盘移动'}</option>)}
            </select>
          )}
        </div>
        <p className="v2-muted">
          {mode === 'esdf'
            ? '把每款游戏里 WASD 一侧的字母键整体右移一列（Q→W、W→E…），复用已验证的配置/Input.ini 策略。补丁 pak、UE4SS、Unity 补丁等高级策略仍在「按键配置」页的策略面板里单独确认。'
            : profile?.movementMode === 'mouse'
              ? '点击移动方案：英雄联盟切到点击移动并改技能键；其他游戏只应用技能类动作。'
              : '键盘方案：按语义把你的动作映射到每款游戏的原生动作；未识别的动作需要勾选确认。'}
        </p>
        <div className="v2-toolbar">
          <button className="subtle-button v2-btn" onClick={load} disabled={loading}><RefreshCw size={14} />{loading ? '扫描中…' : '重新扫描'}</button>
          <button className="subtle-button v2-btn" onClick={() => setSelected(new Set(games.filter((g) => !g.requirements.unsupported).map((g) => g.gameId)))}>全选可用</button>
          <button className="subtle-button v2-btn" onClick={() => setSelected(new Set())}>清空</button>
          <button className="subtle-button v2-btn" onClick={preview} disabled={busy}><Eye size={14} />预览</button>
          <button className="command-button" onClick={apply} disabled={busy}><Wand2 size={15} />写入所选</button>
        </div>
      </div>

      <div className="v2-games">
        {games.map((g) => {
          const plan = plans[g.gameId]; const res = results[g.gameId]
          return (
            <div key={g.gameId} className={`v2-game ${g.requirements.unsupported ? 'is-unsupported' : ''}`}>
              <div className="v2-game-head">
                <label className="v2-check">
                  <input type="checkbox" checked={selected.has(g.gameId)} disabled={g.requirements.unsupported} onChange={() => toggle(g.gameId)} />
                  <span className="v2-game-name">{g.name}</span>
                </label>
                <span className="v2-tag">{g.engineType || '其他'}</span>
                <span className="v2-tag">{g.strategyLabel}</span>
                {g.status && <span className={`v2-tag v2-status-${g.status}`}>{STATUS_LABEL[g.status]}</span>}
                <span className="v2-spacer" />
                <button className="subtle-button v2-btn" onClick={() => launch(g.gameId)} disabled={g.launch.type === 'none'} title={g.launch.label}><Play size={13} />启动</button>
              </div>
              <div className="v2-chips">
                {g.requirements.chips.map((c, i) => <span key={i} className={`v2-chip v2-chip-${c.level}`}>{c.level === 'block' && <ShieldAlert size={12} />}{c.text}</span>)}
                {g.skippedIneffective.length > 0 && <span className="v2-chip v2-chip-info">已跳过无效策略：{g.skippedIneffective.join('、')}</span>}
              </div>
              {plan && (
                <div className="v2-plan">
                  <div className={plan.ok ? 'v2-ok' : 'v2-muted'}>{plan.message}</div>
                  {plan.changes && plan.changes.length > 0 && <div className="v2-mono">{plan.changes.slice(0, 16).join('　')}{plan.changes.length > 16 ? ' …' : ''}</div>}
                  {plan.mapping && (
                    <>
                      {plan.mapping.notes.map((n, i) => <div key={i} className="v2-muted">{n}</div>)}
                      {plan.mapping.mapped.length > 0 && <div className="v2-mono">{plan.mapping.mapped.slice(0, 24).map((m) => `${m.native}=${m.key}`).join('　')}</div>}
                      {plan.mapping.collisions.length > 0 && <div className="v2-warn">键位冲突：{plan.mapping.collisions.map((c) => `${c.key}（${c.actions.join('/')}）`).join('，')}</div>}
                      {plan.mapping.unknown.length > 0 && (
                        <label className="v2-warn">
                          <input type="checkbox" checked={confirmed.has(g.gameId)} onChange={() => { const n = new Set(confirmed); if (n.has(g.gameId)) n.delete(g.gameId); else n.add(g.gameId); setConfirmed(n) }} />
                          未识别的游戏动作（保持原样）：{plan.mapping.unknown.slice(0, 12).join('、')} —— 勾选表示确认
                        </label>
                      )}
                    </>
                  )}
                </div>
              )}
              {res && (
                <div className={res.success ? 'v2-ok' : 'v2-warn'}>
                  {res.success ? '✓ ' : res.blocked ? '⛔ ' : '✗ '}{res.message || (res.success ? '已写入' : '失败')}
                  {res.success && res.afterWrite && <> · {res.afterWrite} <button className="subtle-button v2-btn" onClick={() => launch(g.gameId)}><Play size={12} />现在启动</button></>}
                </div>
              )}
            </div>
          )
        })}
        {!games.length && !loading && <p className="v2-muted">没有检测到游戏。</p>}
      </div>
    </section>
  )
}
