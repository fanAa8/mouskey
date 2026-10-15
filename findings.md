# Findings & Decisions

> 对齐 HANDOFF（2026-09-08）。旧版 Research Findings 中 LoL 本地文件缺失的长排查已收敛，结论见「已收敛结论」。

## Product Requirements（不变）
- 一套个人操作习惯（核心 ESDF）跨多游戏生效。
- 预设是唯一真相源；读取游戏现键位是增强，不是门禁。
- 必须**真正修改游戏配置文件**，禁止运行时钩子映射。
- 写入前备份、可预览、可恢复。
- 游戏不说「不支持」，改说「可尝试通用写入」。
- UI 深色科技风，禁文字选择、禁窗口缩放。
- 回答结束打 1-10 信心度；数字/引用需可验证来源。

## 已收敛结论（LoL 早期排查）
- 国际服 LoL 以 `Game/Config/PersistedSettings.json` + `input.ini` 为本地热键源；本机 WeGame 路径为 `D:\WeGameApps\英雄联盟\Game\Config\`。
- 早期「找不到文件」根因之一：Windows Documents 重定向到 `D:\Users\Downloads\Programs\Documents`，不能拼 `USERPROFILE\Documents`。
- LeagueClientSettings.yaml **不是**热键配置（无 hotkey/input/wasd 字段），禁止当键盘配置解析。
- LoL 正确写入路径：优先 LCU API 云端同步，本地文件仅作备份/回退。

## 2026-09-08 写入链路核查（本次规划）

### Battlerite KMInput.json 实机结构（可验证）
路径：`C:\Users\Administrator\AppData\Roaming\Battlerite\KMInput.json`（373 bytes，2026-09-08 06:10:44）

```json
{
  "Ability4": ["k.W"],
  "Ability5": ["k.R"],
  "Ability6": ["k.T"],
  "Camera.Move.Y.Pos": [],
  "EX.Modifier": ["m.4"],
  "FallBackPing": [],
  "LimitBreak": ["k.G"],
  "Move.X.Neg": ["k.S"],
  "Move.X.Pos": ["k.F"],
  "Move.Y.Neg": ["k.D"],
  "Move.Y.Pos": ["k.E"]
}
```

要点：
- 扁平对象：`ActionName → [key, ...]`，键值形如 `k.X`（键盘）/ `m.N`（鼠标）/ `b.N`。
- 字母键**大写**（`k.S` 不是 `k.s`）——与游戏大小写敏感一致。
- 当前文件已是 ESDF（`Move.Y.Pos=k.E` / `Move.Y.Neg=k.D` / `Move.X.Neg=k.S` / `Move.X.Pos=k.F`）。
- 存在**空数组**值（`Camera.Move.Y.Pos: []`、`FallBackPing: []`），merge 时不得误伤。
- 当前文件键集合小于 HANDOFF 提到的「原始全量」（缺 UI.Misc、Ability1-3、Jump 等）——可能被裁剪过或本就部分绑定；**写入保留策略必须以「合并而非替换根对象」为准**。

### `toNativeKey` 大写修复核验
文件：`electron/api-handlers.cjs:1751-1766`

- 单字母键：`return \`k.${upper}\``（大写）——HANDOFF 问题4 修复**已在源码**。
- 尾行 `return upper.toLowerCase()` **仅**用于 Space/Tab 等非字母键，不是字母键回退。
- 结论：不要再按「仍返回小写」去改代码；缺的是**进游戏验证**，不是再改 toNativeKey。

### JSON 写入分支（read-modify-write）核验
文件：`electron/api-handlers.cjs:1686-1805`

已正确之处：
1. 优先使用调用方 `configPath`，避免写错到第二份安装。
2. `existsSync` → `JSON.parse` 读现有 → 合并 → 写回，根对象其他键保留。
3. 写前 `createBackup`。
4. 数组合并：`[newKey, ...existing.slice(1)]`，保留多键绑定的后续键。

风险点（需 Phase 1 加固）：
1. **仍用 `configText` 文本协议**（`nativeKey=presetValue` 逐行 `=` 解析）——格式脆弱，前后端隐式耦合。
2. `JSON.stringify(existing, null, 2)` 固定 2 空格缩进；与原文件风格不一致时无功能问题，但 diff 噪音大；换行符未与原文件对齐。
3. 无原子写入（直接 `writeFileSync` 目标文件），崩溃可能半截文件。
4. **无 post-write 读回校验**；「success: true」只表示写完，不表示内容正确。
5. 空数组 `[]` 会被写成 `[newKey]`（走 `Array.isArray` 分支）——对「清空绑定」语义需明确是否允许。

### 双实现漂移风险（已实锤发生过）
- 前端预览：`src/adapters/formatters.ts` + `patchGenerator.ts`
- 后端写入：`electron/api-handlers.cjs`（以及开发模式 `vite.config.ts` 内嵌逻辑）
- 已发生事故：nativeNames 方向反了（读取返回 native→normalized，GameDefinition 需要 normalized→native）。
- 结论：Phase 1 必须把 merge/格式化抽成**单一共享模块**，禁止三处各写一套。

### 代码健康（2026-09-08 快照）
| 项 | 观察 |
|----|------|
| `src/App.tsx` | ~138KB，单文件巨石 |
| `electron/api-handlers.cjs` | ~126KB / 3578 行，detect/read/write/backup 混杂 |
| `vite.config.ts` | ~95KB，内嵌大量 API 逻辑 |
| Git | 仅 1 个 commit；大量 modified/untracked 未提交（含 `electron/api-handlers.cjs`、`src/games/_engine-ue4.json` 等） |
| 死依赖 | `node-global-key-listener`、`uiohook-napi`（HANDOFF 已否定）；`electron-builder`（EPERM 已否定）仍在 package.json |
| 测试 | 有 `scripts/test-esdf-*.cjs` 一次性脚本，无正式测试框架与写入回归 |

### 已验证做不通（禁止重试）
- electron-builder 打包（EPERM，3 次失败）
- node-global-key-listener / uiohook-napi
- 腾讯 WeGame LoL 的 LeagueClientSettings.yaml 当热键源
- 饥荒 KLEI profile zlib
- Grounded 2 传统 UE4 Input.ini（Enhanced Input）
- 运行时键盘钩子映射（用户否决）

## Technical Decisions

| Decision | Rationale |
|---|---|
| React + Vite + TS + Electron | 已落地可运行；不换栈 |
| 标准化 ActionId + per-game nativeNames | 跨游戏翻译的唯一可扩展点 |
| Preset-first | 用户偏好是真相源 |
| 多写入策略标签 | 不同游戏可靠性不同，必须可视化 |
| 手动打包（Electron zip + resources/app） | electron-builder 走不通 |
| 生产 API 固定 4175 | Electron 内置 HTTP server；开发 4174 |

## Visual/Browser Findings（沿用）
- 双栏桌面布局 + 移动端键盘内滚已验收。
- 104 键布局经用户十多轮修正。
- 悬浮窗四模式 + 双主题已验收。

## Resources
- https://github.com/fanAa8/mouskey （远程仓库）
- https://github.com/mtkennerly/ludusavi （游戏清单来源）
- `src/data/keybind-knowledge.json`（适配器知识库）
- `src/data/ludusavi-games.json`（9442 游戏）

## Issues Encountered
| Issue | Resolution |
|-------|------------|
| 规划文件与 HANDOFF 脱节（差 4 天演进） | 本次全量重写 task_plan / findings / progress |
| 误读 toNativeKey 尾行 toLowerCase 为字母键 bug | 实读分支：字母键已大写；记录以免再改错 |
| KMInput.json 当前键集偏少 | 不假设「全量原始」；以文件实际键为准做保留测试 |
