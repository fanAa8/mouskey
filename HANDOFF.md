# Keyforge 项目交接说明

更新时间：2026-09-03（重构后）

## 一句话定位

Keyforge 是一个 Windows 本地优先的游戏操作方案工具：玩家维护自己习惯的一套键盘和鼠标方案，工具按游戏类型和目标游戏的原生配置格式生成修改，并在确认后写入游戏本地配置文件。

## 产品目标（以最新需求为准）

读取游戏当前键位不是前置条件。用户可以直接选择自己的预设方案，再套用到目标游戏。

预设方向包括：

- MOBA：移动、技能、召唤师技能、鼠标操作等。
- FPS：WASD、射击、瞄准、换枪、装弹、跳跃、语音等。
- 普通小游戏：方向、确认、取消、交互等。
- RPG / 生存：移动、攻击、技能、交互、物品栏、地图等。

核心流程：

1. 选择或编辑个人方案。
2. 选择目标游戏。
3. 根据该游戏的原生配置适配器生成变更预览。
4. 写入前自动创建恢复点/备份。
5. 用户确认后修改目标游戏自己的配置文件。

读取游戏原键位是可选增强：用于展示当前设置、比较差异、识别已有方案，而不是阻塞用户生成自己的方案。

## 当前已经完成（2026-09-03 重构后）

### 产品主流程
- **预设方案优先已实现**：所有游戏的变更集均从用户自己的预设方案生成，不再要求先读取游戏当前键位。
- LoL 读取本机设置已降级为可选功能，界面明确标注"读取本机设置（可选）"，不阻塞变更集生成。
- 腾讯/WeGame 版 LoL 明确标记为"暂不支持自动写入"，并显示详细原因（未发现可信热键文件），用户仍可导出配置文件。

### 适配器架构
- 已建立独立的 `src/adapters/` 模块，将游戏定义、补丁生成、原生格式格式化从 UI 代码中分离。
- 每个游戏适配器包含：原生字段名映射、默认键位、写入能力标记、原生配置文件格式化器。
- 支持的游戏：英雄联盟（仅预览/导出）、CS2（可写入）、穿越火线（可写入）、饥荒（可写入）。

### 原生配置生成
- CS2：生成标准 Source 引擎 `bind "key" "command"` 格式，输出 `keyforge.cfg`。
- CF：生成 `KeySettings.ini` 格式。
- 饥荒：生成 `settings.ini` `[controls]` 段格式。
- LoL：生成国际版 `Input.ini` `[GameEvents]` 格式（仅预览，腾讯版不写入）。
- 界面可展开查看完整原生配置文本，并支持一键导出为文件。

### 安全写入（后端）
- Vite 本地中间件新增 `/api/adapters/detect` 接口：自动检测 Steam 安装路径、CS2 userdata 目录、CF 和饥荒配置目录。
- 新增 `/api/adapters/write` 接口：写入前自动创建带时间戳的备份（`keyforge_backups/` 目录），写入失败不破坏原文件。
- CS2 写入时自动检测 `autoexec.cfg`，若存在则追加 `exec keyforge.cfg`（同样先备份）。
- 写入成功后自动创建恢复点记录。

### 界面
- 原生适配器面板新增"写入能力"字段（支持自动写入 / 暂不支持自动写入）。
- 不支持写入的游戏显示黄色警告框，说明具体原因。
- 变更预览显示动作标签、原生字段名、预设值三列，变更项高亮。
- 底部操作按钮：可写入游戏显示"生成变更集"+"安全写入配置"；不可写入游戏显示"生成变更集"+"导出配置文件"。
- 默认目标游戏改为 CS2（可写入的游戏），而非 LoL。

### 原有功能保留
- React/Vite/TypeScript 页面原型、个人方案列表、动作分类、连续键盘布局、鼠标可视化、按键冲突交换、恢复点界面。
- LoL 本地配置读取接口、保存位置监测接口均保留为可选增强功能。
- 已通过 `npm run build` 生产构建，浏览器检查无控制台错误。

## 当前 LoL 调查结论

代码曾按国际版/标准目录尝试读取 `Game.cfg` 和 `Input.ini`，并已根据 Windows 实际文档目录修正路径发现：

- Riot/WeGame 安装根目录：`D:\WeGameApps\英雄联盟\LeagueClient`
- Windows 当前"文档"真实路径：`D:\Users\Downloads\Programs\Documents`
- 重定向后的 LoL 文档目录：`D:\Users\Downloads\Programs\Documents\League of Legends`
- 安装目录内更新过的文件：`D:\WeGameApps\英雄联盟\LeagueClient\Config\LeagueClientSettings.yaml`

两次真实保存热键的监测结果：

- 只捕捉到 `LeagueClientSettings.yaml` 的写入/重命名。
- 没有发现 `Game.cfg`、`Input.ini` 或其他可验证的本地热键文件。
- `LeagueClientSettings.yaml` 不含 key/hotkey/binding/input/WASD 等字段。
- `HKCU\Software\Tencent\LOL` 目前只保存安装路径。

因此，腾讯/WeGame 版 LoL 不应把客户端偏好 YAML 当作键位文件，但英雄联盟仍然支持通过正在运行的客户端 LCU 接口写入并同步到云端。代码优先走 LCU，只有发现已验证的 `PersistedSettings.json`/`input.ini` 时才做本地备份和兼容写入；读取现有配置仍是可选增强，预设生成不被读取状态阻塞。

## 关键文件地址

项目根目录：

`C:\Users\Administrator\Documents\Codex\2026-09-02\1-2-github`

核心代码：

- `src/App.tsx` — 页面、个人方案、动作模型、键盘/鼠标交互、游戏选择、预览、原生配置文本、写入触发。已重构为预设优先。
- `src/styles.css` — 全部页面样式、两栏布局、连续键盘布局、移动端滚动约束、原生适配器面板样式。
- `src/adapters/types.ts` — 共享类型定义（ActionId、ControlAction、Profile、GameDefinition、PatchSet、RestorePoint、LolReadResult、LolWatchResult 等）。
- `src/adapters/games.ts` — 游戏定义（原生字段映射、默认键位、写入能力标记）、预设方案种子、动作模板。
- `src/adapters/patchGenerator.ts` — 从用户预设生成补丁集（核心预设优先逻辑）、键名规范化。
- `src/adapters/formatters.ts` — 各游戏原生配置文件格式化器（CS2 bind、CF INI、饥荒 INI、LoL Input.ini/LCU 区段）。
- `src/adapters/index.ts` — 模块统一导出。
- `vite.config.ts` — Vite 本地接口：
  - `GET /api/adapters/detect?gameId=xxx`：检测游戏安装和配置目录。
  - `POST /api/adapters/write`：写入原生配置（自动备份）。
  - `GET /api/adapters/lol/read`：读取候选 LoL 原生配置（可选功能）。
  - `POST /api/adapters/lol/watch/start`：开始监测已知本地目录。
  - `GET /api/adapters/lol/watch/status`：查看监测事件。
- `src/main.tsx` — React 入口。
- `src/vite-env.d.ts` — Vite 类型声明。
- `index.html` — 页面入口和内联 favicon。

项目配置：

- `package.json`、`package-lock.json`、`tsconfig.json`

规划和研究记录：

- `task_plan.md`、`findings.md`、`progress.md`

诊断/临时文件：

- `work/watch-lol-settings.ps1`、`work/lol-write-events.jsonl`、`work/vite-4174.stdout.log`、`work/vite-4174.stderr.log`

构建产物：

- `dist/`

## 如何运行

在项目根目录执行：

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 4174 --strictPort
```

浏览器打开：

`http://127.0.0.1:4174/`

生产构建：

```powershell
npm run build
```

## 下一阶段建议

1. **已完成**：产品主流程改为"预设方案 -> 目标游戏 -> 原生写入"，不再要求先读取 LoL 当前键位。
2. **已完成**：为每种游戏建立独立 adapter（安装检测、配置文件定位、备份、生成补丁、写入）。读取和恢复可后续补充。
3. LoL 适配器可增加"手动指定配置目录/导入配置文件"功能，支持国际版已验证目录的写入。
4. **已完成**：腾讯/WeGame LoL 不解析 `LeagueClientSettings.yaml` 作为键位；写入优先通过 LCU 云端同步，本地原生文件仅在真实存在时兼容写入。
5. 把 Vite 本地接口迁移到 Tauri/Electron/Windows 原生层，正式版才能稳定访问和写入游戏文件。
6. 所有写入已实现：创建带时间戳的备份、展示差异、用户确认。可补充：检测游戏是否运行、失败可恢复的完整回滚流程。
7. 继续增加游戏适配器时，优先选择能确认本地配置格式的游戏，不做通用目录盲扫。
8. 恢复点目前是界面演示，可接入实际的备份文件列表和一键恢复功能。

## 重要边界

- 不做全局键盘/鼠标输入注入。
- 不修改正在运行进程的内存或行为。
- 不把客户端偏好、账号数据或遥测文件当成游戏键位。
- 不在没有确认原生格式时自动写入。
- 当前项目仍是原型，不是已打包的 Windows 桌面应用。
