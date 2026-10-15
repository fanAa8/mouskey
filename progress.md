# Progress Log

## Session: 2026-09-29（规划对齐 · plan-with-files）

### 目标
读取 `HANDOFF.md` + 项目目录，用 planning-with-files 定全目标实现计划，并列出所需优化。

### Actions taken
- 运行 session-catchup：无未同步上下文输出。
- 读 `HANDOFF.md`（2026-09-08）：产品已演进为 Electron「MousKey」，远超旧规划文件中的 Keyforge 网页原型阶段。
- 读旧 `task_plan.md` / `findings.md` / `progress.md`：停在 2026-09-04 LoL LCU 写入，未覆盖 Electron、悬浮窗、Battlerite、ESDF 迁移、多写入策略等。
- 核对 git：仅 1 commit（`2e1d5ee`），大量改动未提交；`electron/api-handlers.cjs` 为 untracked。
- 核对源码规模：`App.tsx` ~138KB，`api-handlers.cjs` ~126KB，`vite.config.ts` ~95KB。
- 实读 `electron/api-handlers.cjs` 写入分支（1686-1805）与 `toNativeKey`（1751-1766）：
  - 字母键大写修复**已在源码**（`k.${upper}`），HANDOFF 问题4 的「疑似仍有小写」不成立。
  - JSON 分支已是 read-modify-write + backup；缺 post-write 校验、原子写入、结构化 API。
- 实读 `C:\Users\Administrator\AppData\Roaming\Battlerite\KMInput.json`（373B）：
  - 结构为 `Action → ["k.X"]`，字母键大写，当前已是 ESDF。
  - 含空数组值；键集可能被裁剪，保留策略必须以 merge 为准。
- 发现双端写入逻辑三处并存（formatters / api-handlers / vite.config），nativeNames 方向事故已证明会漂移。
- 全量重写 `task_plan.md`（G1-G11 目标缺口 + Phase 0-5）。
- 全量重写 `findings.md`（写入链路核查 + 代码健康 + 禁重试清单）。
- 本文件登记会话。

### Files created/modified
- `task_plan.md`（重写）
- `findings.md`（重写）
- `progress.md`（本文件）

### 尚未做（留给执行阶段）
- Battlerite 离线写入回归与进游戏实测（Phase 0）
- 结构化写入 API / 共享 merge 模块（Phase 1）
- Source/Unity 通用适配、一键全游戏（Phase 2-3）
- 巨石拆分、死依赖清理、Git 提交（Phase 4）

---

## Session: 2026-09-04 — LoL cloud write correction and mode validation

- Restored LoL as write-capable via running-client LCU API + account/cloud sync.
- `/api/adapters/write`: LCU first, fallback to local `PersistedSettings.json`/`input.ini` when present.
- Added `modeId` so traditional vs WASD profiles select the correct native section.
- WASD preview filters to verified events only (`MoveUp`, `CastSpell1`, …); traditional names corrected from observed local file.
- Verification: `npm run build` pass; lint warnings only; LCU GET HTTP 200 / 6343 bytes.

## Session: 2026-09-03 (Preset-First Refactor)

- Refactored product from "read-first" to "preset-first".
- Created `src/adapters/` (types, games, patchGenerator, formatters, index).
- `generatePatchSet()` pure function; native formatters for CS2/CF/饥荒/LoL.
- Backend detect/write endpoints with timestamped backup; CS2 autoexec hook.
- Verification: build pass; browser 0 console errors; CS2/LoL flows OK.

## Session: 2026-09-02

- Scaffolded React+Vite+TS prototype; two-column workspace; flexible keyboard rows.
- Native LoL reader + missing-file honesty; Documents known-folder redirect discovery.
- Save monitor: 63 events → only LeagueClientSettings.yaml (not a keybind store).
- Mobile containment fix; final console 0 errors 0 warnings.

## Test Results（历史累计，最新在上）

| Test | Result |
|------|--------|
| 规划文件与 HANDOFF 对齐（2026-09-29） | Pass |
| toNativeKey 字母键大写源码核验 | Pass（已在源码，待进游戏） |
| KMInput.json 实机结构取证 | Pass |
| Battlerite 进游戏写入生效 | **Open** |
| JSON merge 保留非目标键（离线回归） | **Open** |
| Production build / lint | 历史 Pass，本轮未重跑 |
| LoL LCU read-only GET | Pass (2026-09-04) |
| Mobile containment | Pass |
| Second in-game LoL keybind save (monitor) | Pass (negative finding) |

## Error Log（历史）

| Timestamp | Error | Resolution |
|-----------|-------|------------|
| 2026-09-29 | 旧规划与 HANDOFF 脱节 4 天 | 全量重写三件套 |
| 2026-09-29 | 差点误改 toNativeKey（尾行 toLowerCase） | 实读分支后记录，不改 |
| 2026-09-02 | TS2882 styles.css import | vite-env.d.ts |
| 2026-09-02 | Playwright 空白 tab | 开新 tab |
| 2026-09-02 | ClientConfiguration 全盘关键词扫描 | 改为定向文件名发现 |
| 2026-09-02 | 根目录扫描 PowerShell 管道解析错误 | 先收集再格式化 |

## 5-Question Reboot Check

| Question | Answer |
|----------|--------|
| Where am I? | 规划会话完成；执行从 Phase 0（Battlerite 闭环）开始 |
| Where am I going? | Phase 0→1 证明并加固写入，再扩适配器与一键应用 |
| What's the goal? | 一次 ESDF 设置，真改配置文件，覆盖所有支持游戏 |
| What have I learned? | findings.md（含写入链路核查） |
| What have I done? | 对齐 HANDOFF，重写规划三件套 |
