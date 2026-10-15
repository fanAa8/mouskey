# MousKey · 游戏键位管理器

MousKey 是一个 Windows 桌面工具（Electron + React + TypeScript），目标是**把你的键位方案一次设置、同步到所有游戏**。核心思路是**真正修改游戏自己的配置文件/数据**（写入前备份、可一键恢复），而不是用键盘钩子在运行时拦截改键。

## 功能

| 页面 | 作用 |
| --- | --- |
| **个人方案** | 按“语义动作”（前进、跳跃、技能1、交互…）编辑自己的键位方案；内置 WASD / ESDF / MOBA 模板（均无键位冲突），可另存、复制、删除。分键盘移动类与鼠标点击移动类。 |
| **游戏迁移** | 自动扫描本机游戏，两种迁移方式：**个人方案**（默认，按语义映射到每款游戏的原生动作）和 **ESDF 方案**；可预览变更、批量写入、逐个游戏选择修改方式/安装/卸载/恢复、启动游戏、标记“游戏内有效/无效”。 |
| **实时显示** | 实时按键/鼠标可视化 + 置顶悬浮窗（仅按键 / 游戏 / 全键盘 / 自定义 1-3），可调缩放、透明度、高亮色、主题，可锁定穿透。 |

另有深色/浅色主题切换。

### ESDF 方案

把 WASD 一侧的字母键**整体右移一列**：Q→W、W→E、E→R…，A→S、S→D、D→F…，Z→X…；**Q / A / Z 空出**留给你自己配置。左手停在打字基准位（F 键有定位凸点）。

### 写入方式与回退链

每款游戏按优先级选择写入方式；在游戏里标记“无效”后自动推荐下一种：

- **Unreal Engine 4/5**：`Input.ini` 重建（ClearArray 覆盖）→ **补丁 pak**（repak 重打包 DefaultInput）→ **UE4SS 运行时模组**
- **Unity**：键位配置文件（若有）→ **globalgamemanagers 补丁**（InputManager 轴）→ **BepInEx 运行时插件**（MousKeyRemap）
- **英雄联盟**：通过官方客户端 API（**LCU**）写入技能键/点击移动（客户端需打开、不能在对局中）
- **Battlerite**：写 `KMInput.json`，并同步 Steam 云副本
- 其他游戏：通用配置文件读改写（json / ini / Source cfg），格式自动识别，保留原编码/BOM

### 已在游戏内验证

| 游戏 | 方式 |
| --- | --- |
| Locked Up Demo（UE4） | 补丁 pak（2A）、UE4SS（2B） |
| SHADOW PUPPET（Unity） | globalgamemanagers 补丁 |
| Battlerite（Unity） | KMInput.json + Steam 云 |
| 英雄联盟 | LCU（WERT + 点击移动） |

其他游戏状态显示为“已写入（未验证）”，欢迎反馈。

## 安全机制

### 防止双重平移

- 任何 ESDF 写入前都会检测：已安装补丁/注入、MousKey 已写过配置、存在未恢复的 MousKey 备份/写入记录、当前键位已是 ESDF → 显示「已是 ESDF，跳过」，**不会写第二次**。
- 配置写入与补丁/注入互斥：装补丁前必须先从备份恢复原始配置；写配置前先卸载已装的补丁/注入。重复安装同一方式会跳过。
- 恢复始终回到**最早的原始备份**（按时间解析，排除 before-restore 副本），并恢复同一次写入涉及的**所有文件**（如 UE 多平台 Input.ini）。
- 备份失败即中止写入；写入后回读校验。

### 反作弊策略

- 扫描到 EasyAntiCheat / BattlEye 等反作弊组件的游戏：**不支持任何修改**。
- 已知在线竞技游戏（VALORANT、Apex、CS2、PUBG…）以及找不到安装目录的游戏：**禁止补丁/注入**，只允许改普通配置文件。
- 英雄联盟只走官方客户端 API，不改游戏文件。
- 写入要求游戏已关闭；修改后需重启游戏生效。

### 本地 API

内置服务只监听 `127.0.0.1:4175`，只接受应用自身页面的来源，所有 POST 需要每次启动随机生成的令牌——浏览器里的网页无法调用它改配置。

## 开发与构建

需要 Node.js 22+、Windows 10/11。

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 4174 --strictPort   # 前端开发（http://127.0.0.1:4174）
npm run electron:dev                                       # Electron 开发模式
npm test                                                   # scripts/test-*.cjs（含双重平移守卫测试）
npx tsc -b; npm run lint                                   # 类型检查 / lint
npm run build                                              # 生产构建 → dist/
npm run sync-release                                       # 同步到 release\mouskey-final 并重启
```

`electron-builder` 在本机打包会遇到 EPERM，目前使用手动打包的便携版目录 `release\mouskey-final`（`scripts/sync-release.ps1` 负责同步 electron/、dist/、src/games、src/data、public/、tools/）。

### tools 目录（补丁/注入方式需要）

二进制文件不入库（见 `.gitignore`），从源码运行时需自行放置；发布包里已包含。

| 路径 | 来源 |
| --- | --- |
| `tools/repak/repak.exe` | [trumank/repak](https://github.com/trumank/repak/releases) |
| `tools/ue4ss/unpacked/`（UE4SS.dll、dwmapi.dll、UE4SS-settings.ini、Mods/） | [UE4SS-RE/RE-UE4SS](https://github.com/UE4SS-RE/RE-UE4SS/releases) |
| `tools/unity/bepinex5_x64/` | [BepInEx 5 x64](https://github.com/BepInEx/BepInEx/releases) |
| `tools/unity/MousKeyRemap.dll` | 用 `tools/unity/MousKeyRemap-src/` 自行编译（`dotnet build`） |

缺少这些文件时，对应方式会失败，配置文件方式不受影响。

## 已知限制

- 仅支持 Windows。
- ESDF 方案是整行右移；P/L/M 右移后会溢出到标点，通用格式会跳过并提示。
- 个人方案的“自定义写入”目前只在英雄联盟、Battlerite，以及等同 ESDF 的方案上真正写入；其他引擎为预览。
- UE Enhanced Input（.uasset）、注册表/云端存储键位的游戏暂不支持；部分游戏只在启动时读取配置，需重启。
- 补丁 pak / globalgamemanagers 补丁在游戏更新后需要重做。
- 已知在线游戏名单按名称匹配，不保证完整；请勿在有反作弊的在线游戏中使用补丁/注入。
- 游戏进程名无法识别时，无法自动判断游戏是否在运行，需要自行确认已关闭。