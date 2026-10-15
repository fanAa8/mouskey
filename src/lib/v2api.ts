// MousKey v2 API client (shared dispatcher: POST /api/v2/<action>)
export const V2_BASE = import.meta.env.DEV ? '' : 'http://127.0.0.1:4175'

export type Chip = { level: 'block' | 'warn' | 'info'; text: string }
export type Requirements = {
  chips: Chip[]; needsClientRunning: boolean; mustNotBeInMatch: boolean; mustBeClosed: boolean
  restartAfterWrite: boolean; unsupported: boolean; cloudSync: string | null
}
export type LaunchInfo = { type: 'url' | 'exe' | 'none'; target?: string; label: string }
export type V2Game = {
  gameId: string; name: string; engineType: string | null; steamAppId: string | null; installPath: string | null
  configPath: string | null; configFileName: string | null; antiCheat: string[]
  status: 'written' | 'verified-in-game' | 'ineffective' | null
  history: Array<{ plan: string; status: string; at?: string }>
  strategy: string | null; strategyLabel: string; strategyCandidates: string[]; skippedIneffective: string[]
  requirements: Requirements; launch: LaunchInfo; adapter: string; gameProcess: string | null
}
export type CatalogAction = { group: string; id: string; label: string; wasdDefault: string; movement: boolean }
export type PersonalProfile = { id: string; name: string; movementMode: 'keyboard' | 'mouse'; bindings: Record<string, string>; builtin?: boolean; note?: string }
export type MappingRow = { canonical: string; native: string; key: string; value: string }
export type PlanResult = {
  gameId: string; name?: string; ok: boolean; blocked?: boolean; mode?: string; strategy?: string | null
  changes?: string[]; message?: string; implemented?: boolean
  mapping?: { adapter: string; mapped: MappingRow[]; unknown: string[]; skipped: Array<{ canonical: string; reason: string }>; collisions: Array<{ key: string; actions: string[] }>; movementMode: string | null; notes: string[] }
}

export async function v2<T = Record<string, unknown>>(action: string, body: Record<string, unknown> = {}): Promise<T & { success?: boolean; message?: string }> {
  const r = await fetch(`${V2_BASE}/api/v2/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' })
  return r.json()
}

export const STATUS_LABEL: Record<string, string> = { 'verified-in-game': '游戏内已验证', written: '已写入待验证', ineffective: '无效', restored: '已恢复原始配置' }
export type CatalogActionX = CatalogAction & { fixedMouse?: boolean }
export const CATEGORY_LABEL = { keyboard: 'WASD 键盘移动类', mouse: '鼠标点击移动类' } as const
