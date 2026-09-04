# MousKey（原 Keyforge）

> 一次设置 ESDF 布局，所有游戏通用 —— 真正修改游戏配置文件的本地键位管理工具，附带实时按键显示悬浮窗。

## 这是什么

MousKey 是一个 Windows 本地游戏键位管理工具。核心理念是：**玩家维护自己的操作习惯方案（如 ESDF 布局），工具按目标游戏的原生配置格式自动生成并写入配置文件**，而不是用键盘钩子做运行时映射拦截。

同时内置一个桌面悬浮窗，实时显示键盘和鼠标的按下状态，可用于直播、录屏或自我检查操作。

## 为什么做这个

传统 WASD 布局的问题：打字时左手需要从基准键位（ASDF）移开，游戏和打字之间要反复切换手型。ESDF 布局把移动键整体右移一位，左手自然停留在打字基准位上，并且左侧空出 Q/A/Z 三个键可以自由绑定高频操作。

但每个游戏都要手动改一遍键位非常繁琐。MousKey 的目标是：**设置一次自己的方案，自动写入到所有支持的游戏里**。

## 功能特性

### 键位配置
- 可视化键盘 + 鼠标布局，点击按键即可修改绑定
- WASD / ESDF 两套方案一键切换（ESDF 为整体右移一位的布局）
- 个人配置档管理，支持多套方案
- 预设方案的保存、导入、导出、删除
- 冲突按键自动交换
- Q/A/Z 三个键在 ESDF 模式下标记为"可自定义"，由玩家自行安排

### 游戏适配
- 数据驱动的适配器架构，每个游戏一个 JSON 描述文件
- 自动扫描已安装游戏（全量 Steam 库 + Ludusavi 9442 款游戏清单）
- 写入前自动备份原配置，创建恢复点
- 已验证可写入的游戏：
  - **英雄联盟**（PersistedSettings.json + LCU API，支持云同步）
  - **CS2**（cfg 文件写入）
  - **文明6**（InputSettings.json 读改写，已验证生效）
  - **饥荒**（settings.ini）
  - **穿越火线**（KeySettings.ini）
- 对允许改键的游戏，通用规则是"WASD 整体右移到 ESDF"，覆盖 80% 场景

### 实时按键显示悬浮窗
- 全局键盘鼠标监听（Windows API `GetAsyncKeyState` 轮询，不依赖驱动）
- 四种显示模式：仅按键 / 游戏模式（半幅键盘）/ 全键盘（104键）/ 自定义区域
- 三套自定义区域，可在可视化键盘上框选需要显示的按键
- 鼠标独立显示，可单独开关；支持左键、右键、中键、侧键1、侧键2
- 键盘使用矢量按键素材（CC0 协议），提供 White / Black 两套主题
- 悬浮窗可拖动、可锁定、可隐藏，位置和大小自动保存
- 透明度、缩放、高亮颜色、高亮透明度均可调
- 系统托盘图标，后台常驻

## 技术栈

- **前端**：React 18 + TypeScript + Vite
- **桌面框架**：Electron
- **原生调用**：koffi（FFI，调用 Windows API 做全局按键监听）
- **样式**：原生 CSS（深色科技风）
- **游戏数据库**：[Ludusavi](https://github.com/mtkennerly/ludusavi) manifest（CC0 协议）
- **按键素材**：[vector-keyboard-controls](https://github.com/)（CC0 协议）

## 开发运行

```bash
# 安装依赖
npm install

# 启动开发服务器（Vite，端口 4174）
npm run dev -- --host 127.0.0.1 --port 4174 --strictPort

# 另开一个终端启动 Electron
npx electron electron/main.cjs
```

## 生产构建

```bash
# 构建前端
npm run build
```

构建产物在 `dist/`。Electron 主进程在生产模式下会直接加载 `dist/index.html`（相对路径，可离线运行）。

### 打包绿色版

本项目不依赖 electron-builder，采用手动绿色版打包：

1. 下载对应版本的 Electron win32-x64 zip
2. 解压后把 `electron.exe` 重命名为 `mouskey.exe`
3. 把应用文件放到 `resources/app/` 下，包含：
   - `electron/main.cjs`
   - `dist/`（前端构建产物）
   - `public/`（按键素材等静态资源）
   - `package.json`
   - `node_modules/koffi/` 和 `node_modules/@koromix/koffi-win32-x64/`（仅需这两个原生模块）
4. 保留 Electron 运行时必须的 dll、pak、dat 文件和 `resources/default_app.asar`

## ESDF 迁移规则

核心规则非常简单：**主键区字母键整体右移一位**。

| 原键位（WASD） | 新键位（ESDF） | 功能 |
|---|---|---|
| W | E | 前进 |
| A | S | 左移 |
| S | D | 后退 |
| D | F | 右移 |
| Q | W | 技能1 / 视角左旋 |
| E | R | 技能2 / 视角右旋 |
| F | G | 交互 / 攻击 |
| 空格 | 空格 | 跳跃（不变） |
| Shift/Ctrl/Alt | 不变 | 修饰键（不变） |

空出的 Q/A/Z 三个键不做强制安排，留给玩家根据游戏自行绑定高频操作。

## 项目结构

```
├── electron/
│   └── main.cjs          # Electron 主进程：窗口、悬浮窗、按键监听、SSE服务
├── src/
│   ├── App.tsx           # 前端主应用（配置页 + 实时显示页）
│   ├── styles.css        # 全部样式
│   └── games/            # 数据驱动的游戏适配器（JSON）
├── public/
│   ├── overlay.html      # 悬浮窗页面
│   ├── keyboard-assets/  # White 主题按键素材
│   └── keyboard-assets-black/  # Black 主题按键素材
├── vite.config.ts        # Vite 配置 + 本地文件读写 API
└── dist/                 # 构建产物
```

## 设计原则

1. **真正改配置文件，不做运行时映射** —— 游戏内显示的就是改后的键位，不会出现"显示一套、实际一套"
2. **预设方案是源头，读取游戏现有配置只是可选能力** —— 读不到游戏配置不阻塞方案应用
3. **写入前必备份** —— 每次写入都带时间戳备份，可随时恢复
4. **通用规则优先，逐游戏适配兜底** —— 80% 的游戏用统一 ESDF 迁移规则，少数特殊游戏单独写适配器
5. **本地运行，不上传任何数据**

## 许可证

MIT

按键素材来自 CC0 协议资源；游戏配置路径数据来自 Ludusavi manifest（CC0）。
