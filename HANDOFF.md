# MousKey 项目交接文档

> 最后更新：2026-09-08
> 状态：Battlerite 写入功能排查中，最新修复（键值大写）尚未验证

---

## 一、这个东西是什么

**MousKey**（原名 Keyforge）是一个 Windows 本地游戏键位管理工具。

### 核心理念
"一次设置 ESDF 布局，所有游戏通用"——**真正修改游戏的配置文件**（不是键盘钩子映射拦截），让用户把自己习惯的键位方案（比如 ESDF 移动）一键应用到所有支持的游戏。

### 主要功能
1. **键位配置页**：用户维护自己的操作习惯方案（MOBA/FPS/RPG/生存等类型），页面展示键盘和鼠标布局，点击按键修改，冲突自动交换
2. **游戏自动检测**：扫描已安装的游戏（Steam 库 + Ludusavi 9442 游戏清单），根据引擎/配置格式自动适配
3. **通用适配器**：根据游戏引擎自动适配（UE4 Input.ini、Unity JSON 等），一次写好覆盖一大类游戏
4. **多写入策略**：一个游戏提供多个修改方案（高/中/低可靠性），不一定哪个成功
5. **读取游戏现有按键**：读取游戏当前配置并同步到网页显示
6. **整体右移键位**：一键把 WASD 布局的所有字母键整体右移变成 ESDF，QAZ 自动空出
7. **实时按键显示悬浮窗**：桌面一角显示当前按下的键盘鼠标状态（多种显示模式：仅按键/游戏模式半幅/全键盘/自定义区域）
8. **预设管理**：导入/导出/删除预设，本地保存多套配置
9. **自动备份+恢复点**：写入前自动备份，可随时恢复

### 技术栈
- 前端：React 18 + Vite + TypeScript
- 桌面：Electron v44.1.1（手动打包方案，非 electron-builder）
- 键鼠监听：koffi 调用 Windows API `GetAsyncKeyState` 50ms 轮询
- 生产模式 API：Electron 内置 HTTP server 监听 4175 端口
- 开发服务器：http://127.0.0.1:4174/

---

## 二、项目目录和关键文件

### 根目录
```
C:\Users\Administrator\Documents\Codex\2026-09-02\1-2-github
```

### 最终可分发版本
```
C:\Users\Administrator\Documents\Codex\2026-09-02\1-2-github\release\mouskey-final\
```
- 大小：约 323MB（精简版）
- 启动：`mouskey-final\mouskey.exe`
- 应用代码：`mouskey-final\resources\app\`

### 关键源文件

| 文件 | 说明 |
|---|---|
| `src/App.tsx` | 主页面（约2700行）：预设、动作模型、键盘鼠标交互、游戏选择、预览、恢复点、写入逻辑、悬浮窗控制 |
| `src/styles.css` | 全部样式 |
| `src/adapters/types.ts` | 类型定义：GameDefinition、ControlAction、PatchSet、WriteStrategy 等 |
| `src/adapters/formatters.ts` | 配置格式生成器：UE4 INI、Source CFG、LoL JSON 等 |
| `src/adapters/patchGenerator.ts` | 变更集生成器：把用户配置转换成游戏原生格式的 patchSet |
| `src/lib/esdfMigration.ts` | ESDF 迁移规则：字母键右移映射表、冲突检测 |
| `src/games/*.json` | 游戏适配器（7个）：league-of-legends、cs2、crossfire、dont-starve、grounded-2、civilization-vi、_engine-ue4（引擎模板） |
| `electron/main.cjs` | Electron 主进程：窗口、托盘、悬浮窗、键鼠轮询、HTTP server |
| `electron/api-handlers.cjs` | API 处理函数（约2400行）：游戏检测、配置读写、备份、LoL LCU API |
| `vite.config.ts` | Vite 配置 + 开发模式 API 中间件 |
| `package.json` | 依赖和脚本 |

### 其他重要路径
- GitHub 仓库：https://github.com/fanAa8/mouskey（public，gh CLI 已登录账号 fanAa8）
- 预设存储：`%USERPROFILE%\Documents\Keyforge\presets\`（*.keyforge.json）
- 备份存储：`%USERPROFILE%\Documents\Keyforge\backups\`
- Battlerite 配置：`C:\Users\Administrator\AppData\Roaming\Battlerite\KMInput.json`
- LoL 配置：`D:\WeGameApps\英雄联盟\Game\Config\PersistedSettings.json`

---

## 三、已完成的功能

### 核心功能
- ✅ 页面原型、双模式预设（传统 WASD + ESDF，QAZ 空出玩家自配）
- ✅ 键盘布局（104 键，经用户十多轮修正验收）、鼠标按键展示（含侧键）
- ✅ 左右两栏桌面布局 + 移动端布局
- ✅ 通用/FPS/生存等预设
- ✅ 冲突按键自动交换
- ✅ 变更预览、恢复点界面
- ✅ 自动备份 + 恢复点

### 游戏适配
- ✅ 英雄联盟：读取/写入（PersistedSettings.json + LCU API 云端同步），**已验证写入生效**
- ✅ 文明6：ESDF 写入，**已验证生效**
- ✅ CS2、穿越火线、饥荒、Grounded 2：适配器演示（部分未完整验证）
- ✅ 游戏自动检测：全量 Steam 库扫描 + Ludusavi 9442 游戏清单
- ✅ 通用适配器：UE4 Input.ini 自动检测和写入
- ✅ 多写入策略架构：一个游戏多个方案，可靠性标签三色
- ✅ 读取游戏现有按键：Battlerite KMInput.json 已验证读取成功
- ✅ 整体右移键位（WASD→ESDF）：功能已实现

### 实时按键显示
- ✅ 键盘鼠标监听（koffi + GetAsyncKeyState，50ms 轮询）
- ✅ 悬浮窗：多种显示模式（仅按键/游戏模式半幅/全键盘/自定义区域）
- ✅ 鼠标单独显示（左键/右键/中键/侧键1/侧键2，图片素材切换）
- ✅ 位置可拖动、大小可调整、锁定/隐藏按钮
- ✅ 位置持久化（下次打开保持上次位置）
- ✅ 两套主题（White/Black 素材，来自 vector-keyboard-controls CC0）

### 工程化
- ✅ 生产模式 API 修复（Electron 内置 4175 HTTP server，前端 loadFile dist）
- ✅ 托盘图标 + 单实例锁
- ✅ 手动打包方案（Electron zip 解压 + 复制应用到 resources/app/）
- ✅ GitHub 仓库创建并首次推送
- ✅ 三段介绍视频生成（seedance_2.0_fast，各10秒）

---

## 四、当前遇到的问题（Battlerite 写入不生效）

### 问题描述
Battlerite 写入显示成功，但进入游戏后键位没有变化。

### 排查过程（已修复的问题）

#### 问题1：nativeNames 方向反了
- **现象**：写入后的 KMInput.json 里动作名是 `Axis_MoveForward`（UE4 模板的），而不是 Battlerite 的 `Move.Y.Pos`
- **原因**：后端读取配置时返回的 nativeNames 是 `原生动作名 → 标准化动作名`（`Move.Y.Pos: 'forward'`），但 GameDefinition.nativeNames 需要的是 `标准化 → 原生`（`forward: 'Move.Y.Pos'`），方向反了
- **状态**：✅ 已修复（后端反转映射方向）

#### 问题2：动态生成 GameDefinition 时 nativeNames 是 UE4 模板的
- **现象**：即使修复了方向，前端动态生成的 Battlerite GameDefinition 还是继承了 UE4 模板的 nativeNames（Axis_MoveForward），因为"读取后更新 nativeNames"的逻辑不生效
- **原因**：依赖读取配置后才更新 nativeNames，但这个更新经常因为状态更新时序问题不生效
- **状态**：✅ 已修复（改成动态生成 GameDefinition 时就直接硬编码 Battlerite 的正确 nativeNames，不依赖读取后更新）

#### 问题3：JSON 写入分支没有保留原配置
- **现象**：写入后原来的 EX.Modifier、UI.Misc、Ability5 等配置不见了，被覆盖成只有变更的键
- **原因**：最初的 JSON 写入直接把 configText 写入文件，没有 read-modify-write
- **状态**：✅ 已重写（使用 detectAllGames 获取 configPath，读取现有 JSON → 合并变更 → 写回，保留所有其他键）

#### 问题4：键值大小写错了（最新修复，尚未验证）
- **现象**：写入后的键盘按键是小写 `k.r`，但 Battlerite 原始配置是大写 `k.S`
- **原因**：后端 toNativeKey 函数用了 `toLowerCase()`，但 Battlerite 对大小写敏感，小写键游戏不识别
- **状态**：✅ 已修复（改成大写 `k.R`），**尚未验证写入后游戏是否生效**

### 当前状态（2026-09-08 最新）
- 动作名已正确：Move.Y.Pos、Move.X.Neg 等（不再是 Axis_MoveForward）
- 键值已改成大写：k.R、k.E 等（匹配 Battlerite 原始格式）
- JSON 写入分支已重写为 read-modify-write
- KMInput.json 已恢复为原始配置
- mouskey.exe 已重启
- **用户尚未测试最新的大写键值版本**

### 可能还存在的问题（需要排查）

1. **JSON 写入分支可能还是没有正确保留原配置**
   - 之前的测试显示原来的 EX.Modifier、UI.Misc 等不见了
   - 需要验证：写入后检查文件，确认原配置还在

2. **Battlerite 可能在运行时锁定配置文件或从云端同步覆盖**
   - 观察到 General.json 最后修改时间比 KMInput.json 晚，说明游戏可能在运行时修改配置
   - 建议：写入前确保游戏完全关闭

3. **游戏可能需要重启才能加载新配置**
   - 很多游戏只在启动时读取配置文件
   - 建议：写入后重启游戏测试

4. **写入的文件路径可能不对**
   - Battlerite 可能读取另一个位置的配置（比如注册表、云端配置、Steam 云同步）
   - 需要确认：游戏实际读取的配置文件路径

5. **Battlerite 是已停止更新的游戏，可能有特殊的配置格式要求**
   - 比如需要特定的编码、BOM、JSON 结构等
   - 当前写入是无 BOM 的 UTF-8，原始文件也是无 BOM

---

## 五、下一步建议

### 优先级1：验证最新修复是否生效
1. 确保 Battlerite 游戏完全关闭
2. 打开 mouskey.exe，选择 Battlerite
3. （可选）读取当前键位 / 整体右移 / 手动修改
4. 生成变更集 → 写入配置
5. **写入后立即检查 KMInput.json 文件内容**，确认：
   - 动作名是 Move.Y.Pos 等（不是 Axis_MoveForward）
   - 键值是大写 k.R 等（不是小写）
   - 原来的 EX.Modifier、UI.Misc 等配置还在（没有被覆盖）
6. 启动 Battlerite，测试键位是否生效

### 优先级2：如果还是不生效，深入排查
1. **确认游戏实际读取的配置路径**：在游戏内修改一个键位，保存后搜索整个硬盘哪个文件被修改了
2. **检查 Steam 云同步**：Battlerite 可能启用了 Steam 云同步，本地修改会被云端覆盖
3. **检查注册表**：部分游戏把配置存在注册表里
4. **考虑 UI 自动化方案**：如果配置文件方案实在走不通，可以考虑在游戏内通过模拟键盘鼠标操作来修改键位（录屏脚本方案，30-40秒改完）

### 优先级3：通用适配器扩展
1. Source 引擎通用适配（cfg 格式生成器已有，自动检测和引擎模板尚未开始）
2. Unity 游戏通用适配（Battlerite 是第一个 Unity 游戏，验证后可以推广）
3. Enhanced Input (.uasset) 写入（UE4 双策略中的第二个，二进制格式，标记为开发中）

### 优先级4：一键应用所有游戏
- 当前是逐游戏选择+写入，最终目标是一键把用户的 ESDF 方案应用到所有支持的游戏

---

## 六、运行和构建方式

### 开发模式
```bash
cd C:\Users\Administrator\Documents\Codex\2026-09-02\1-2-github
npm install
npm run dev -- --host 127.0.0.1 --port 4174 --strictPort
```
然后打开 http://127.0.0.1:4174/

### 生产构建
```bash
npm run build
```

### 同步到精简版并重启
```powershell
npm run build
npm run sync-release   # = scripts/sync-release.ps1
```
`scripts/sync-release.ps1` 复制 electron/*.cjs、dist、src/games、src/data、public（图标、overlay.html）、tools（repak/ue4ss/unity，补丁/注入方式需要），然后重启 release\mouskey-final\mouskey.exe。不复制 package.json（其 name 决定 userData 目录）。

### 测试
```powershell
npm test        # scripts/test-*.cjs（含 test-double-shift.cjs：恢复排序、多文件恢复、双重平移守卫）
npx tsc -b; npm run lint
```

### 本地 API 安全
- 127.0.0.1:4175 只接受来自应用自身页面的 Origin（file:// / dev 4174），POST 需要每次启动随机生成的 X-MousKey-Token（通过页面 URL ?t= 传给前端，src/main.tsx 自动附加）。
- 调试时可用环境变量 MOUSKEY_API_TOKEN 固定 token。
- 旧的无守卫写入路由（/api/adapters/write、esdf-migrate、esdf-batch、ue4-strategy、unity-strategy、lol-abilities-wert）已从 main.cjs 移除；所有写入走 /api/v2（反作弊 + 双重平移守卫）。

### 注意事项
- **只改源码版本**，精简版从源码同步，不要直接改精简版
- electron-builder 做不通（EPERM 错误），用手动打包方案
- 生产模式下前端 API 请求指向 `http://127.0.0.1:4175`（Electron 内置 HTTP server）
- 开发模式下前端 API 请求用相对路径（Vite dev server 代理）

---

## 七、已验证做不通的方案（避免重复踩坑）

- ❌ electron-builder 打包（EPERM 错误，试了3次都失败）
- ❌ node-global-key-listener（缺 WinKeyServer.exe 且被杀软标记）
- ❌ uiohook-napi（Electron 内需重编译）
- ❌ 腾讯/WeGame 版 LoL 的 LeagueClientSettings.yaml（不含热键字段，不能安全修改）
- ❌ 饥荒 KLEI profile zlib 解压失败
- ❌ Grounded 2 传统 UE4 Input.ini 不生效（用的是 Enhanced Input）
- ❌ 运行时键盘钩子映射方案（用户明确否决，要求真正改配置文件）

---

## 八、用户偏好和约束

1. **真正改配置文件**，不是键盘钩子映射拦截
2. **ESDF 布局**是核心方案，WASD 整体右移一个键位，QAZ 空出玩家自配
3. **只改源码版本**，精简版从源码同步，不要一会改精简版一会改最终版
4. **UI 深色科技风**，禁止文字选择（user-select: none），禁止窗口缩放
5. **零容忍前后矛盾和臆测**，要求可直接执行的完整交付物
6. **游戏不要显示"不支持"**，改成"可尝试通用写入"
7. **回答结束后打 1-10 分信心度**，低于7分单独标注
8. **涉及数字/统计/引用提供可验证来源**
