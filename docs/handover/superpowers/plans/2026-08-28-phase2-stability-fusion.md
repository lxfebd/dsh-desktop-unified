# Phase 2 实施计划：融合 dataelement 稳定性特性

> 仓库：`d:\deepseekhar\dsh-desktop-unified`（fork 自 foolgry/dsh-desktop 的 DeepSeek Harness 桌面壳）
> 参考上游：[dataelement/dsh-desktop](https://github.com/dataelement/dsh-desktop)（GitHub 2.9k⭐）
> Phase 1 已完成：基底搭建 + 自研插件（端口回退、托盘、自动更新、安全模式、asar 处理、内置 pnpm）已落地。
> Phase 2 目标：把 dataelement 在生产中验证过的 9 项稳定性特性，按 foolgry 的极简单文件架构移植并接线。

## Goal

把 dataelement/dsh-desktop 解决真实用户崩溃的 9 项稳定性能力融合进本仓库，使其在以下场景自愈或至少留有可诊断痕迹：

1. Windows GPU 进程无法在沙箱内启动（虚拟显示驱动叠 AMD 核显导致 `0x80000003`）
2. 主窗口渲染器/GPU 崩溃后留黑屏（Electron 默认不重载）
3. 右键无原生菜单（复制/粘贴/选择全部缺位）
4. 受信任来源的剪贴板写被默认权限策略拦截
5. macOS 恶意 LaunchAgent 守护本应用并抢窗口
6. macOS 自动化路径抢焦点（打断用户当前操作）
7. rc.8 引入的插件插槽（slot）冲突无法被现有 `findCulprit` 识别
8. 「关于」对话框不显示内置 Harness 版本
9. 页面缩放（Ctrl±）影响 Windows 自定义菜单视图

非目标：不移植 dataelement 的 mobile bridge、IPC 桥、`WebContentsView` 自定义标题栏、`utilityProcess` 拆分、preset 包传输等重型子系统——这些超出 Phase 2「稳定性」范围，留给后续阶段。

## Architecture

foolgry 是**单主进程文件**架构（`src/main.ts` + `src/safe-mode.ts`），与 dataelement 的 `src/main/*.ts` 多文件 + `src/shared/` + `src/main/runtime/` + `src/main/state/` 深层模块化不同。融合策略遵循三条原则：

### 原则 1：纯逻辑模块直接移植，保持自包含

dataelement 中以下模块**不依赖** Electron 运行时对象（只用 `node:fs`/`node:path` 或纯类型），可直接移植为 `src/` 下的单文件，沿用 NodeNext ESM 风格（导入本地模块带 `.js` 后缀，与现有 `import … from './safe-mode.js'` 一致）：

| 特性 | 源文件 | 目标文件 | Electron 依赖 |
|------|--------|----------|---------------|
| GPU 崩溃恢复 | `gpu-fallback.ts` | `src/gpu-fallback.ts` | 无（纯状态机） |
| 主窗口崩溃恢复 | `main-window-recovery.ts` | `src/main-window-recovery.ts` | 无（纯函数 + 常量） |
| macOS LaunchAgent 守卫 | `launchd-guard.ts` | `src/launchd-guard.ts` | 无（读 `process.env`） |
| macOS 窗口焦点防偷 | `window-raise.ts` | `src/window-raise.ts` | 仅类型（`RaiseableWindow` 接口） |
| 版本信息显示 | `version-info.ts` | `src/version-info.ts` | 无（读 `node_modules` 的 package.json） |

### 原则 2：带 Electron 依赖的模块按 foolgry 单窗口语义改造

| 特性 | 源文件 | 目标文件 | 改造点 |
|------|--------|----------|--------|
| 原生右键菜单 | `context-menu.ts` + `context-menu-template.ts` | `src/context-menu.ts` + `src/context-menu-template.ts` | `locale` 参数从 `() => 'en'\|'zh'` 适配为复用 `isZhLocale()` |
| 受信任剪贴板写 | `security.ts` + `security-policy.ts` | `src/security.ts` + `src/security-policy.ts` | `secureWindow` 的 `setWindowOpenHandler` 保持「单窗口 deny」语义（foolgry 不开多窗口），只新增 `clipboard-sanitized-write` 权限放行 |

### 原则 3：与现有子系统耦合的特性做最小侵入式增强

| 特性 | 增强方式 |
|------|----------|
| 插件恢复检测改进 | 在**现有** `src/safe-mode.ts` 的 `findCulprit` 增加第三类 `slot-conflict` 正则，并在 `main.ts` 的 `proposeRecovery` 增加对应分支——不引入 dataelement 的 `runtime/harness-runtime.ts` + `state/plugin-recovery.ts` 依赖链 |
| Windows 菜单与缩放隔离 | 移植 `windowsMenuViewBounds` 几何函数（为未来自定义菜单预留）+ 新增 `lockZoomFactor` 缩放锁定助手，应用到 splash 窗口；foolgry 用原生 `Menu.setApplicationMenu`，原生菜单天然不受 webContents 缩放影响，故本特性重心在 splash/覆盖层保护 |

### 接线总览（`main.ts` 改动点）

```
app.requestSingleInstanceLock() 后、whenReady 前
  └─ applyGpuFallbackSwitches()   // commandLine.appendSwitch 必须早于 ready

app.whenReady().then(boot 流程)
  ├─ createWindow(port)
  │    ├─ secureWindow(win)                    // 替换内联 handler
  │    ├─ installContextMenu(win, locale)      // 新增
  │    ├─ installMainWindowRendererRecovery(win)// 新增
  │    └─ GPU/render-process-gone → planGpuFallbackResponse
  ├─ createSplash()
  │    └─ lockZoomFactor(splash.webContents)   // 新增
  └─ setupAppMenu() → About 用 aboutDetail()    // 改造

app.on('second-instance') → isDaemonLaunch / raiseWindowWithoutStealingFocus
app.on('activate')        → raiseWindowWithoutStealingFocus（automatic）
```

## Tech Stack

| 维度 | 选择 | 说明 |
|------|------|------|
| 运行时 | Electron 43（内嵌 Node 22/24） | 不变 |
| 语言 | TypeScript ESM，`module: NodeNext`，`strict` | 新模块导入本地文件带 `.js` 后缀 |
| 构建 | `tsc`（`just build`） | `tsconfig.include: src/**/*.ts` 自动收录新文件，输出到 `dist/` |
| 开发 | `just dev`（`tsc && electron .`） | 改完即跑 |
| 任务 | `just` | 所有命令走 justfile |
| 包管理 | pnpm 11.22.0（hoisted） | **禁止 npm**；`node_modules` 整体 `asarUnpack` |
| 状态存储 | `app.getPath('userData')` | 新增 `gpu-fallback.json`，与现有 `window-state.json`/`safe-mode.json` 同目录 |
| 日志 | `appendFileSync(logFile(), …)` | 沿用 `userData/logs/dsh.log` |
| 上游参考 | dataelement/dsh-desktop@main（2026-08-28 快照） | 9 个特性文件的原始实现 |

## 关键约束回顾（改动前必读，源自 `AGENTS.md`）

- **ESM 导入本地模块必须带 `.js` 后缀**：`from './gpu-fallback.js'`，否则 NodeNext 解析失败。
- **`node_modules` 必须 hoisted 且 `asarUnpack`**：`bundledHarnessVersion` 读 `node_modules/@deepseek-ai/dsh/package.json` 在打包后走 asar 可读（asar 是可读扁平 FS）。
- **`app.commandLine.appendSwitch` 必须在 `app.whenReady()` 之前调用**：GPU 开关在 Chromium 启动时才生效，ready 后加无效。
- **`app.exit(0)` 不触发 `will-quit`**：所有 relaunch 路径必须手动 `tray?.destroy()` + `kill(dshChild)`，与现有 `restorePluginsAndRelaunch` 一致。
- **macOS 构建未签名**：`launchd-guard`/`window-raise` 的防护不依赖签名，纯运行时判断。
- **不引入新运行时依赖**：9 个特性全部用 Electron 内置 + `node:*`，不改 `package.json` 的 `dependencies`。

---

## Task 0：前置准备与分支

**Files**
- 无新建文件；创建 git 分支

**Step 0.1 — 确认工作区干净并建分支**（2 分钟）

```bash
cd d:\deepseekhar\dsh-desktop-unified
git status --short
git checkout -b phase2/stability-fusion
```

**Step 0.2 — 确认基线可构建可启动**（3 分钟）

```bash
just build
just dev
```

期望：`tsc` strict 全绿；应用启动后 splash → 主窗口加载 `http://127.0.0.1:<port>/`。若 dev 起不来，先修 Phase 1 遗留问题再继续。

**Step 0.3 — 记录基线行为基线**（2 分钟）

```bash
echo "=== Phase 2 基线 $(date) ===" >> src/../BASELINE.md 2>nul || true
just build 2>&1 | findstr /R "error" || echo "no type errors"
```

确认零类型错误后删除临时痕迹，保持工作区干净。

---

## Task 1：GPU 崩溃恢复

**问题**：部分 Windows 机器（Todesk/GameViewer 虚拟显示驱动叠 AMD 核显）Chromium GPU 进程无法在沙箱内启动，渲染器随之崩溃，加载 Harness 页 `ERR_FAILED`，用户只见黑屏。开关必须在 Chromium 启动前就位，故「上次有效的级别」落盘、下次启动前应用。

**Files**
- 创建 `src/gpu-fallback.ts`（纯状态机逻辑，无 Electron 依赖）
- 修改 `src/main.ts`（接线：早应用开关、监听崩溃、落盘、relaunch）

**Step 1.1 — 创建 `src/gpu-fallback.ts`**（4 分钟）

```ts
/**
 * Windows GPU 沙箱降级状态机。某些机器的 GPU 进程无法在沙箱内启动
 * （虚拟显示驱动叠 AMD 核显 → 0x80000003 → 渲染器随之死），加载页
 * ERR_FAILED。开关必须在 Chromium 启动前就位，故上次有效的级别落盘、
 * 下次启动前应用。降级非免费（丢 GPU 沙箱乃至硬件加速），故门槛高、
 * 且可回升：见 planGpuFallbackResponse / planStableLaunch。
 * @module dsh-desktop/gpu-fallback
 */

export type GpuFallbackLevel = 'default' | 'sandbox-disabled' | 'gpu-disabled'

export interface GpuFallbackState {
  level: GpuFallbackLevel
  /** 当前级别下、应用可用期间观测到的 GPU 丢失次数。 */
  failures: number
  /** 当前级别下未丢 GPU 进程的启动次数。 */
  stableLaunches: number
}

const levels: readonly GpuFallbackLevel[] = ['default', 'sandbox-disabled', 'gpu-disabled']

export const defaultGpuFallbackState: GpuFallbackState = {
  level: 'default',
  failures: 0,
  stableLaunches: 0,
}

/** 连续多少次 GPU 丢失才在「应用仍可用」时降级。单次崩溃不致丢沙箱。 */
export const GPU_FALLBACK_FAILURE_THRESHOLD = 3
/** 降级级别下多少次干净启动后，尝试回升一级。 */
export const GPU_FALLBACK_PROBE_LAUNCHES = 20

/** 不代表本机无法跑 GPU 沙箱的 GPU 进程退出原因（正常退出/被杀）。 */
const survivableReasons: ReadonlySet<string> = new Set(['clean-exit', 'killed'])

export function isGpuLossFatal(reason: string): boolean {
  return !survivableReasons.has(reason)
}

/** 每级保留上一级开关：丢了沙箱的机器关硬件加速后仍需丢沙箱。 */
export function gpuFallbackSwitches(level: GpuFallbackLevel): string[] {
  switch (level) {
    case 'default':
      return []
    case 'sandbox-disabled':
      return ['disable-gpu-sandbox']
    case 'gpu-disabled':
      return ['disable-gpu-sandbox', 'disable-gpu', 'disable-gpu-compositing']
  }
}

/**
 * 决定一次 GPU 进程丢失应改变什么。
 * - Harness 从未渲染 → 这次启动不可用：立即降级并 relaunch。
 * - Harness 已渲染 → GPU 进程会自恢复，仅在丢失累积越阈值后记录下一级别（不 relaunch，免丢用户工作）。
 * - 已到末级 → 不再 relaunch，避免永久坏 GPU 的机器无限重启。
 */
export function planGpuFallbackResponse(options: {
  state: GpuFallbackState
  harnessRendered: boolean
}): { state: GpuFallbackState; relaunch: boolean } {
  const { state, harnessRendered } = options
  const failures = state.failures + 1
  const next = levels[levels.indexOf(state.level) + 1]
  if (next === undefined) {
    return { state: { ...state, failures, stableLaunches: 0 }, relaunch: false }
  }
  if (!harnessRendered) {
    return { state: { level: next, failures: 0, stableLaunches: 0 }, relaunch: true }
  }
  if (failures < GPU_FALLBACK_FAILURE_THRESHOLD) {
    return { state: { ...state, failures, stableLaunches: 0 }, relaunch: false }
  }
  return { state: { level: next, failures: 0, stableLaunches: 0 }, relaunch: false }
}

/** 降级级别下连续干净启动到阈值后，回升一级。 */
export function planStableLaunch(state: GpuFallbackState): GpuFallbackState {
  if (state.level === 'default') return defaultGpuFallbackState
  const stableLaunches = state.stableLaunches + 1
  if (stableLaunches < GPU_FALLBACK_PROBE_LAUNCHES) {
    return { level: state.level, failures: 0, stableLaunches }
  }
  const previous = levels[levels.indexOf(state.level) - 1]
  return { level: previous ?? state.level, failures: 0, stableLaunches: 0 }
}

export function gpuFallbackStateEquals(a: GpuFallbackState, b: GpuFallbackState): boolean {
  return (
    a.level === b.level && a.failures === b.failures && a.stableLaunches === b.stableLaunches
  )
}

export function serializeGpuFallbackState(state: GpuFallbackState): string {
  return JSON.stringify(state)
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

export function parseGpuFallbackState(raw: string): GpuFallbackState {
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof GpuFallbackState, unknown>>
    const level = parsed.level
    if (!levels.includes(level as GpuFallbackLevel)) return defaultGpuFallbackState
    return {
      level: level as GpuFallbackLevel,
      failures: readCount(parsed.failures),
      stableLaunches: readCount(parsed.stableLaunches),
    }
  } catch {
    return defaultGpuFallbackState
  }
}
```

**Step 1.2 — 类型检查**（2 分钟）

```bash
just build
```

期望：零错误（该模块无 Electron 依赖，纯逻辑可独立编译）。

**Step 1.3 — 在 `src/main.ts` 接线：早应用 GPU 开关**（5 分钟）

在 `main.ts` 顶部导入区（`safe-mode` 导入之后）新增导入：

```ts
import {
  defaultGpuFallbackState,
  gpuFallbackStateEquals,
  gpuFallbackSwitches,
  isGpuLossFatal,
  parseGpuFallbackState,
  planGpuFallbackResponse,
  planStableLaunch,
  serializeGpuFallbackState,
  type GpuFallbackState,
} from './gpu-fallback.js'
```

在 `logFile()` 附近新增状态文件与读写助手：

```ts
function gpuFallbackStateFile(): string {
  return join(app.getPath('userData'), 'gpu-fallback.json')
}

function loadGpuFallbackState(): GpuFallbackState {
  try {
    return parseGpuFallbackState(readFileSync(gpuFallbackStateFile(), 'utf8'))
  } catch {
    return defaultGpuFallbackState
  }
}

function saveGpuFallbackState(state: GpuFallbackState): void {
  try {
    writeFileSync(gpuFallbackStateFile(), serializeGpuFallbackState(state) + '\n', 'utf8')
  } catch {
    // 非致命：丢失的只是下次启动的降级记忆
  }
}
```

在模块级全局变量区（`let dshChild` 附近）新增：

```ts
let gpuFallbackState: GpuFallbackState = defaultGpuFallbackState
let harnessRendered = false
```

在拿到单实例锁之后、`app.whenReady()` 之前（`const gotLock = …` 的 `else` 分支开头）应用开关——**必须早于 ready**：

```ts
} else {
  // GPU 沙箱降级开关必须在 Chromium 启动前应用（ready 后无效）。
  gpuFallbackState = loadGpuFallbackState()
  for (const sw of gpuFallbackSwitches(gpuFallbackState.level)) {
    app.commandLine.appendSwitch(sw)
  }
  appendFileSync(logFile(), `\n=== gpu fallback level: ${gpuFallbackState.level} ===\n`)

  app.on('second-instance', () => { … })  // 原有，保持
```

**Step 1.4 — 在 `createWindow` 监听 GPU/渲染器丢失并记录首渲染**（5 分钟）

在 `createWindow` 内 `void win.loadURL(...)` 之前插入：

```ts
// 首次成功加载 Harness 页 = 本机这次启动的 GPU 能扛住渲染。降级级别下
// 累计足够多的干净启动后，planStableLaunch 会尝试回升一级。
win.webContents.on('did-finish-load', () => {
  if (harnessRendered) return
  harnessRendered = true
  const next = planStableLaunch(gpuFallbackState)
  if (!gpuFallbackStateEquals(next, gpuFallbackState)) {
    gpuFallbackState = next
    saveGpuFallbackState(gpuFallbackState)
    appendFileSync(logFile(), `\n=== gpu fallback stable launch probe: level -> ${gpuFallbackState.level} ===\n`)
  }
})
// 渲染器/GPU 进程丢失：不可恢复的黑屏默认行为由本处接管。
win.webContents.on('render-process-gone', (event, details) => {
  const reason = details?.reason ?? 'unknown'
  if (!isGpuLossFatal(reason)) return
  event.preventDefault()
  appendFileSync(logFile(), `\n=== render-process-gone: reason=${reason} exitCode=${details?.exitCode ?? -1} harnessRendered=${harnessRendered} ===\n`)
  const plan = planGpuFallbackResponse({ state: gpuFallbackState, harnessRendered })
  gpuFallbackState = plan.state
  saveGpuFallbackState(gpuFallbackState)
  if (plan.relaunch) {
    appendFileSync(logFile(), `\n=== gpu fallback: relaunching at level ${gpuFallbackState.level} ===\n`)
    quitting = true
    tray?.destroy()
    if (dshChild && dshChild.exitCode === null) dshChild.kill()
    app.relaunch()
    app.exit(0)
  }
})
```

**Step 1.5 — 构建并验证**（3 分钟）

```bash
just build && just dev
```

验证：正常启动不受影响（默认级别无开关）。可手动制造场景验证状态落盘：

```bash
# 在应用 userData 目录手动写入一个降级状态，重启观察日志出现 level 行
# Windows 路径示例：%APPDATA%\DeepSeek Harness\gpu-fallback.json
echo {"level":"sandbox-disabled","failures":0,"stableLaunches":0} > "%APPDATA%\DeepSeek Harness\gpu-fallback.json"
just dev
# 期望日志：=== gpu fallback level: sandbox-disabled ===
```

- [x] Task 1 完成：`gpu-fallback.ts` 编译通过；默认级别零行为变化；降级状态可落盘并下次启动应用开关。

---

## Task 2：主窗口崩溃恢复

**问题**：Electron 在 Windows 上 GPU 进程死后的默认行为是窗口「画着但空白」——黑屏。单次重载几乎总是对的，但同一原因反复触发时，紧密循环重载只会掩盖真问题并耗尽 GPU，需限流。

**Files**
- 创建 `src/main-window-recovery.ts`（纯函数 + 常量）
- 修改 `src/main.ts`（接线 `installMainWindowRendererRecovery`）

**Step 2.1 — 创建 `src/main-window-recovery.ts`**（3 分钟）

```ts
/**
 * 主窗口渲染器/GPU 崩溃后的重载决策。Windows 上 GPU 进程死后 Electron
 * 默认留黑屏，单次重载通常即愈；但同一原因反复触发时紧密循环重载只
 * 掩盖真问题并耗尽 GPU，故限流 + 设上限。
 * @module dsh-desktop/main-window-recovery
 */

export const MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS = 5_000
export const MAIN_WINDOW_RECOVERY_MAX_RELOADS = 3

/**
 * 渲染器/GPU 进程丢失后，主窗口是否还能安全 reload。
 * - 未重载过 → 立即重载。
 * - 冷却窗口内 → 不重载（防紧密循环）。
 * - 超过上限 → 不重载（转交 Harness 失败页而非硬敲 GPU）。
 */
export function shouldReloadAfterMainWindowRendererLoss(options: {
  now: number
  lastReloadAt: number
  reloadCount: number
  cooldownMs?: number
  maxReloads?: number
}): boolean {
  const cooldown = options.cooldownMs ?? MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS
  const maxReloads = options.maxReloads ?? MAIN_WINDOW_RECOVERY_MAX_RELOADS
  if (options.reloadCount >= maxReloads) return false
  if (options.lastReloadAt === 0) return true
  return options.now - options.lastReloadAt >= cooldown
}
```

**Step 2.2 — 类型检查**（2 分钟）

```bash
just build
```

**Step 2.3 — 在 `src/main.ts` 接线重载限流**（5 分钟）

顶部导入：

```ts
import {
  MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS,
  shouldReloadAfterMainWindowRendererLoss,
} from './main-window-recovery.js'
```

模块级状态（`gpuFallbackState` 附近）：

```ts
let mainWindowRecoveryReloadAt = 0
let mainWindowRecoveryReloadCount = 0
```

在 `createWindow` 内、Step 1.4 的 `render-process-gone` 监听**之前**插入独立恢复助手（注意：GPU 降级走 Task 1 的 `planGpuFallbackResponse`；本助手处理「重载」本身，二者协作——GPU 致命丢失先 preventDefault 再由各自逻辑判定是否 reload/relaunch）：

```ts
function reloadMainWindowAfterRendererLoss(win: BrowserWindow): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  const now = Date.now()
  if (!shouldReloadAfterMainWindowRendererLoss({
    now,
    lastReloadAt: mainWindowRecoveryReloadAt,
    reloadCount: mainWindowRecoveryReloadCount,
  })) {
    appendFileSync(logFile(), `\n=== main window recovery: reload throttled (count=${mainWindowRecoveryReloadCount}) ===\n`)
    return
  }
  mainWindowRecoveryReloadAt = now
  mainWindowRecoveryReloadCount += 1
  // 冷却的 4 倍后清零计数，使孤立崩溃干净恢复、持续失败仍触上限。
  setTimeout(() => { mainWindowRecoveryReloadCount = 0 }, MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS * 4).unref?.()
  try {
    void win.webContents.reload()
    appendFileSync(logFile(), `\n=== main window recovery: reload #${mainWindowRecoveryReloadCount} ===\n`)
  } catch (error) {
    appendFileSync(logFile(), `\n=== main window recovery: reload threw: ${error instanceof Error ? error.message : String(error)} ===\n`)
  }
}
```

在 `createWindow` 内追加 `did-fail-load`（主框架）与 `unresponsive` 监听：

```ts
win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
  if (!isMainFrame) return
  // 本地 Harness 服务可达性失败多半是渲染器掉线，而非真网络错误。
  appendFileSync(logFile(), `\n=== did-fail-load: errorCode=${errorCode} description=${errorDescription} ===\n`)
  reloadMainWindowAfterRendererLoss(win)
})
win.webContents.on('unresponsive', () => {
  appendFileSync(logFile(), `\n=== main window webContents unresponsive ===\n`)
})
win.webContents.on('responsive', () => {
  appendFileSync(logFile(), `\n=== main window webContents responsive again ===\n`)
})
```

> 注意协作：Task 1 的 `render-process-gone` 处理器与 Task 2 的 `reloadMainWindowAfterRendererLoss` 各司其职。致命 GPU 丢失由 Task 1 `event.preventDefault()` 接管并可能 relaunch；非致命或重载可救的由 `reloadMainWindowAfterRendererLoss` 重载。若同一 `render-process-gone` 事件二者都想处理，以 Task 1 的 `if (!isGpuLossFatal(reason)) return` 为前置门——非致命才走到 Task 2 的重载路径。具体地：把 Task 2 的 `render-process-gone` 改为在 Task 1 的非致命分支末尾调用 `reloadMainWindowAfterRendererLoss(win)`。

**Step 2.4 — 构建并验证**（3 分钟）

```bash
just build && just dev
```

验证：启动正常。手动触发渲染器崩溃（开发模式下可临时在 DevTools 执行 `process.crash()`，验证后删除）确认日志出现 reload 记录、连续触发 4 次后出现 throttled。

- [x] Task 2 完成：`main-window-recovery.ts` 编译通过；渲染器崩溃后限流重载，超上限停止。

---

## Task 3：原生右键菜单

**问题**：Harness Web UI 在普通浏览器里有原生右键菜单，进 Electron 后默认禁用，复制/粘贴/选择全部/复制链接/复制图片全部失效，影响对话与代码块操作。

**Files**
- 创建 `src/context-menu-template.ts`（构建菜单模板，纯数据）
- 创建 `src/context-menu.ts`（安装到 webContents，用 `clipboard`/`Menu`/`shell`）
- 修改 `src/main.ts`（在 `createWindow` 调 `installContextMenu`）

**Step 3.1 — 创建 `src/context-menu-template.ts`**（4 分钟）

```ts
/**
 * 右键菜单模板构建。把 Electron 的 ContextMenuParams 翻译成本地化菜单项，
 * 由 context-menu.ts 实际 popup。handler 注入使本模块不直接依赖副作用，
 * 便于测试。
 * @module dsh-desktop/context-menu-template
 */

import type { ContextMenuParams, MenuItemConstructorOptions } from 'electron'

export interface ContextMenuHandlers {
  openLink: (url: string) => void
  copyLink: (url: string) => void
  copyImage: () => void
}

export function buildContextMenuTemplate(
  params: ContextMenuParams,
  locale: 'en' | 'zh',
  handlers: ContextMenuHandlers,
): MenuItemConstructorOptions[] {
  const t =
    locale === 'zh'
      ? { copy: '复制', cut: '剪切', paste: '粘贴', selectAll: '全选', copyLink: '复制链接', openLink: '打开链接', copyImage: '复制图片' }
      : { copy: 'Copy', cut: 'Cut', paste: 'Paste', selectAll: 'Select All', copyLink: 'Copy Link', openLink: 'Open Link', copyImage: 'Copy Image' }
  const items: MenuItemConstructorOptions[] = []
  if (params.linkURL) {
    items.push(
      { label: t.openLink, click: () => handlers.openLink(params.linkURL) },
      { label: t.copyLink, click: () => handlers.copyLink(params.linkURL) },
      { type: 'separator' },
    )
  }
  if (params.hasImage) {
    items.push({ label: t.copyImage, click: () => handlers.copyImage() }, { type: 'separator' })
  }
  if (params.isEditable) {
    items.push(
      { role: 'cut', label: t.cut, enabled: params.editFlags.canCut },
      { role: 'copy', label: t.copy, enabled: params.editFlags.canCopy },
      { role: 'paste', label: t.paste, enabled: params.editFlags.canPaste },
    )
  } else if (params.hasSelection) {
    items.push({ role: 'copy', label: t.copy, enabled: params.editFlags.canCopy })
  }
  if (params.isEditable) {
    items.push({ role: 'selectAll', label: t.selectAll })
  }
  return items
}
```

**Step 3.2 — 创建 `src/context-menu.ts`**（3 分钟）

```ts
/**
 * 把原生右键菜单接到主窗口的 webContents 上。复制/粘贴/选择全部走
 * Electron role（macOS 加速键依赖 Edit role 存在），复制链接/图片走
 * clipboard，打开链接交系统浏览器。
 * @module dsh-desktop/context-menu
 */

import { clipboard, Menu, shell, type BrowserWindow } from 'electron'
import { buildContextMenuTemplate } from './context-menu-template.js'

export function installContextMenu(
  window: BrowserWindow,
  locale: () => 'en' | 'zh',
): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, locale(), {
      openLink: (url) => {
        void shell.openExternal(url)
      },
      copyLink: (url) => clipboard.writeText(url),
      copyImage: () => {
        if (window.isDestroyed()) return
        window.webContents.copyImageAt(params.x, params.y)
      },
    })
    if (template.length === 0 || window.isDestroyed()) return
    Menu.buildFromTemplate(template).popup({ window })
  })
}
```

**Step 3.3 — 类型检查**（2 分钟）

```bash
just build
```

**Step 3.4 — 在 `src/main.ts` 接线**（3 分钟）

顶部导入：

```ts
import { installContextMenu } from './context-menu.js'
```

在 `createWindow` 内、`return win` 之前调用（放在 Step 1/2 的 webContents 监听之后）：

```ts
installContextMenu(win, () => (isZhLocale() ? 'zh' : 'en'))
```

**Step 3.5 — 构建并验证**（3 分钟）

```bash
just build && just dev
```

验证：在 Harness 对话输入框右键出现「剪切/复制/粘贴/全选」；选中文字右键出现「复制」；在代码块链接上右键出现「打开链接/复制链接」。中文系统下标签为中文。

- [x] Task 3 完成：右键菜单在可编辑/选区/链接/图片场景均生效，标签随系统语言中英切换。

---

## Task 4：受信任剪贴板写

**问题**：Harness 渲染层在某些路径下用 `navigator.clipboard.writeText` 写剪贴板，Electron 默认权限策略对非主框架或非受信任来源的剪贴板写予以拒绝，导致「复制」在 UI 内静默失败。需对主框架、来自本地 Harness 源的 `clipboard-sanitized-write` 权限放行。

**Files**
- 创建 `src/security-policy.ts`（纯 URL/权限判定）
- 创建 `src/security.ts`（`secureWindow` 装配会话级 handler）
- 修改 `src/main.ts`（用 `secureWindow` 替换 `createWindow` 内联 handler）

**Step 4.1 — 创建 `src/security-policy.ts`**（3 分钟）

```ts
/**
 * 窗口安全策略判定。受信任 URL = 本地 Harness（127.0.0.1/localhost）+
 * file: + dsh-recovery: 恢复页。clipboard-sanitized-write 仅对主框架、
 * 且请求来自 Harness 源时放行——这是「受信任剪贴板写」的核心。
 * @module dsh-desktop/security-policy
 */

function isHarnessUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

export function isTrustedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'file:' || parsed.protocol === 'dsh-recovery:') return true
  } catch {
    return false
  }
  return isHarnessUrl(rawUrl)
}

export function canGrantWindowPermission(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
): boolean {
  return (
    permission === 'clipboard-sanitized-write' &&
    isMainFrame &&
    requestingUrl !== undefined &&
    isHarnessUrl(requestingUrl)
  )
}
```

**Step 4.2 — 创建 `src/security.ts`**（4 分钟）

```ts
/**
 * 装配窗口级安全 handler。foolgry 是单窗口应用：setWindowOpenHandler
 * 对所有 window.open 返回 deny（受信任源也不再开新窗口），仅把
 * http(s) 外链交给系统浏览器。新增 will-attach-webview 阻断与
 * clipboard-sanitized-write 权限放行（受信任剪贴板写）。
 * @module dsh-desktop/security
 */

import { shell, type BrowserWindow } from 'electron'
import { canGrantWindowPermission, isTrustedAppUrl } from './security-policy.js'

export function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedAppUrl(url) && (url.startsWith('https://') || url.startsWith('http://'))) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url)) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      canGrantWindowPermission(
        permission,
        details.requestingUrl ?? requestingOrigin,
        details.isMainFrame,
      ),
  )
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(canGrantWindowPermission(permission, details.requestingUrl, details.isMainFrame))
    },
  )
}
```

**Step 4.3 — 类型检查**（2 分钟）

```bash
just build
```

**Step 4.4 — 在 `src/main.ts` 用 `secureWindow` 替换内联 handler**（4 分钟）

顶部导入：

```ts
import { secureWindow } from './security.js'
```

在 `createWindow` 内，删除现有这段：

```ts
  // （删除）win.webContents.setWindowOpenHandler(({ url }) => {
  // （删除）   if (!url.startsWith('http://127.0.0.1:')) void shell.openExternal(url)
  // （删除）   return { action: 'deny' }
  // （删除） })
  // （删除） win.webContents.on('will-navigate', (event, url) => {
  // （删除）   if (!url.startsWith('http://127.0.0.1:')) {
  // （删除）     event.preventDefault()
  // （删除）     void shell.openExternal(url)
  // （删除）   }
  // （删除） })
```

替换为一行（放在 `win.on('close', …)` 之后、导航守卫原位置）：

```ts
secureWindow(win)
```

> `secureWindow` 用 URL 解析判定受信任源，比原 `startsWith('http://127.0.0.1:')` 更健壮（能识别 `localhost`、带查询串/端口的变体），且额外阻断 webview 附加、放行主框架剪贴板写。

**Step 4.5 — 构建并验证**（3 分钟）

```bash
just build && just dev
```

验证：点击 UI 内的外链（如插件市场仓库链接）在外部浏览器打开；Harness 内「复制到剪贴板」按钮不再静默失败（可用 DevTools 在主框架执行 `navigator.clipboard.writeText('test').then(()=>console.log('ok'))`，期望输出 `ok` 且剪贴板含 `test`）。

- [x] Task 4 完成：`security-policy.ts` + `security.ts` 编译通过；外链走系统浏览器；主框架 Harness 源剪贴板写放行。

---

## Task 5：macOS LaunchAgent 守卫

**问题**：macOS 通过 `XPC_SERVICE_NAME` 环境变量报告进程启动方式——GUI 启动带 `application.<bundle id>.<n>.<n>`，而 LaunchAgent/LaunchDaemon 启动带任务自身 label。恶意 LaunchAgent 守护本应用二进制后，其第二次实例会触发已运行实例的 `second-instance`，被误当作用户请求焦点。需识别并忽略合成启动。

**Files**
- 创建 `src/launchd-guard.ts`（纯逻辑，读 `process.env`/`argv`）
- 修改 `src/main.ts`（`second-instance` 与单实例判定）

**Step 5.1 — 创建 `src/launchd-guard.ts`**（3 分钟）

```ts
/**
 * macOS 启动方式守卫。GUI 启动的 XPC_SERVICE_NAME 以 `application.` 开头；
 * LaunchAgent/LaunchDaemon 启动带任务自身 label，即「被守护」。
 * isUserInitiatedInstance 进一步识别带脚本参数（.mjs/.cjs/.js）的合成
 * 启动——这类参数是给运行时的，不是要打开的文件。
 * @module dsh-desktop/launchd-guard
 */

export function isDaemonLaunch(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  if (platform !== 'darwin') return false
  const serviceName = environment.XPC_SERVICE_NAME
  if (serviceName === undefined || serviceName === '' || serviceName === '0') return false
  return !serviceName.startsWith('application.')
}

const scriptArgumentPattern = /\.[mc]?js$/i

export function isUserInitiatedInstance(argv: string[]): boolean {
  if (argv.length === 0) return true
  const [binary, ...rest] = argv as [string, ...string[]]
  if (binary.includes('/Contents/Frameworks/')) return false
  const firstArgument = rest[0]
  if (firstArgument === undefined) return true
  return !scriptArgumentPattern.test(firstArgument)
}
```

**Step 5.2 — 类型检查**（2 分钟）

```bash
just build
```

**Step 5.3 — 在 `src/main.ts` 接线单实例守卫**（4 分钟）

顶部导入：

```ts
import { isDaemonLaunch, isUserInitiatedInstance } from './launchd-guard.js'
```

改造 `second-instance` 处理器，在恢复窗口前判断是否合成启动：

```ts
  app.on('second-instance', (_event, argv) => {
    // 恶意 LaunchAgent 守护本应用会触发此事件；带脚本参数的合成启动
    // 不当作用户请求焦点。守护进程或合成启动直接忽略。
    if (isDaemonLaunch(process.env, process.platform)) {
      appendFileSync(logFile(), `\n=== second-instance ignored: daemon launch (LaunchAgent guard) ===\n`)
      return
    }
    if (!isUserInitiatedInstance(argv)) {
      appendFileSync(logFile(), `\n=== second-instance ignored: synthetic launch (script argument) ===\n`)
      return
    }
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
```

> `argv` 参数来自 `second-instance` 事件的第二个参数（新实例的命令行）。foolgry 原签名是 `() => {}`，改为 `(_event, argv) => {}`。macOS 非目标平台时 `isDaemonLaunch` 直接返回 false，零影响。

**Step 5.4 — 构建并验证**（2 分钟）

```bash
just build && just dev
```

验证：Windows/Linux 上 `isDaemonLaunch` 恒 false，行为不变；macOS 上正常二次启动仍聚焦窗口（argv 无脚本参数，`isUserInitiatedInstance` 返回 true）。

- [x] Task 5 完成：`launchd-guard.ts` 编译通过；macOS 守护进程/合成启动被识别并忽略，正常启动不受影响。

---

## Task 6：macOS 窗口焦点防偷

**问题**：macOS 上 `BrowserWindow.show()` 自带 focus，会激活本应用、抢占用户当前正在用的应用。`showInactive()` 是保留前台应用的 macOS 路径。自动触发（activate、second-instance）应走防偷，显式用户触发保留原 restore/show/focus。

**Files**
- 创建 `src/window-raise.ts`（纯逻辑，最小接口）
- 修改 `src/main.ts`（`showWindow`、`activate`、`second-instance` 用 `raiseWindowWithoutStealingFocus`）

**Step 6.1 — 创建 `src/window-raise.ts`**（3 分钟）

```ts
/**
 * 不抢焦点的窗口唤起。macOS 上 BrowserWindow.show() 自带 focus，会激活
 * 本应用盖住用户当前应用；showInactive() 是保留前台应用的路径。显式
 * 用户动作与其他平台走普通 restore/show/focus。
 * @module dsh-desktop/window-raise
 */

interface RaiseableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  showInactive(): void
  focus(): void
}

export type WindowFocusIntent = 'automatic' | 'user'

export function raiseWindowWithoutStealingFocus(
  window: RaiseableWindow,
  platform: NodeJS.Platform,
  isAppActive: () => boolean,
  intent: WindowFocusIntent = 'automatic',
): void {
  if (window.isDestroyed()) return
  if (platform === 'darwin' && intent === 'automatic' && !isAppActive()) {
    window.showInactive()
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
```

**Step 6.2 — 类型检查**（2 分钟）

```bash
just build
```

**Step 6.3 — 在 `src/main.ts` 接线防偷唤起**（4 分钟）

顶部导入：

```ts
import { raiseWindowWithoutStealingFocus, type WindowFocusIntent } from './window-raise.js'
```

改造 `showWindow`，加 `intent` 参数（默认 automatic），用 `raiseWindowWithoutStealingFocus`：

```ts
function showWindow(port: number, intent: WindowFocusIntent = 'automatic'): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow(port)
    return
  }
  raiseWindowWithoutStealingFocus(
    mainWindow,
    process.platform,
    () => app.isActive(),
    intent,
  )
}
```

> `app.isActive()` 是 Electron 主进程判定本应用是否前台的方法（macOS 有效，其他平台恒 true 或无意义，但 `raiseWindowWithoutStealingFocus` 已按 platform 分支）。

改造 `activate` 事件用 automatic intent：

```ts
  app.on('activate', () => {
    if (booted && serverPort && !mainWindow?.isVisible()) showWindow(serverPort, 'automatic')
  })
```

托盘菜单/点击「显示」保留 user intent（显式用户动作）：

```ts
  tray.on('click', () => showWindow(port, 'user'))
```

`createTray` 内 `labels.show` 的 click 也改：

```ts
      { label: labels.show, click: () => showWindow(port, 'user') },
```

`second-instance` 内（Task 5 改造后）的窗口恢复改用 automatic：

```ts
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      raiseWindowWithoutStealingFocus(win, process.platform, () => app.isActive(), 'automatic')
    }
```

**Step 6.4 — 构建并验证**（3 分钟）

```bash
just build && just dev
```

验证：macOS 上聚焦别的应用、再点 dock 图标，窗口出现但**不抢**前台应用焦点（showInactive）；显式托盘「显示」则正常聚焦（user）。Windows/Linux 行为不变（platform 分支走 show/focus）。

- [x] Task 6 完成：`window-raise.ts` 编译通过；macOS 自动唤起不抢焦点，显式动作正常聚焦。

---

## Task 7：插件恢复检测改进（rc.8 slot 冲突）

**问题**：rc.8 引入插件插槽（slot）声明，两个插件争用同一插槽时崩溃，其错误特征既非「failed to apply/import loader entry」也非「cannot resolve profile bundle」，现有 `findCulprit` 无法归因，直接落到「无法定位到具体某个插件」的全量安全模式，用户失去「这俩插件冲突」的诊断信息。

**Files**
- 修改 `src/safe-mode.ts`（`Culprit` 增 `slot-conflict` kind，`findCulprit` 增第三正则）
- 修改 `src/main.ts`（`proposeRecovery` 增 `slot-conflict` 分支）

**Step 7.1 — 在 `src/safe-mode.ts` 扩展 `Culprit` 类型**（3 分钟）

把现有：

```ts
export type Culprit =
  | { kind: 'apply'; entryId: string; packageName: string }
  | { kind: 'unresolvable'; packageName: string }
```

改为：

```ts
export type Culprit =
  | { kind: 'apply'; entryId: string; packageName: string }
  | { kind: 'unresolvable'; packageName: string }
  | { kind: 'slot-conflict'; slotName: string }
```

**Step 7.2 — 在 `findCulprit` 增 slot 冲突正则**（4 分钟）

在 `findCulprit` 内 `unresolvable` 循环之后、`return culprit` 之前插入第三类匹配：

```ts
  // rc.8 插槽冲突：两个插件争用同一 slot。错误形如
  //   slot "xxx" conflict / duplicate slot "xxx" /
  //   slot "xxx" already (registered|provided|occupied|taken)
  // 此类冲突涉及两个插件，无法靠禁用单个 entry 干净解决，故只捕获
  // slot 名，交给 proposeRecovery 走「插槽冲突」对话框 + 全量安全模式。
  const slotConflict = /slot "([^"]+)" (?:conflict|duplicate|already (?:registered|provided|occupied|taken))/i
  for (const match of attemptLog.matchAll(slotConflict)) {
    culprit = { kind: 'slot-conflict', slotName: match[1] }
  }
  return culprit
```

> 正则用 `matchAll` + 全局扫描，与现有 apply/unresolvable 风格一致（后匹配覆盖先匹配，最终取最内层/最具体的）。

**Step 7.3 — 类型检查**（2 分钟）

```bash
just build
```

**Step 7.4 — 在 `src/main.ts` 的 `proposeRecovery` 增 `slot-conflict` 分支**（4 分钟）

在 `proposeRecovery` 内 `culprit?.kind === 'unresolvable'` 分支之后、`!tried.has('full')` 之前插入：

```ts
  if (culprit?.kind === 'slot-conflict' && !tried.has(`slot:${culprit.slotName}`)) {
    tried.add(`slot:${culprit.slotName}`)
    const approved = await confirmRecovery({
      title: '插件插槽冲突',
      message: `检测到插件插槽「${culprit.slotName}」冲突——两个插件争用了同一插槽。`,
      detail:
        '插槽冲突涉及多个插件，无法靠禁用单个插件干净解决。是否以安全模式启动' +
        '（禁用所有自行安装的插件）？启动成功后可通过托盘菜单' +
        '「恢复被禁用的插件」还原，再逐个排查是哪两个插件冲突。',
      confirm: '以安全模式启动',
    })
    if (!approved) return false
    const action = enterFullSafeMode(dshHome(), profileDir, WEB_PROFILE_TEMPLATE)
    recordRecoveryAction(safeModeStateFile(), action)
    appendFileSync(logFile(), `\n=== safe mode: slot conflict "${culprit.slotName}", full plugin strip, removed bundles: ${action.removedBundles.join(', ') || '(none)'} ===\n`)
    return true
  }
```

**Step 7.5 — 构建并验证**（3 分钟）

```bash
just build && just dev
```

验证：构造一段含 slot 冲突的日志文本，确认 `findCulprit` 返回 `{ kind: 'slot-conflict', slotName }`。可在 `node` REPL 临时验证（不写入仓库）：

```bash
node -e "import('./dist/safe-mode.js').then(m=>console.log(m.findCulprit('slot \"sidebar\" conflict')))"
```

期望输出 `{ kind: 'slot-conflict', slotName: 'sidebar' }`。

- [x] Task 7 完成：`safe-mode.ts` 的 `Culprit`/`findCulprit` 扩展编译通过；slot 冲突被识别并走专门对话框 + 安全模式，不再静默落到通用全量分支。

---

## Task 8：版本信息显示

**问题**：「关于」对话框只显示桌面版本，不显示内置 Harness 版本。用户报障时无法判断内置 dsh 是 rc.1 还是 rc.2，排查困难。

**Files**
- 创建 `src/version-info.ts`（读 `node_modules/@deepseek-ai/dsh/package.json`）
- 修改 `src/main.ts`（`setupAppMenu` 的 About 用 `aboutDetail`）

**Step 8.1 — 创建 `src/version-info.ts`**（3 分钟）

```ts
/**
 * 内置 Harness 版本读取与「关于」文案。打包后 node_modules 经
 * asarUnpack 落盘，package.json 在 asar 内亦可读（asar 是可读扁平 FS）。
 * @module dsh-desktop/version-info
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface PackageMetadata {
  version?: unknown
  dependencies?: Record<string, unknown>
}

function readPackageMetadata(path: string): PackageMetadata | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageMetadata
  } catch {
    return undefined
  }
}

function validVersion(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function bundledHarnessVersion(appPath: string): string | undefined {
  const installedMetadata = readPackageMetadata(
    join(appPath, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
  )
  const installedVersion = validVersion(installedMetadata?.version)
  if (installedVersion) return installedVersion
  const appMetadata = readPackageMetadata(join(appPath, 'package.json'))
  return validVersion(appMetadata?.dependencies?.['@deepseek-ai/dsh'])
}

export function aboutDetail(
  desktopVersion: string,
  harnessVersion: string | undefined,
  locale: 'en' | 'zh',
): string {
  const harness = harnessVersion ?? (locale === 'zh' ? '未知' : 'Unknown')
  if (locale === 'zh') {
    return `DSH Desktop 版本：${desktopVersion}\n内置 Harness 版本：${harness}\n\nHarness 随 DSH Desktop 更新。`
  }
  return `DSH Desktop version: ${desktopVersion}\nBundled Harness version: ${harness}\n\nHarness is updated with DSH Desktop.`
}
```

**Step 8.2 — 类型检查**（2 分钟）

```bash
just build
```

**Step 8.3 — 在 `src/main.ts` 接线「关于」对话框**（4 分钟）

顶部导入：

```ts
import { aboutDetail, bundledHarnessVersion } from './version-info.js'
```

在 `setupAppMenu` 内，把 Windows 分支的 `{ role: 'about', label: t.about }` 改为自定义 click（macOS 的 `role: 'about'` 走系统对话框，无法注入文案，也一并改成自定义 click 以统一行为）。

macOS 分支内 `{ role: 'about', label: t.about }` 改为：

```ts
            {
              label: t.about,
              click: () => void showAbout(),
            },
```

Windows 分支 help 子菜单内 `{ role: 'about', label: t.about }` 改为：

```ts
      { label: t.about, click: () => void showAbout() },
```

在 `setupAppMenu` 之前新增 `showAbout`：

```ts
async function showAbout(): Promise<void> {
  const zh = isZhLocale()
  await dialog.showMessageBox({
    type: 'info',
    title: zh ? '关于 DSH Desktop' : 'About DSH Desktop',
    message: 'DeepSeek Harness',
    detail: aboutDetail(app.getVersion(), bundledHarnessVersion(app.getAppPath()), zh ? 'zh' : 'en'),
    buttons: ['确定'],
  })
}
```

**Step 8.4 — 构建并验证**（3 分钟）

```bash
just build && just dev
```

验证：菜单「关于」弹窗显示 `DSH Desktop 版本：0.1.1-rc.2…` 与 `内置 Harness 版本：0.1.1-rc.2` 两行。开发模式下 `app.getAppPath()` 指向项目根，`node_modules/@deepseek-ai/dsh/package.json` 存在，能读到真实版本。

- [x] Task 8 完成：`version-info.ts` 编译通过；关于对话框显示桌面 + 内置 Harness 双版本。

---

## Task 9：Windows 菜单与缩放隔离

**问题**：dataelement 用 `WebContentsView` 自绘 Windows 标题栏菜单，该视图随页面 Ctrl±缩放而错位；`windowsMenuViewBounds` 计算其几何，`setZoomFactor(1)` 锁定缩放。foolgry 用原生 `Menu.setApplicationMenu`（不受 webContents 缩放影响），故菜单本身无此问题；但 splash 窗口是 webContents，会被 Ctrl±破坏；且几何函数是未来自定义 Windows 菜单的基础。本任务移植几何函数 + 缩放锁定助手，并应用到 splash。

**Files**
- 创建 `src/windows-menu-view.ts`（几何 + `lockZoomFactor` 助手）
- 修改 `src/main.ts`（splash 用 `lockZoomFactor`）

**Step 9.1 — 创建 `src/windows-menu-view.ts`**（4 分钟）

```ts
/**
 * Windows 菜单视图几何 + 缩放隔离。原生 Menu.setApplicationMenu 不受
 * webContents 缩放影响，故本模块重心在：① windowsMenuViewBounds 为未来
 * 自定义 WebContentsView 菜单预留几何计算；② lockZoomFactor 把覆盖层/
 * splash 的缩放钉死在 1.0，防 Ctrl±破坏。
 * @module dsh-desktop/windows-menu-view
 */

import type { Rectangle } from 'electron'
import type { WebContents } from 'electron'

/** Windows 自定义标题栏高度（与 dataelement shared/desktop-menu 一致）。 */
export const WINDOWS_TITLEBAR_HEIGHT = 36
export const WINDOWS_CAPTION_CONTROLS_WIDTH = 140
export const WINDOWS_MENU_BUTTON_WIDTH = 44
export const WINDOWS_MENU_PANEL_WIDTH = 304
export const WINDOWS_MENU_PANEL_MAX_HEIGHT = 760

interface ContentSize {
  width: number
  height: number
}

/**
 * 计算 Windows 自定义菜单视图的边界矩形。菜单收起时只占按钮宽，
 * 展开时占面板宽；右对齐到标题栏控件左侧；全屏时无标题栏控件。
 */
export function windowsMenuViewBounds(
  contentSize: ContentSize,
  menuOpen: boolean,
  fullscreen = false,
): Rectangle {
  const contentWidth = Math.max(0, Math.floor(contentSize.width))
  const contentHeight = Math.max(0, Math.floor(contentSize.height))
  const captionWidth = fullscreen ? 0 : Math.min(WINDOWS_CAPTION_CONTROLS_WIDTH, contentWidth)
  const availableWidth = Math.max(0, contentWidth - captionWidth)
  const requestedWidth = menuOpen ? WINDOWS_MENU_PANEL_WIDTH : WINDOWS_MENU_BUTTON_WIDTH
  const width = Math.min(requestedWidth, availableWidth)
  const height = menuOpen
    ? Math.min(WINDOWS_MENU_PANEL_MAX_HEIGHT, contentHeight)
    : Math.min(WINDOWS_TITLEBAR_HEIGHT, contentHeight)
  return {
    x: Math.max(0, contentWidth - captionWidth - width),
    y: 0,
    width,
    height,
  }
}

/**
 * 把一个 webContents 的缩放钉死在 1.0。覆盖层/splash 不应受页面 Ctrl±
 * 影响：缩放变化时立即回拨到 1.0，防错位。仅在 webContents 未销毁时
 * 生效，销毁后静默。
 */
export function lockZoomFactor(webContents: WebContents): void {
  const apply = (): void => {
    if (webContents.isDestroyed()) return
    try {
      webContents.setZoomFactor(1)
    } catch {
      // 加载前 setZoomFactor 可能抛错，忽略
    }
  }
  apply()
  webContents.on('did-start-loading', apply)
  webContents.on('zoom-changed', (_event, zoomFactor) => {
    if (zoomFactor !== 1) apply()
  })
}
```

**Step 9.2 — 类型检查**（2 分钟）

```bash
just build
```

> 若 `zoom-changed` 事件签名报类型错，改为 `webContents.on('zoom-changed', apply)`（不解构参数）。

**Step 9.3 — 在 `src/main.ts` 给 splash 锁缩放**（3 分钟）

顶部导入：

```ts
import { lockZoomFactor } from './windows-menu-view.js'
```

在 `createSplash` 内 `void splashWindow.loadURL(...)` 之后插入：

```ts
  lockZoomFactor(splashWindow.webContents)
```

> 原生应用菜单（`setupAppMenu` → `Menu.setApplicationMenu`）由系统绘制，不随 webContents 缩放变化，故菜单隔离天然成立；splash 是 webContents，需锁定。未来若引入自定义 Windows 菜单视图，用 `windowsMenuViewBounds` 计算边界、`lockZoomFactor` 锁其缩放，模式与 splash 一致。

**Step 9.4 — 构建并验证**（3 分钟）

```bash
just build && just dev
```

验证：启动期间 splash 显示正常；在 splash 可见时按 Ctrl++（若时机难抓，可临时把 `createSplash` 的超时拉长验证后还原），splash 内容不放大不错位。原生菜单的查看→重置缩放/放大/缩小对主窗口 webContents 仍生效（未锁主窗口缩放，保留用户可调）。

- [x] Task 9 完成：`windows-menu-view.ts` 编译通过；splash 缩放锁定；原生菜单天然隔离；几何函数为未来自定义菜单预留。

---

## Task 10：集成验证与回归

**Files**
- 修改 `scripts/ci-smoke.mjs`（可选：增 GPU 状态文件存在性断言）
- 无新建运行时文件

**Step 10.1 — 全量类型检查与编译**（2 分钟）

```bash
just build
```

期望：零错误、零警告（strict）。

**Step 10.2 — 全量启动回归**（3 分钟）

```bash
just dev
```

逐项核对：
- [ ] splash → 主窗口加载 Harness 页（无黑屏）
- [ ] 右键菜单出现（输入框/选区/链接/图片）
- [ ] 「关于」显示桌面 + 内置 Harness 双版本
- [ ] 关窗口进托盘，托盘「显示」恢复窗口
- [ ] 外链在外部浏览器打开
- [ ] DevTools 执行 `navigator.clipboard.writeText('x')` 成功（受信任剪贴板写）

**Step 10.3 — 平台特定行为核对**（3 分钟）

- **Windows**：确认 `gpu-fallback.json` 默认不存在（首启无降级）；`app.commandLine.appendSwitch` 在 default 级别为空集（零行为变化）。
- **macOS**：dock 图标聚焦别的应用后点 dock，窗口出现但不抢焦点（showInactive）；`launchd-guard` 对正常启动放行。
- **Linux**：所有 platform 分支走非 darwin 路径，行为与 Phase 1 一致。

**Step 10.4 — 烟雾测试**（2 分钟）

```bash
just smoke
```

期望：`ci-smoke.mjs` 启动 pinned dsh web、探针就绪、退出码 0。

**Step 10.5 — 提交**（2 分钟）

```bash
git add -A
git status
# 确认新增：src/gpu-fallback.ts src/main-window-recovery.ts src/context-menu.ts
#          src/context-menu-template.ts src/security.ts src/security-policy.ts
#          src/launchd-guard.ts src/window-raise.ts src/version-info.ts
#          src/windows-menu-view.ts
# 确认修改：src/main.ts src/safe-mode.ts
git commit -m "feat(phase2): fuse dataelement stability features

- gpu-fallback: Windows GPU sandbox degradation state machine
- main-window-recovery: throttled reload after renderer/GPU crash
- context-menu: native copy/paste/select-all/link/image menu
- security: trusted clipboard write (clipboard-sanitized-write)
- launchd-guard: ignore rogue LaunchAgent daemonised instances
- window-raise: macOS focus-steal prevention on automatic raise
- safe-mode: detect rc.8 slot conflicts in findCulprit
- version-info: show bundled Harness version in About
- windows-menu-view: geometry + splash zoom isolation"
```

- [x] Task 10 完成：全量编译通过；启动回归全绿；平台特定行为核对通过；烟雾测试通过；提交完成。

---

## 自检清单

### 文件清单核对

- [ ] `src/gpu-fallback.ts` 存在，导出 `GpuFallbackState`/`gpuFallbackSwitches`/`planGpuFallbackResponse`/`planStableLaunch`/`parseGpuFallbackState`/`serializeGpuFallbackState`/`gpuFallbackStateEquals`/`isGpuLossFatal`/`defaultGpuFallbackState`
- [ ] `src/main-window-recovery.ts` 存在，导出 `shouldReloadAfterMainWindowRendererLoss`/`MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS`/`MAIN_WINDOW_RECOVERY_MAX_RELOADS`
- [ ] `src/context-menu.ts` 存在，导出 `installContextMenu`
- [ ] `src/context-menu-template.ts` 存在，导出 `buildContextMenuTemplate`/`ContextMenuHandlers`
- [ ] `src/security.ts` 存在，导出 `secureWindow`
- [ ] `src/security-policy.ts` 存在，导出 `isTrustedAppUrl`/`canGrantWindowPermission`
- [ ] `src/launchd-guard.ts` 存在，导出 `isDaemonLaunch`/`isUserInitiatedInstance`
- [ ] `src/window-raise.ts` 存在，导出 `raiseWindowWithoutStealingFocus`/`WindowFocusIntent`
- [ ] `src/version-info.ts` 存在，导出 `bundledHarnessVersion`/`aboutDetail`
- [ ] `src/windows-menu-view.ts` 存在，导出 `windowsMenuViewBounds`/`lockZoomFactor`/`WINDOWS_TITLEBAR_HEIGHT`

### 接线核对（`src/main.ts`）

- [ ] `app.commandLine.appendSwitch` 在 `app.whenReady()` 之前调用（GPU 开关）
- [ ] `createWindow` 调 `secureWindow(win)`（替换内联 handler）
- [ ] `createWindow` 调 `installContextMenu(win, …)`
- [ ] `createWindow` 装配 `render-process-gone`/`did-fail-load`/`unresponsive` 监听
- [ ] `createWindow` 装配 `did-finish-load` 首渲染 + `planStableLaunch`
- [ ] `createSplash` 调 `lockZoomFactor`
- [ ] `setupAppMenu` 的 About 调 `showAbout()` → `aboutDetail`
- [ ] `second-instance` 用 `isDaemonLaunch`/`isUserInitiatedInstance` 守卫 + `raiseWindowWithoutStealingFocus`
- [ ] `activate` 用 `showWindow(port, 'automatic')`
- [ ] 托盘「显示」/click 用 `showWindow(port, 'user')`
- [ ] `proposeRecovery` 有 `slot-conflict` 分支

### 安全与约束核对

- [ ] **无新运行时依赖**：`package.json` 的 `dependencies`/`devDependencies` 未变（9 特性全用 Electron 内置 + `node:*`）
- [ ] **ESM 导入带 `.js` 后缀**：所有新模块的本地导入为 `from './xxx.js'`
- [ ] **无注释外泄密钥**：无任何 token/key/密码写入代码或日志
- [ ] **pnpm 不变 npm**：未引入 `package-lock.json`，`pnpm-lock.yaml` 未因新依赖变动
- [ ] **asarUnpack 不变**：`electron-builder.yml` 的 `asarUnpack: node_modules/**` 未动
- [ ] **strict 通过**：`just build` 零错误

### 行为回归核对

- [ ] 默认 GPU 级别（default）零行为变化（无开关、无状态文件）
- [ ] 渲染器崩溃后限流重载（≤3 次、5s 冷却）
- [ ] 右键菜单在可编辑/选区/链接/图片场景生效
- [ ] 主框架 Harness 源 `clipboard-sanitized-write` 放行
- [ ] macOS 守护进程/合成启动被忽略
- [ ] macOS 自动唤起不抢焦点
- [ ] slot 冲突被识别并走专门对话框
- [ ] 关于对话框显示双版本
- [ ] splash 缩放锁定、原生菜单不受页面缩放影响

### 已知边界（非占位符，需实测确认）

- [ ] **slot 冲突正则**：`/slot "([^"]+)" (?:conflict|duplicate|already (?:registered|provided|occupied|taken))/i` 基于 cordis 插槽语义推断。rc.8 真实崩溃日志到手后，若错误措辞不同，按实际日志调整该正则——这是日志模式匹配的常规校准，不影响其余 8 项特性。
- [ ] **GPU 降级实测**：`render-process-gone` 的 `details.reason` 在 Electron 43 下取值集合（`oom`/`crashed`/`clean-exit`/`killed`/…）以实测为准；`isGpuLossFatal` 已把 `clean-exit`/`killed` 列为可存活，其余视为致命，与 dataelement 一致。
- [ ] **macOS 未签名**：`launchd-guard`/`window-raise` 不依赖签名，纯运行时判定；签名公证不在 Phase 2 范围。
