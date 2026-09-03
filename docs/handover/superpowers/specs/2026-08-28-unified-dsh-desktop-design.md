# DeepSeek Harness Desktop — 集大成设计文档

> 日期：2026-08-28
> 状态：设计阶段
> 基础：fork foolgry/dsh-desktop（MIT）→ 融合 dataelement + flaqai + 自研创新

## 一、项目愿景

做一个**集大成的 DeepSeek Harness 桌面客户端**：

- 外壳层：直接用 foolgry 的 TS 架构（端口回退、安全模式、托盘、自动更新、asar 处理、内置 pnpm）
- 稳定性层：融合 dataelement 的 GPU 恢复、窗口恢复、安全策略、上下文菜单
- 安全层：融合 flaqai 的依赖安全层、动态工具投影、capability-scoped IPC
- 独创层：移植自研的深度插件市场（试装/诊断/多源/热挂载）+ 版本管理器（补丁/双通道升级）+ AI 外壳控制

**核心原则：dsh 走官方，不自维护**

- **不 fork dsh、不改 dsh 源码**：始终运行 npm 上官方发布的 `@deepseek-ai/dsh`，与 CLI 用户完全一致
- **CI 自动跟进上游**：每天定时检查 npm 是否有新版本，有则更新依赖、打 tag、构建安装包、发布 Release
- **补丁走 patch-package**：必须的补丁（如 Symbol.for 修复）用 patch-package 记录为 `.patch` 文件，每次 npm install 自动重新应用，不直接改 dsh 源码
- **版本管理器的角色转变**：不是维护自定义 dsh 副本，而是管理官方版本的安装/升级/回退 + 补丁应用状态
- 优势：上游修复了 bug，一天内就能同步到用户；不用自己跟进 dsh 的每个改动，省时省力

## 二、功能来源矩阵

### 外壳基础层（← foolgry）

| 功能 | foolgry 实现位置 | 说明 |
|------|-----------------|------|
| 端口回退 3080→3099 | `src/main.ts` `pickPort()` | `createServer().listen()` 探测 |
| 用 Electron 内置 Node | `src/main.ts` `ELECTRON_RUN_AS_NODE` | 不打包独立 node.exe |
| 内置 pnpm SEA | `src/main.ts` `toolingPathPrefix()` | @pnpm/exe 自包含二进制 |
| node shim (POSIX) | `src/main.ts` | `ELECTRON_RUN_AS_NODE=1 exec` 复用 Electron 二进制 |
| asar 解包 | `electron-builder.yml` `asarUnpack` | spawn 不能从 asar 执行 |
| asar 路径重写 | `src/main.ts` `dshBin()` | `app.asar` → `app.asar.unpacked` |
| 预置插件 symlink | `src/main.ts` `presetBundledPlugins()` | 不复制，用 junction 链接 |
| 系统托盘 | `src/main.ts` TRAY_ICON_DATA_URL | data URL 内嵌图标 |
| 自动更新 | `electron-builder.yml` publish + electron-updater | 每 4 小时检查 |
| 安全模式 | `src/safe-mode.ts` | findCulprit → disableEntry → 重试 |
| 窗口导航守卫 | `src/main.ts` | 限制导航到 127.0.0.1 |
| picker 降级补丁 | `src/main.ts` `ensurePickerFallbackPatch()` | win32 koffi 崩溃修复 |
| i18n 系统语言 | `src/main.ts` `isZhLocale()` | app.getLocale() |
| 上游自动同步 | `.github/workflows/sync-and-release.yml` | 每日 3 次 CI 检查 npm 新版 → 更新依赖 → 打包 → 发布 |
| SHA256 校验 | Releases 附件 | 完整性验证 |

### 稳定性增强层（← dataelement）

| 功能 | dataelement 实现位置 | 说明 |
|------|---------------------|------|
| GPU 崩溃恢复 | `src/main/gpu-fallback.ts` | Windows GPU 进程无法启动沙箱时恢复 |
| 主窗口崩溃恢复 | `src/main/main-window-recovery.ts` | 从 GPU/渲染器崩溃中恢复 |
| macOS LaunchAgent 守卫 | `src/main/launchd-guard.ts` | 防止恶意 LaunchAgent 守护进程 |
| 窗口焦点防偷 | `src/main/window-raise.ts` | macOS 防止自动抢焦点 |
| 插件恢复检测 | `src/main/plugin-recovery-detection.ts` | 识别 rc.8 slot 冲突等 |
| 插件恢复视图 | `src/main/plugin-recovery-view.ts` | 安全模式 UI |
| 原生上下文菜单 | `src/main/context-menu.ts` | 复制/粘贴/选择全部 |
| 安全策略 | `src/main/security-policy.ts` | IPC 桥接通信 |
| 剪贴板信任写 | `src/main/security.ts` | 允许受信任的剪贴板写 |
| 版本信息显示 | `src/main/version-info.ts` | 显示内置 Harness 版本 |
| 关窗到托盘 | `src/main/close-to-tray.ts` | Windows 托盘常驻 |
| 菜单与缩放隔离 | `src/main/windows-menu-view.ts` | 防页面缩放影响菜单 |
| 代码签名+公证 | `electron-builder` 配置 | macOS notarization |

### 安全+扩展层（← flaqai）

| 功能 | flaqai 实现位置 | 说明 |
|------|----------------|------|
| 依赖安全层 | `apps/desktop` boot 层 | 插件执行前构建依赖图，收敛优先隔离其次 |
| 动态工具投影 | `packages/` | 连接变为能力，安全 turn 边界注入 |
| capability-scoped IPC | `apps/desktop` bridge 层 | 每个 bridge 独立权限，无通用 shell/fs/URL |
| 三次连续退出失败状态 | `apps/desktop` | 不无限等待，明确失败+重试+日志 |
| 外部编码工具中心 | Settings → External tools | Codex/Claude Code 连接管理 |
| IM 机器人集成 | `dsh-im` 预置 | 微信/飞书/钉钉/QQ/Slack 等 |
| 预置官方 Codex | `@deepseek-ai/dsh-subagent-codex` | 按平台只带匹配的原生 payload |

### 独创层（← 你的自研代码）

| 功能 | 你的实现位置 | 竞品没有的 |
|------|-------------|-----------|
| 试装机制 | `dsh-plugin-market/lib/market.js` hotInstall | 先在临时目录装，验证通过才提交 |
| 插件诊断 | `dsh-plugin-market/lib/market.js` diagnoseProfile | isAgentRunning + cleanOrphanStore + getPnpmErrorHint |
| 多源社区目录 | `dsh-plugin-market/lib/market.js` loadSources | 可加自己的源 |
| 流式安装 NDJSON | `dsh-plugin-market/lib/market.js` runPnpmStreaming | 实时进度事件解析 |
| 白名单缓存 | `dsh-plugin-market/lib/market.js` whitelist-cache | 安全白名单校验 |
| Profile 备份/恢复 | `dsh-plugin-market/lib/market.js` | 一键备份/恢复整个 profile |
| 双通道升级 | `dsh-plugin-version-manager/lib/core.js` | 管理官方 npm 版本的安装/升级/回退，不自维护 dsh 副本 |
| 补丁系统 | `dsh-plugin-version-manager/lib/core.js` PATCHES | Symbol.for 跨模块单例修复，走 patch-package 不改源码 |
| AI 外壳控制 | `docs/superpowers/specs/2026-08-26-shell-control-design.md` | AI 可修改 Electron 壳（换图标/无边框/窗口操作） |

## 三、架构设计

### 目录结构

```
dsh-desktop/
├── src/
│   ├── main/                          ← Electron 主进程
│   │   ├── index.ts                  ← 入口：启动 dsh + 创建窗口 + 托盘
│   │   ├── runtime/
│   │   │   ├── port-manager.ts       ← 端口探测+回退（← foolgry）
│   │   │   ├── process-lifecycle.ts  ← spawn/健康检查/进程树终止/detach
│   │   │   └── tooling-path.ts       ← pnpm SEA + node shim（← foolgry）
│   │   ├── safe-mode/
│   │   │   ├── culprit-finder.ts     ← 解析 dsh.log 找崩溃插件（← foolgry）
│   │   │   ├── recovery-actions.ts   ← disableEntry/removeBundle/fullSafeMode
│   │   │   └── restore.ts            ← 一键还原
│   │   ├── recovery/
│   │   │   ├── gpu-fallback.ts       ← Windows GPU 崩溃恢复（← dataelement）
│   │   │   └── window-recovery.ts    ← 主窗口崩溃恢复（← dataelement）
│   │   ├── security/
│   │   │   ├── policy.ts             ← capability-scoped IPC 策略（← flaqai）
│   │   │   ├── clipboard.ts          ← 受信任剪贴板写（← dataelement）
│   │   │   └── navigation-guard.ts   ← 导航限制到 127.0.0.1
│   │   ├── tray/
│   │   │   ├── tray-manager.ts       ← 托盘+菜单（← foolgry+dataelement）
│   │   │   └── close-to-tray.ts      ← 关窗→托盘（← dataelement）
│   │   ├── update/
│   │   │   ├── auto-updater.ts       ← electron-updater（← foolgry）
│   │   │   └── upstream-sync.ts      ← CI 上游同步逻辑
│   │   ├── i18n/
│   │   │   └── locale.ts             ← 系统语言检测+多语言（← foolgry）
│   │   ├── window/
│   │   │   ├── main-window.ts        ← BrowserWindow 创建+配置
│   │   │   ├── context-menu.ts       ← 原生右键菜单（← dataelement）
│   │   │   └── picker-fallback.ts    ← win32 picker 降级（← foolgry）
│   │   ├── plugins/
│   │   │   ├── preset.ts             ← 预置插件 symlink（← foolgry）
│   │   │   ├── dependency-safety.ts  ← 依赖安全层（← flaqai）
│   │   │   └── dynamic-projection.ts ← 动态工具投影（← flaqai）
│   │   └── shell-control/            ← 【独创】AI 外壳控制
│   │       ├── icon-manager.ts       ← AI 可换图标
│   │       ├── frameless-toggle.ts   ← AI 可切无边框
│   │       └── window-ops.ts         ← AI 窗口操作（最小化/最大化/置顶）
│   ├── preload/
│   │   ├── index.ts                  ← contextBridge IPC 暴露
│   │   └── capabilities.ts           ← capability-scoped API 定义（← flaqai）
│   ├── renderer/
│   │   ├── boot.html                 ← 启动等待层
│   │   ├── error.html                ← 错误/崩溃恢复层
│   │   └── shell-control-panel.html  ← 【独创】AI 外壳控制面板
│   └── shared/
│       └── types.ts                  ← 共享类型定义
├── plugins/                          ← 自研 dsh 插件（打包后作为预置插件）
│   ├── dsh-plugin-market/           ← 深度插件市场
│   │   ├── lib/
│   │   │   ├── market.ts             ← 核心逻辑（移植自现有 JS，转 TS）
│   │   │   ├── client.ts             ← 前端 UI
│   │   │   ├── run-pnpm.cjs          ← pnpm 执行器
│   │   │   └── restart.cjs           ← 重启脚本
│   │   └── package.json
│   ├── dsh-plugin-version-manager/  ← 版本管理+补丁
│   │   ├── lib/
│   │   │   └── core.ts               ← 核心（移植自现有 JS，转 TS）
│   │   └── package.json
│   └── dsh-shell-control/           ← 【独创】AI 外壳控制插件
│       ├── lib/
│       │   ├── server.ts             ← IPC handler：接收 AI 指令
│       │   └── tools.ts              ← AI 工具定义（set-icon/switch-frameless/...）
│       └── package.json
├── patches/                          ← patch-package 补丁（← dataelement）
├── scripts/
│   ├── prepare-pnpm.ts              ← 内置 @pnpm/exe
│   └── sync-upstream.ts             ← 上游版本同步
├── test/                             ← 测试（← dataelement）
├── electron-builder.yml
├── electron.vite.config.ts
├── package.json
├── tsconfig.json
└── justfile                          ← 构建命令（← foolgry）
```

### 运行时架构

```
DSH Desktop (Electron Main Process)
├── 端口管理器
│   └── 3080→3081→...→3099 逐个探测可用端口
├── 进程生命周期管理器
│   ├── spawn dsh web（用 ELECTRON_RUN_AS_NODE 复用 Electron Node）
│   ├── 健康检查（HTTP GET + body 身份校验）
│   ├── detach（Windows 防 Ctrl+C 广播）
│   └── 退出时 taskkill /T /F 终止进程树
├── 安全模式恢复器
│   ├── 解析 dsh.log 最后 128KB 找崩溃插件
│   ├── 三级恢复：disableEntry → removeBundle → fullSafeMode
│   └── 托盘菜单一键还原
├── GPU/窗口崩溃恢复器
│   ├── GPU 进程崩溃 → 降级重启
│   └── 渲染器崩溃 → 恢复主窗口
├── 依赖安全层（插件执行前）
│   ├── 读 profile manifest + lockfile + Bundle 顺序
│   ├── 构建依赖关系图
│   ├── 收敛优先（让插件共享 Host 依赖）
│   └── 收敛失败才隔离故障插件
├── 托盘管理器
│   ├── 关窗 → 托盘（任务后台继续）
│   ├── 托盘菜单：显示窗口/查看日志/安全模式/检查更新/退出
│   └── data URL 内嵌图标
├── 自动更新器
│   ├── electron-updater（每 4 小时）
│   └── CI 每日 3 次检查上游 npm 新版
├── 【独创】AI 外壳控制器
│   ├── set-icon：AI 指令 → 替换 build/icon.ico → 重建窗口图标
│   ├── switch-frameless：AI 指令 → 切换 frameless/有边框模式
│   └── window-ops：AI 指令 → 最小化/最大化/置顶/透明度
└── BrowserWindow
    ├── webview 加载 http://127.0.0.1:<动态端口>
    ├── contextIsolation: true
    ├── sandbox: true
    ├── nodeIntegration: false
    └── capability-scoped preload（无通用 shell/fs/URL）
```

## 四、实施阶段

### Phase 1：基底搭建（fork foolgry + 移植自研插件）

**目标**：foolgry 外壳能跑起来，且内置你的插件市场和版本管理器。

1. fork foolgry/dsh-desktop → 你的新仓库
2. 把 `plugins/dsh-plugin-market/` 移入新仓库 `plugins/` 目录
3. 把 `plugins/dsh-plugin-version-manager/` 移入
4. 在 `src/main/index.ts` 的 `PRESET_PLUGINS` 数组中加入两个自研插件
5. 在 `presetBundledPlugins()` 中确保 symlink 正确链接到两个自研插件
6. 调整 `electron-builder.yml`：appId 改为你的、productName 改为你的
7. 验证：`just dev` 能启动，插件市场 UI 正常显示，版本管理器能查询版本

### Phase 2：融合 dataelement 稳定性特性

**目标**：外壳不崩溃、崩溃能恢复、关窗到托盘。

1. 移植 `gpu-fallback.ts` → `src/main/recovery/`
2. 移植 `main-window-recovery.ts` → `src/main/recovery/`
3. 移植 `close-to-tray.ts` → `src/main/tray/`
4. 移植 `context-menu.ts` → `src/main/window/`
5. 移植 `security.ts`（剪贴板信任写）→ `src/main/security/`
6. 移植 `launchd-guard.ts`（macOS）→ `src/main/recovery/`
7. 移植 `window-raise.ts`（防焦点偷取）→ `src/main/window/`
8. 验证：GPU 崩溃后能恢复、关窗到托盘、右键菜单可用

### Phase 3：融合 flaqai 安全特性

**目标**：插件执行前做依赖安全检查、IPC 权限分级。

1. 实现 `dependency-safety.ts`：
   - 读 profile manifest + lockfile + Bundle 顺序
   - 构建完整依赖关系图
   - 检测版本冲突/orphaned Bundle/挂载失败
   - 先尝试收敛（共享 Host 依赖），失败才隔离
2. 实现 `dynamic-projection.ts`：
   - 连接状态作为 Host capability
   - 在安全 turn 边界注入工具
3. 重构 preload 为 capability-scoped：
   - 每个 bridge 独立权限
   - 无通用 shell/fs/URL 能力
4. 实现"三次连续退出 → 明确失败状态"
5. 验证：故障插件被隔离而非崩溃整个应用、IPC 权限分级生效

### Phase 4：AI 外壳控制创新层

**目标**：dsh 内置 AI 能通过指令修改 Electron 外壳。

1. 创建 `dsh-shell-control` 插件
2. 定义 AI 工具：
   - `set_icon(path)`：替换窗口图标
   - `switch_frameless(bool)`：切换无边框/有边框
   - `set_window_opacity(float)`：设置窗口透明度
   - `toggle_always_on_top(bool)`：窗口置顶
   - `minimize()` / `maximize()` / `set_size(w,h)`
3. 实现 IPC handler（从 dsh 插件 → Electron 主进程）
4. 实现 `shell-control-panel.html`（可视化管理面板）
5. 安全：所有指令经过白名单校验，不允许任意路径/任意命令
6. 验证：AI 说"换图标" → 图标真的换了

## 五、协议与归属

- foolgry/dsh-desktop：MIT → 可直接 fork，保留 LICENSE
- dataelement/dsh-desktop：MIT → 可引用代码，注明来源
- flaqai/open-deepseek-harness-desktop：MIT → 可引用代码，注明来源
- DeepSeek 名称和鲸鱼 Logo：DeepSeek 商标 → 仅用于标识上游软件
- 你的自研插件代码：MIT

在 README 的 "Acknowledgments" 章节注明三个项目的贡献。
