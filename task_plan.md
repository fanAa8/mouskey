# Task Plan: MousKey 全目标实现与优化路线

> 本文件取代 2026-09-02~04 的旧计划（当时还是 Keyforge 网页原型）。
> 现状以 `HANDOFF.md`（2026-09-08）为准。规划文件必须与 HANDOFF 同步更新。

## Goal（产品目标）

Windows 本地游戏键位管理工具 **MousKey**：一次设置 ESDF 布局，真正修改游戏配置文件（非钩子拦截），一键应用到所有支持的游戏。

### 全目标清单（来自 HANDOFF「主要功能」+「下一步」）

| # | 目标 | 当前状态 | 缺口 |
|---|------|----------|------|
| G1 | 键位配置页（预设/冲突交换/键盘鼠标可视化） | ✅ 可用 | App.tsx 过大，维护成本高 |
| G2 | 游戏自动检测（Steam + Ludusavi 9442） | ✅ 可用 | 检测准确率与路径误判未量化 |
| G3 | 通用适配器（UE4 / Unity / Source） | 🟡 部分 | UE4 有；Source 无模板；Unity 仅 Battlerite 个案 |
| G4 | 多写入策略（高/中/低可靠性） | ✅ 架构有 | 策略选择 UI 与失败回退未闭环 |
| G5 | 读取游戏现有按键 | 🟡 部分 | LoL/Battlerite/UE4 可读；其他格式弱 |
| G6 | 整体右移 WASD→ESDF | ✅ 已实现 | 缺自动化回归测试 |
| G7 | 实时按键显示悬浮窗 | ✅ 可用 | 轮询 50ms，性能与游戏兼容未压测 |
| G8 | 预设管理（导入/导出/删除） | ✅ 可用 | — |
| G9 | 自动备份 + 恢复点 | ✅ 可用 | 写入后校验缺失 |
| G10 | 一键应用所有游戏 | ❌ 未做 | 产品最终目标 |
| G11 | Battlerite 等游戏写入真正生效 | 🔴 未闭环 | 最新大写键值修复未进游戏验证 |

## Current Phase

**Phase 0: 写入链路闭环验证（Battlerite 为样板）** — 阻塞 G11 与后续推广

---

## Phases

### Phase 0 — Battlerite 写入闭环验证（P0，阻塞项）
- [ ] 离线验证：读真实 `KMInput.json` → 模拟写入 → diff 确认（动作名 / 键值大小写 / 原配置保留）
- [ ] 确认 JSON read-modify-write 不丢 `EX.Modifier`、`UI.Misc`、`Ability*`、`FallBackPing` 等非目标键
- [ ] 写入后立即读回校验（后端增加 post-write verify）
- [ ] 游戏完全关闭 → 写入 → 重启游戏 → 实测键位
- [ ] 若仍不生效：定位游戏实际读取路径（游戏内改键后文件监视 / Steam 云 / 注册表）
- [ ] **Status:** not_started

### Phase 1 — 写入链路加固（P0/P1）
- [ ] 结构化写入 API：前端传 `patches: [{nativeKey, value}]`，停止用 `configText` 按 `=` 解析
- [ ] JSON / INI / CFG 写入统一走同一套 merge 逻辑（消除 vite 中间件与 electron 双实现漂移）
- [ ] 原子写入（临时文件 + rename），避免半截文件
- [ ] 编码约定固化：UTF-8 无 BOM、换行风格与原文件一致
- [ ] 写入前后自动备份 + 读回比对，失败自动回滚
- [ ] 补单测：`toNativeKey`、`migrateJsonKeys`、JSON merge、ESDF 迁移
- [ ] **Status:** not_started

### Phase 2 — 通用适配器扩展（P1，产品核心价值）
- [ ] Source 引擎通用适配：autoexec/cfg 检测 + 引擎模板（格式化器已有）
- [ ] Unity JSON 通用模板：从 Battlerite 抽象（k.X / m.X / b.X + Action→[keys]）
- [ ] UE4 Input.ini 自动检测回归（已有写入，补测试矩阵）
- [ ] 每个适配器：读 → 改 → 写 → 读回 四步验证脚本
- [ ] 适配器知识库扩充（`src/data/keybind-knowledge.json`）
- [ ] **Status:** not_started

### Phase 3 — 一键应用所有游戏（P1，最终目标）
- [ ] 批量应用：扫描已支持游戏 → 逐个生成 patch → 逐个写入
- [ ] 每游戏结果报告（成功/跳过/失败 + 备份路径）
- [ ] 可勾选范围 / 可排除列表
- [ ] 批量恢复（用恢复点一键回滚）
- [ ] **Status:** not_started

### Phase 4 — 工程化优化（P1/P2，支撑长期迭代）
- [ ] 拆分 `src/App.tsx`（~138KB）：按功能拆 hooks / components / pages
- [ ] 拆分 `electron/api-handlers.cjs`（~126KB）：detect / read / write / backup / overlay
- [ ] 共享写入核心：`src/lib` 纯函数 + electron 薄封装，前端预览与后端写入同源
- [ ] 清理死依赖：`node-global-key-listener`、`uiohook-napi`（已验证不可用）、`electron-builder`（已验证 EPERM）
- [ ] 固化手动打包脚本（HANDOFF 第六节 PowerShell 脚本化）
- [ ] Git 卫生：提交当前未推送改动；`work/`、测试输出勿入库
- [ ] `npm run lint` / `npm run build` 零错误；补 vitest/最小 node:test
- [ ] **Status:** not_started

### Phase 5 — 产品交付与内测（P2）
- [ ] 内测文档完善（`内测申请.md` 已有草稿）
- [ ] 写入可靠性标签（高/中/低）与「可尝试通用写入」文案对齐用户偏好
- [ ] 错误信息可执行（告诉用户下一步做什么）
- [ ] 悬浮窗性能与全屏游戏兼容性验证
- [ ] GitHub README 对齐最终产品（当前仍是 Keyforge 叙事）
- [ ] **Status:** not_started

---

## Key Questions

| # | 问题 | 结论 / 假设 |
|---|------|-------------|
| Q1 | 如何让一套偏好跨游戏有效？ | 标准化动作模型 + 每游戏 nativeNames 适配器 |
| Q2 | 为什么必须真改配置文件？ | 用户明确否决钩子映射；配置文件才可被游戏原生加载 |
| Q3 | Battlerite 写入不生效的最可能原因？ | 验证缺口：大小写修复未实测；次可能为路径/云同步/需重启 |
| Q4 | 为什么要先做 Phase 0？ | 写入「显示成功但游戏不认」会摧毁产品可信度，必须先闭环一个真实游戏 |
| Q5 | 双端 API（Vite 中间件 + Electron HTTP）风险？ | 逻辑漂移已发生过（nativeNames 方向反了）；Phase 1 必须合并 |

## Decisions Made

| Decision | Rationale |
|---|---|
| 真改配置文件，不做钩子 | 用户约束 #1；且钩子方案已被否决 |
| ESDF 是核心方案，QAZ 空出 | 用户约束 #2 |
| 只改源码版，精简版单向同步 | 用户约束 #3；避免双头修改 |
| 先闭环 Battlerite 再推广 Unity | 单点样板验证成本最低，成功后可模板化 |
| 写入必须 post-write verify | 「写入成功」≠「文件正确」≠「游戏认」 |
| 结构化 patch 传参取代 configText 文本协议 | 文本 `=` 解析易碎，前后端格式隐式耦合 |
| electron-builder / uiohook 等死路不回头 | HANDOFF 第七节已验证失败，避免重复踩坑 |

## Errors Encountered

| Error | Attempt | Resolution |
|-------|---------|------------|
| 旧规划文件停在 2026-09-04，与 HANDOFF 2026-09-08 脱节 | 1 | 本文件全量重写，以 HANDOFF 为现状基准 |
| `toNativeKey` 注释写「必须大写」但尾行 `toUpperCase().toLowerCase()` 易误读 | 1 | 实读代码：字母键走 `k.${upper}` 正确大写；`toLowerCase()` 仅用于 Space/Tab 等；写入 findings 以免误判 |
| 问题4「键值小写」修复写在 HANDOFF 但未进游戏验证 | 1 | 列为 Phase 0 必做，不标记完成 |

## Verification Gate（每阶段完成前必须过）

1. `npm run build` 通过
2. `npm run lint` 无 error
3. 目标游戏：读 → 写 → 读回 字节级/字段级比对通过
4. 至少一款真实游戏内键位生效（或明确记录负结果与下一步）
5. 更新 `progress.md` + 本文件勾选

---

## 5-Question Reboot Test

| Question | Answer |
|----------|--------|
| Where am I? | Phase 0 规划完成，待执行 Battlerite 闭环验证 |
| Where am I going? | Phase 0→1 先证明写入真实生效并加固，再扩适配器与一键应用 |
| What's the goal? | 一次 ESDF 设置，真改配置，覆盖所有支持游戏 |
| What have I learned? | 见 findings.md（写入链路、KMInput 结构、代码健康） |
| What have I done? | 对齐 HANDOFF，重写 task_plan，登记发现 |
