# MousKey

> 一次设置 ESDF，尽可能应用到所有游戏。真正修改游戏配置文件，不做运行时键盘映射拦截。

MousKey（原名 Keyforge）是一个 Windows 本地游戏键位管理工具。它的核心目标是：玩家维护一套自己的键位习惯，例如 ESDF 移动布局；MousKey 根据游戏的配置文件、引擎和格式，把方案写入游戏原生配置，让游戏内显示的键位和实际操作保持一致。

项目同时包含一个桌面实时按键悬浮窗，用于游戏操作检查、直播和录屏。

## 产品目标

MousKey 不是单纯的键盘映射器，也不是通过键盘钩子把 W 假装成 E。产品目标分为两个阶段：

### 当前阶段：WASD → ESDF 迁移

只解决最有价值、最通用的一件事：

- 默认 WASD 移动整体向右移动一格
- `W → E`：前进
- `A → S`：左移
- `S → D`：后退
- `D → F`：右移
- 其他主键区字母也按同样规则右移
- `Q/A/Z` 空出来，由玩家进入游戏后自行安排
- 数字键、鼠标键、Space、Shift、Ctrl、Alt 等不主动修改

这样即使 MousKey 还不知道某个游戏中每个键的具体功能，也能先完成大多数默认 WASD 游戏的基础迁移。

### 后续阶段：理解每个游戏的动作功能

后续会继续为各游戏建立动作语义映射，例如：

- 读取某个键对应的是前进、跳跃、交互、技能还是物品
- 将游戏现有键位转换为 MousKey 的通用动作模型
- 针对空出的 Q/A/Z 给出合理建议
- 支持更完整的自定义改键和跨游戏方案应用

这部分需要逐游戏、逐格式验证，不能仅依赖配置文件路径推断。

## 当前功能

### 键位配置中心

- 可视化 104 键键盘和鼠标布局
- 鼠标左键、右键、中键、侧键 1、侧键 2
- WASD / ESDF 方案切换
- 个人配置档和多套预设
- 点击键盘按键修改动作绑定
- 冲突键自动交换
- Q/A/Z 在 ESDF 模式下保留为空，交给玩家自行配置
- 预设保存、加载、导入、导出、删除
- 变更预览和恢复点记录

### 游戏扫描与配置迁移

- 扫描 Steam 库
- 使用 Ludusavi manifest 辅助发现配置目录
- UE4/UE5、Unity、Source/Source2、JSON、INI 等通用探测
- 写入前创建带时间戳的备份
- 支持单游戏写入
- 支持批量 ESDF 迁移工作台
- 批量工作台会先分析每款游戏并分类：
  - `WASD / 可右移`
  - `已是 ESDF`
  - `无法解析`
  - `无可迁移字母键`
- 已是 ESDF 的配置会跳过，避免重复迁移导致二次右移
- 批量迁移逐游戏独立处理，一款失败不会阻断其他游戏

### 支持的通用配置格式

| 格式 | 处理方式 | 当前可靠性 |
|---|---|---|
| UE4/UE5 传统 `Input.ini` | 修改 `AxisMappings` / `ActionMappings` 的 `Key=` 值 | 较高 |
| Source / Source2 `cfg` | 修改 `bind "w" "+forward"` 等命令 | 较高 |
| Battlerite 风格 JSON | 修改 `"k.W"` → `"k.E"`，保留原 JSON 其他字段 | 较高 |
| 通用 JSON | 尝试识别字符串、数组和常见 `key` 字段 | 中等 |
| 通用 INI | 修改明显的单字母键值，保留其他设置 | 中等 |
| UE5 Enhanced Input `.uasset` | 当前不直接修改二进制资产 | 暂不支持 |

### 已有专项适配器

当前源码中已有以下游戏/模板适配器：

- 英雄联盟
- CS2
- 穿越火线
- 饥荒
- 文明 6
- Grounded 2
- Battlerite 动态 JSON 识别
- UE4/UE5 传统 Input.ini 通用模板

已确认或重点验证的功能：

- 英雄联盟：LCU API / PersistedSettings.json 路径，部分环境支持云端同步
- 文明 6：`InputSettings.json` 读改写
- Battlerite：`%APPDATA%/Battlerite/KMInput.json` 读取和 JSON 保留式写入逻辑
- CS2：Source bind 配置生成

不同游戏、发行平台和版本可能使用不同配置路径。检测到游戏不等于已经验证写入生效，UI 应使用“可尝试通用写入”而不是直接承诺支持。

### 游戏键位知识库

文件：`src/data/keybind-knowledge.json`

知识库记录：

- 游戏名称和 Steam AppID
- 引擎和配置格式
- 常见 Windows 配置路径
- 键位字段提示
- 可能的修改方式
- ESDF 可行性等级
- 资料来源和置信度

主要资料来源：

- [PCGamingWiki](https://www.pcgamingwiki.com)：配置路径和游戏数据说明
- [Ludusavi Manifest](https://github.com/mtkennerly/ludusavi-manifest)：存档/配置路径底座
- 游戏社区资料和本机实测

Ludusavi 主要解决“配置可能在哪里”，不保证指出“哪一个字段是键位”。字段语义仍需按引擎和单游戏格式验证。

### 实时按键悬浮窗

- Windows API `GetAsyncKeyState` 轮询
- 约 50ms 更新一次按键状态
- 仅按键、游戏模式、全键盘、自定义区域等显示模式
- 键盘和鼠标状态独立显示
- 支持鼠标侧键
- 悬浮窗可移动、锁定、隐藏、调整大小
- 位置和显示配置持久化
- White / Black 两套键盘素材主题
- 透明度、缩放、高亮颜色、高亮透明度
- 系统托盘常驻
- 使用 Windows `screen-saver` 级别和原生 `HWND_TOPMOST` 尝试保持最前
- 无边框全屏/窗口化全屏通常可以显示在游戏上方
- 独占全屏由图形 API 控制，普通窗口无法保证覆盖；遇到这种情况应使用游戏的无边框全屏模式

## 技术栈

- 前端：React 18 + TypeScript
- 构建：Vite
- 桌面：Electron 44.1.1
- 原生调用：koffi + Windows API
- 样式：原生 CSS，深色科技风
- 游戏路径数据：Ludusavi manifest
- 配置写入：Electron 本地 HTTP API
- 开发 API：Vite middleware
- 生产 API：Electron 内置 HTTP server，默认端口 `4175`
- 开发前端：默认 `http://127.0.0.1:4174/`

## 目录结构

```text
.
├── electron/
│   ├── main.cjs                 # Electron 主进程、窗口、托盘、悬浮窗、输入监听、生产 API
│   ├── api-handlers.cjs         # 游戏检测、配置读写、备份、迁移、预设、LoL API
│   └── convert-helpers.cjs      # 相关转换辅助代码
├── src/
│   ├── App.tsx                  # 主界面和交互流程
│   ├── styles.css               # 全部前端样式
│   ├── adapters/
│   │   ├── types.ts             # GameDefinition、PatchSet、WriteStrategy 等类型
│   │   ├── games.ts              # 通用动作模型和预设方案
│   │   ├── patchGenerator.ts     # 通用动作 → 原生变更集
│   │   └── formatters.ts         # UE4、Source、INI、LoL 等格式化器
│   ├── games/                   # 专项游戏适配器 JSON
│   ├── lib/
│   │   ├── esdfMigration.ts      # ESDF 字母右移规则和冲突检测
│   │   ├── gameRegistry.ts       # 游戏注册表
│   │   └── reverseMapper.ts      # 原生键位 → 通用动作反向映射
│   └── data/
│       ├── ludusavi-games.json   # Ludusavi 游戏路径数据
│       └── keybind-knowledge.json # 键位路径和修改方式知识库
├── public/
│   ├── overlay.html              # 实时按键悬浮窗页面
│   ├── keyboard-assets/          # White 键盘素材
│   └── keyboard-assets-black/    # Black 键盘素材
├── scripts/
│   ├── test-esdf-migrate.cjs     # 四种格式迁移冒烟测试
│   └── test-esdf-batch.cjs       # 预览/批量迁移冒烟测试
├── vite.config.ts                # Vite 开发服务器和开发 API middleware
├── package.json                  # 依赖和脚本
├── HANDOFF.md                    # 较早阶段的详细交接记录
└── release/mouskey-final/        # 手动打包的绿色版输出目录
```

## 重要 API

生产模式由 `electron/main.cjs` 提供；开发模式由 `vite.config.ts` 提供同名接口。

| API | 作用 |
|---|---|
| `GET /api/adapters/detect-all` | 扫描已安装游戏 |
| `GET /api/adapters/esdf-candidates` | 分析全部游戏的 ESDF 迁移状态 |
| `POST /api/adapters/esdf-preview` | 预览单个游戏，不写文件 |
| `POST /api/adapters/esdf-migrate` | 迁移当前游戏的配置 |
| `POST /api/adapters/esdf-batch` | 批量迁移多个游戏 |
| `POST /api/adapters/read` | 读取游戏当前配置 |
| `POST /api/adapters/write` | 按专项适配器/配置档写入 |
| `GET /api/presets/list` | 列出本地预设 |
| `POST /api/presets/save` | 保存本地预设 |
| `GET /api/overlay/status` | 获取悬浮窗状态 |
| `POST /api/overlay/show` | 显示悬浮窗 |
| `POST /api/overlay/hide` | 隐藏悬浮窗 |
| `POST /api/overlay/toggle` | 切换悬浮窗 |

## 开发运行

Windows PowerShell：

```powershell
cd "C:\Users\Administrator\Documents\Codex\2026-09-02\1-2-github"

# 安装依赖
npm install

# 启动开发服务器
npm run dev -- --host 127.0.0.1 --port 4174 --strictPort

# 另一个 PowerShell 窗口启动 Electron
npx electron electron/main.cjs
```

注意：当前项目在 Windows 上开发。不要用 `bash -lc`、`zsh`、`which` 或 Unix 路径判断工具是否安装；使用 PowerShell 的 `Get-Command` 或 `where.exe`。

## 测试与构建

```powershell
# TypeScript 检查
npx tsc --noEmit

# ESDF 四种格式测试
node scripts/test-esdf-migrate.cjs

# ESDF 预览/批量测试
node scripts/test-esdf-batch.cjs

# 写入策略与 v2
node scripts/test-ue4-strategies.cjs
node scripts/test-unity-strategies.cjs
node scripts/test-battlerite.cjs
node scripts/test-lol-abilities.cjs
node scripts/test-mouskey-v2.cjs

# 生产构建（包含 tsc -b 和 vite build）
npm run build
```

当前已验证的测试结果：

- `test-esdf-migrate.cjs`：75 项通过
- `test-esdf-batch.cjs`：9 项通过
- `test-ue4-strategies.cjs` 11 / `test-unity-strategies.cjs` 4 / `test-battlerite.cjs` 6 / `test-lol-abilities.cjs` 8 / `test-mouskey-v2.cjs` 13 项通过
- `npm run build`：通过

## 生产绿色版同步

只修改源码版本，生产绿色版从源码构建和同步，不要直接在 `release/mouskey-final/resources/app` 里开发。

```powershell
$project = "C:\Users\Administrator\Documents\Codex\2026-09-02\1-2-github"
$final = "$project\release\mouskey-final\resources\app"

# 所有后端模块（api-handlers、main、ue4/unity/battlerite/lol 策略、v2 调度等）
Copy-Item "$project\electron\*.cjs" "$final\electron\" -Force
Remove-Item "$final\dist" -Recurse -Force -ErrorAction SilentlyContinue
Copy-Item "$project\dist" "$final\dist" -Recurse -Force
Copy-Item "$project\src\games" "$final\src\games" -Recurse -Force
Copy-Item "$project\src\data\keybind-knowledge.json" "$final\src\data\keybind-knowledge.json" -Force

Get-Process -Name "mouskey" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Start-Process -FilePath "$project\release\mouskey-final\mouskey.exe"
```

绿色版入口：

```text
release/mouskey-final/mouskey.exe
```

应用代码目录：

```text
release/mouskey-final/resources/app/
```

项目采用手动 Electron zip 方案，不使用 electron-builder。electron-builder 曾出现 EPERM 问题，不要重复切回该方案。

## 数据和备份位置

默认用户数据目录：

```text
%USERPROFILE%\Documents\Keyforge\presets\
%USERPROFILE%\Documents\Keyforge\backups\
```

部分配置文件示例：

```text
%APPDATA%\Battlerite\KMInput.json
%LOCALAPPDATA%\Firaxis Games\Sid Meier's Civilization VI\InputSettings.json
```

实际路径可能因为 Steam、WeGame、Documents 重定向、云同步和不同发行版而变化。写入前必须确认实际文件。

## 安全和写入原则

1. 只做本地配置文件读写，不上传用户配置。
2. 不使用运行时键盘钩子来伪造游戏内按键。
3. 写入前创建备份。
4. 默认优先 read-modify-write，保留配置中的其他字段。
5. 未知游戏只能显示“可尝试通用写入”，不能宣称已验证。
6. 不强行修改 Q/A/Z；空键由玩家进游戏后自行安排。
7. 已经是 ESDF 的配置不重复右移。
8. 真实游戏验证前，不要把某个适配器标记为高可靠。

## 已知限制

### 独占全屏悬浮窗

Electron 普通窗口可以在无边框全屏/窗口化全屏上置顶，但无法保证覆盖 DirectX/Vulkan 独占全屏。若悬浮窗在全屏游戏里消失，优先把游戏改成无边框全屏。

### Enhanced Input

一些 UE5 游戏使用 `InputMappingContext.uasset` 等二进制资产，不读取传统 `Input.ini`。Grounded 2 等游戏已经验证过传统 Input.ini 可能不生效。不要为了“覆盖更多游戏”直接覆盖未知二进制文件。

### 云同步和运行时覆盖

Steam Cloud、游戏客户端、服务器同步或游戏运行时保存可能覆盖 MousKey 的写入。写入前应关闭游戏，写入后重启游戏验证。

### 键位语义尚未全量建立

当前 ESDF 批量迁移主要修改键值，不一定知道每个键在游戏里的语义。QAZ 智能建议、动作读取和完整自定义映射属于后续工作。

## 后续开发方向

优先级建议：

1. 用真实用户常玩的游戏验证批量 ESDF 迁移。
2. 为验证成功的游戏补充专项适配器和回归测试。
3. 完善 Source、UE4 传统 Input.ini、常见 Unity JSON 的字段读取。
4. 为候选游戏显示准确的“已验证 / 可尝试 / 暂不可写”状态。
5. 扩展 `keybind-knowledge.json`，记录路径、字段和真实改法。
6. 读取游戏动作语义，生成 Q/A/Z 的合理功能建议。
7. 最后再做“一键应用所有已验证游戏”的批量方案。

## 交接给其他 AI 的关键要求

- 先读本 README 和 `HANDOFF.md`，再改代码。
- 当前主目标是 **WASD → ESDF 整体右移**，不是马上实现所有游戏的完整语义映射。
- Q/A/Z 可以保持空白，不要擅自安排。
- 必须真正修改游戏配置，不要改成运行时拦截方案。
- 只改源码目录，构建后再同步绿色版。
- 修改配置前保留备份，未知格式不要整文件覆盖。
- Windows PowerShell 环境，不要套用 Linux/macOS 命令。
- 每次完成代码改动都运行 TypeScript 检查、相关测试和生产构建。
- 报告“已支持”时区分：源码实现、格式测试通过、本机验证、进游戏验证。
- 不要重复尝试已确认失败的 electron-builder、uiohook-napi、node-global-key-listener 和 LoL 未验证 YAML 写入方案。

## 许可证和资料来源

项目代码按仓库现有许可证执行。键盘素材使用项目中已有的 CC0 资源；游戏路径资料来自 Ludusavi/PCGamingWiki 等公开资料时，应保留来源说明并遵守各自许可证。

GitHub 仓库：<https://github.com/fanAa8/mouskey>

## 键位写入策略（2026-10 更新）

MousKey 的首选原则仍然是**只改配置文件**（方案 1：UE4 `Input.ini` 用 `!AxisMappings=ClearArray` + 全量右移列表重建）。
但部分 UE 游戏在运行时用自带的 DataTable / 键位菜单重建按键（检测标签：**运行时自管键位，配置写入无效**），配置写入对它们无效。经用户同意，对这类游戏提供超出"只改配置"的可选方案：

- **方案 2A：补丁 pak**——在 `Content\Paks` 放入 `<Project>-WindowsNoEditor_MousKey_P.pak`，内含右移后的键位 DataTable 和 `DefaultInput.ini`；不修改原 pak，删除该文件即还原。
- **方案 2B：UE4SS + Lua 模组**——在游戏 `Binaries\Win64` 安装 UE4SS（官方 v3.0.1）与 `Mods\MousKeyESDF`，运行时把映射改成 ESDF 并 `ForceRebuildKeymaps`；按安装清单逐个删除即还原。

**红线：** 检测到 EasyAntiCheat / BattlEye / Vanguard / XIGNCODE / GameGuard / ACE 等反作弊的游戏，一律标记为不支持，任何方案都不安装。联网对战游戏同样不应使用方案 2。
每次写入的结果分三态记录：`written`（已写入）/ `verified-in-game`（用户确认游戏内生效）/ `ineffective`（无效）。


## v2 架构：四个页面 + 个人方案自动适配（2026-10-16）

### 页面

1. **按键配置**：原有的键盘/鼠标绑定编辑、预设、生成变更集、ESDF 工作台和 UE4/Unity 策略接口（保持不变）。
2. **批量迁移**：扫描已安装游戏，每款游戏一张卡片，显示引擎、自动选择的写入策略、生效状态（游戏内已验证 / 已写入待验证 / 无效）和**应用条件**标签，例如：
   - 英雄联盟：`需要客户端开着、不在对局中修改`、`写入后立即同步到账号（云端）`
   - 配置文件 / Input.ini / 补丁类：`写入时需关闭游戏`、`修改后需重启游戏生效`
   - Battlerite：`Steam 云同步副本会一并写入`
   - 反作弊游戏：`检测到反作弊（…），不支持`（不可勾选）
   顶部选择迁移方式：**WASD 整体平移 ESDF** 或 **应用我的个人方案**；可预览、写入所选、对每款游戏「启动」，写入成功后提示「修改后需重启游戏生效」并提供「现在启动」。
3. **个人方案**：按语义定义一套自己的布局（前进/后退/左/右、跳跃、蹲、冲刺、交互、换弹、手电、技能 1–6、召唤师技能、物品 1–6、饰品、地图、背包、表情），两种移动方式：
   - **键盘移动**（WASD 类，例如 ESDF）
   - **鼠标点击移动**（MOBA，只改技能，例如英雄联盟 WERT）
   可保存多个方案（`Documents\Keyforge\presets\personal\*.json`），内置「ESDF 键盘移动」「MOBA 点击移动 · WERT」两个只读模板，可另存为后修改；同键多绑定会标红。
4. **实时显示**：原有实时按键悬浮窗（不变）。

### 后端模块

| 文件 | 作用 |
|---|---|
| `electron/action-semantics.cjs` | 统一动作语义表 `CATALOG`、引擎同义词表（MoveForward/+forward/Vertical+/evtCastSpell1…→规范动作）、各游戏适配器（LoL GameEvents、Battlerite KMInput、Source bind、Unity 轴、UE 动态匹配），`mapProfileToGame` 输出映射/未识别动作/跳过项/冲突 |
| `electron/game-requirements.cjs` | 应用条件（chips）、写入闸门 `checkWrite`（客户端/对局/游戏进程/反作弊）、启动方式（Steam `steam://rungameid/<appid>`、WeGame/Riot LoL 客户端、exe）、生效状态登记 `Documents\Keyforge\game-status.json`（含已验证种子） |
| `electron/mouskey-v2.cjs` | `/api/v2/<action>` 调度：`games`、`launch`、`profiles.list/save/delete`、`plan`（只读预览）、`apply`（单游戏写入，先过闸门）、`status.set`；按游戏自动选策略 |
| `electron/lol-abilities.cjs` | LoL 专用：QWER→WERT、点击移动开关、通用 GameEvents 写入（保留第二绑定、冲突检测）。全部走 LCU：客户端开着且不在对局 → 备份 → PATCH → GET 校验 → 镜像本地文件（带备份和回读校验） |

`electron/main.cjs` 与 `vite.config.ts` 共用同一个 v2 调度器（开发和绿色版行为一致）。

### 策略自动选择

按游戏给出候选顺序，跳过历史上标记为「无效」的策略；检测到反作弊直接不支持：

- 英雄联盟 → `lcu`
- UE4 → 已装 2B 则 `ue4ss`，已装 2A 则 `ue4-pak`，否则 `ue4-clearArray` → `ue4-pak` → `ue4ss`
- Unity → 有键位配置文件（如 KMInput.json）用 `config`，否则 `unity-ggm`（globalgamemanagers）→ `bepinex`
- 其他 → `config`

批量页只会自动执行 `config` / `ue4-clearArray` / `lcu`；补丁 pak、UE4SS、Unity 补丁、BepInEx 等会改游戏目录的策略只显示推荐，仍需在策略面板里单独确认。

### 实现程度

- 已实现：四个页面、游戏总览与应用条件、启动、个人方案增删改、语义映射与预览、ESDF 批量（配置类）、个人方案写入 **英雄联盟**（技能/召唤师/物品/饰品/表情 + 点击移动）和 **Battlerite**（KMInput + Steam 云副本）、与 ESDF 等价的个人方案复用 ESDF 策略。
- 仅预览（未实现写入）：UE / Unity / Source 的任意自定义个人方案（会显示映射结果和未识别动作）。
- 旧「按键配置」页的写入按钮仍走原有流程，未接入新的写入闸门。

### 已在游戏内验证（2026-10-16，用户确认）

| 游戏 | 引擎 | 方案 |
|---|---|---|
| Locked Up Demo | UE4.22 | 2A 补丁 pak（ESDF）；2B UE4SS（RFDG，当前安装） |
| SHADOW PUPPET | Unity 2022.3 Mono | 方案 A：globalgamemanagers InputManager → ESDF（E/F 与交互/手电重叠） |
| Battlerite | 旧 Unity | KMInput.json + Steam 云副本 → ESDF |
| 英雄联盟（WeGame） | — | LCU：技能 QWER→WERT + 点击移动 |
