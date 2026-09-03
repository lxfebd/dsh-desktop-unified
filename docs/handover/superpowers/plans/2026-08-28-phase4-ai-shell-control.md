# Phase 4 实施计划：AI 外壳控制创新层

> 日期：2026-08-28
> 项目：`d:\deepseekhar\dsh-desktop-unified`（fork 自 foolgry/dsh-desktop 的 DeepSeek Harness 桌面壳）
> 设计依据：`d:\deepseekhar\docs\superpowers\specs\2026-08-26-shell-control-design.md`
> 前置：Phase 1（基底）/ Phase 2（稳定性）/ Phase 3（安全）已完成
> 范围：让 dsh 内置 AI 能"随时"修改 Electron 外壳本身——窗口图标、边框模式、透明度、置顶、尺寸/状态。这是所有竞品都没有的"AI 能改外壳"能力（竞品是"外壳是外壳，AI 是 AI"）。

---

## Goal（目标）

为 dsh-desktop-unified 新增一个独创的 **AI 外壳控制创新层**，由两部分组成：

1. **Electron 主进程内的 shell-control 本地控制服务**（HTTP，只监听 `127.0.0.1`，端口回退 + 落盘）——把 `BrowserWindow` 的图标 / 边框 / 透明度 / 置顶 / 尺寸 / 状态能力暴露为可控接口。
2. **dsh 插件 `dsh-shell-control`**（预置）——在 dsh 进程内注册 8 个 AI 工具（`set_icon` / `switch_frameless` / `set_window_opacity` / `toggle_always_on_top` / `minimize` / `maximize` / `set_size` / `get_window_state`），并在 dsh 侧边栏注入"外壳控制"面板。AI 工具与手动面板共用同一套 `/api/shell/*` 接口。

交付后，用户对 dsh 说"把窗口改成无边框、透明度调到 0.85、换 build/icon.png 这个图标"，AI 即可调用工具修改外壳本身，无需重启、无需改源码。

---

## Architecture（架构）

### 进程拓扑与数据流

```
┌─ dsh 进程（Node，web server @ 127.0.0.1:3080+）──────────────────────┐
│  用户："改成无边框 + 透明度 0.85"                                      │
│        ↓                                                             │
│  [dsh-shell-control 插件]                                            │
│   host(lib/index.js)：8 个 AI 工具 + /api/shell/* 代理路由           │
│   client(lib/client.js)：侧边栏「外壳控制」面板（手动操作）          │
└──────────┬──────────────────────────┬───────────────────────────────┘
           │ ① AI 工具：服务端 fetch       │ ② 面板：同源 /api/shell/*（插件代理）
           │   http://127.0.0.1:<port>      │   → host 代理 → fetch 3177
           ▼                                 ▼
┌─ Electron 主进程（src/shell-control.ts）─────────────────────────────┐
│  [shell-control HTTP 服务]  只监听 127.0.0.1，端口 3177→3189 回退     │
│   落盘 dsh-home/shell/control-port.json 供插件发现实际端口            │
│   GET  /api/shell/state          窗口状态（位置/大小/最大化/全屏/…）  │
│   POST /api/shell/window         minimize / maximize / set_size      │
│   POST /api/shell/opacity        setOpacity（0.2–1.0）                │
│   POST /api/shell/always-on-top  setAlwaysOnTop                       │
│   POST /api/shell/frameless      重建窗口（frame: !frameless）        │
│   GET/POST /api/shell/icon       读 / 应用图标（build/ 白名单）       │
│   POST /api/shell/icon/reset     恢复默认图标                         │
│        ↓                                                             │
│  BrowserWindow.setIcon / setOpacity / setAlwaysOnTop / setSize /     │
│  recreateWindow(frame) + preload 自绘标题栏 + shell-icon.ts(PNG→ICO,│
│  持久化, 改 .lnk 快捷方式, 启动恢复)                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### 关键设计决策

- **跨进程通信用 HTTP，不用 Electron IPC**：dsh 是独立 Node 子进程，无法直接用 Electron IPC；插件（服务端）直接 `fetch` 回环 shell-control 端口；面板（浏览器侧）走同源 `/api/shell/*`，由插件 host 代理到 shell-control，避免跨端口 CORS。
- **shell-control 服务跑在 Electron 主进程**：与 `mainWindow` 同生命周期，路由内直接拿 `mainWindow` 操作；窗口未就绪时返回 `503`。
- **端口回退 + 落盘**：`3177` 被占则探测 `3178…3189`，实际端口写入 `dsh-home/shell/control-port.json`；dsh 与 Electron 共享 `DSH_HOME`（`main.ts` 的 `startDsh` 已注入 `DSH_HOME=dshHome()`），插件读此文件即可发现端口。
- **无边框 = 重建窗口**：Electron 的 `frame` 不可运行时改，`switch_frameless` 走 `recreateWindow(prefs)`——保留几何 + 端口 + 图标，销毁旧窗后按新 `frame` 建新窗，并通过 `webContents.send('shell:frameless', bool)` 让 preload 注入/移除自绘标题栏。
- **图标安全白名单**：`set_icon(path)` 的 `path` 必须解析到应用 `build/` 目录内（`icon.png` / `icon.ico` / `icon.icns` 等），服务端 `isInsideBuild()` 校验，杜绝路径穿越。
- **持久化**：`shell/prefs.json`（frameless/opacity/alwaysOnTop）、`shell/icon/{current.png,current.ico,meta.json}`（图标），启动时 `ensureShellIcon()` + `applyPrefs()` 恢复，重启保留。

---

## Tech Stack（技术栈）

| 维度 | 选择 | 说明 |
|------|------|------|
| 外壳语言 | TypeScript（ESM，`NodeNext`，`strict`） | `tsconfig.json`：`outDir: dist`，`rootDir: src`，`include: src/**/*.ts`，新 `src/*.ts` 自动编译 |
| 外壳运行时 | Electron 43 | `frame`/`setIcon`/`setOpacity`/`setAlwaysOnTop`/`setSize`/`getBounds`/`nativeImage`/`contextBridge` |
| 控制服务 | `node:http` + `node:net`（探测端口） | 主进程内 HTTP 服务，仅监听 `127.0.0.1` |
| 插件格式 | dsh 插件（`dsh.bundle.patch` + `dsh.client.inject`） | 镜像 `dsh-plugin-market` / `dsh-plugin-version-manager` |
| 插件 host | ESM，`inject: ['webServer','tools']` | `ctx.tools.register(defineTool(...))` + `ctx.webServer.register(route(...))` |
| 插件 client | `window.__ModuleLoader__.load` 工厂 + React + `ui-primitives` | 侧边栏 `sidebar.footer.action` 槽位注入面板 |
| 图标 | `nativeImage`（PNG→多尺寸 ICO，纯 node）+ PowerShell（改 `.lnk`，仅 Windows） | 运行时可改窗口/任务栏图标 + 快捷方式图标；exe 图标不改（需重打包） |
| 构建/任务 | `just`（`justfile`）+ pnpm 11.22.0（hoisted） | 改完 `just build` 验类型，`just dev` 实跑 |
| 打包 | electron-builder 26 | `node_modules/**` 已 `asarUnpack`，插件作为 `file:plugins/...` 依赖被 hoisted + 解包，无需改 `electron-builder.yml` |

---

## 前置约定

- 所有新 `src/*.ts` 自动被 `tsconfig.json` 的 `include: src/**/*.ts` 收录，`just build`（= `tsc`）输出到 `dist/`，`package.json` 的 `main: dist/main.js` 已对齐。
- `dist/` 被 `electron-builder.yml` 的 `files: dist/**` 收录，preload 落在 `dist/preload.js`（asar 内可读，不需解包）。
- 插件以 `"dsh-shell-control": "file:plugins/dsh-shell-control"` 形式加入根 `package.json` 依赖，`pnpm install` 后被 hoisted 到 `node_modules/dsh-shell-control`，与 `dsh-plugin-market` 同链路。
- 命令统一用 `just`（Windows 上需 `just` 已安装；无 `just` 时等价命令为 `pnpm build` / `pnpm dev`）。

---

## Task 1：搭建 dsh-shell-control 插件骨架

**Files（创建）**
- `plugins/dsh-shell-control/package.json`
- `plugins/dsh-shell-control/cordis.patch.yml`
- `plugins/dsh-shell-control/lib/index.js`（host，本任务先放最小骨架）
- `plugins/dsh-shell-control/lib/client.js`（client，本任务先放最小骨架）

**Steps**

- [ ] **1.1** 创建 `plugins/dsh-shell-control/package.json`，镜像 `dsh-plugin-market/package.json` 的 `dsh.bundle.patch` + `dsh.client.inject` + `exports` 结构：
  ```json
  {
    "name": "dsh-shell-control",
    "description": "DeepSeek Harness 外壳控制插件：把 Electron 外壳的图标/边框/透明度/置顶/尺寸/状态暴露给内置 AI 与侧边栏面板，让 AI 能修改外壳本身。host 注册 8 个 AI 工具 + /api/shell/* 代理路由；client 注入侧边栏「外壳控制」面板。走官方 webServer+tools 服务与 ctx.slots.register 侧边栏槽位。",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "main": "lib/index.js",
    "exports": {
      ".": { "default": "./lib/index.js" },
      "./client": { "default": "./lib/client.js" },
      "./cordis.patch.yml": "./cordis.patch.yml",
      "./package.json": "./package.json"
    },
    "files": ["lib", "cordis.patch.yml"],
    "dsh": {
      "bundle": { "patch": "./cordis.patch.yml" },
      "client": {
        "inject": [
          "@deepseek-ai/dsh-client-runtime",
          "@deepseek-ai/dsh-client-locale",
          "@deepseek-ai/dsh-client-ui-slots",
          "@deepseek-ai/dsh-client-ui-sidebar"
        ],
        "platform": "web"
      }
    },
    "license": "MIT"
  }
  ```

- [ ] **1.2** 创建 `plugins/dsh-shell-control/cordis.patch.yml`（host 声明 `inject: [webServer, tools]`，与 `dsh-plugin-market` 一致）：
  ```yaml
  # dsh-shell-control bundle patch — inserted after the dsh-web-app layer.
  #
  # 一行 host：注册 /api/shell/* 代理路由（转发到 Electron 壳的 shell-control 服务）
  # + 注册 8 个 shell_* AI 工具，让内置 AI 能修改外壳本身。webServer 提供代理路由，
  # tools 提供 AI 工具注册，二者均由 dsh-web-app bundle 层提供，故该行等待它们就绪。
  - insert:
      - id: dsh-shell-control
        name: dsh-shell-control
        inject: [webServer, tools]
  ```

- [ ] **1.3** 创建 `plugins/dsh-shell-control/lib/index.js` 最小 host 骨架（Task 7 填充工具与代理）：
  ```js
  // dsh-shell-control · 插件入口（host 面）
  // 注册 8 个 AI 工具 + /api/shell/* 代理路由（转发到 Electron 壳的 shell-control 服务）。
  export const name = 'dsh-shell-control'
  export const inject = ['webServer', 'tools']

  export function apply(ctx) {
    ctx.logger?.info?.('[dsh-shell-control] mounted (skeleton)')
  }
  ```

- [ ] **1.4** 创建 `plugins/dsh-shell-control/lib/client.js` 最小 client 骨架（Task 8 填充面板）：
  ```js
  window.__ModuleLoader__.load({
    id: "dsh-shell-control",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      var inject = ["slots", "locale"];
      function apply(ctx) {
        ctx.logger?.info?.("[dsh-shell-control] client mounted (skeleton)");
      }
      exports.apply = apply;
      exports.inject = inject;
      return module.exports;
    }
  });
  ```

- [ ] **1.5** 把插件加为根依赖并安装（hoisted）：
  ```bash
  # 在仓库根 d:\deepseekhar\dsh-desktop-unified
  pnpm add "dsh-shell-control@file:plugins/dsh-shell-control"
  ```
  确认 `node_modules/dsh-shell-control` 存在（pnpm hoisted）。

---

## Task 2：Electron shell-control HTTP 服务骨架 + CORS

**Files（创建）**
- `src/shell-control.ts`

**Files（修改）**
- 无（本任务只建独立模块，Task 6 接线到 `main.ts`）

**Steps**

- [ ] **2.1** 创建 `src/shell-control.ts`：端口回退（`3177→3189`）、落盘 `control-port.json`、`node:http` 服务、CORS 头、`sendJson` / `readBody` / `safe` / 路由表骨架。
  ```ts
  /**
   * Electron 主进程内的 shell-control 本地控制服务。
   * 只监听 127.0.0.1，端口 3177→3189 回退，实际端口落盘 dsh-home/shell/control-port.json。
   * 把 BrowserWindow 的图标/边框/透明度/置顶/尺寸/状态暴露为 /api/shell/* HTTP 接口，
   * 供 dsh 插件（跨进程）与侧边栏面板（同源代理）调用。
   * @module dsh-desktop/shell-control
   */
  import { app, BrowserWindow, nativeImage } from 'electron'
  import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
  import { createServer as createNetServer } from 'node:net'
  import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
  import { join } from 'node:path'
  import { applyShellIcon, readIconMeta, resetShellIcon, ensureShellIcon } from './shell-icon.js'

  const FIRST_PORT = 3177
  const LAST_PORT = 3189

  /** dsh 状态目录（与 dsh 子进程共享 DSH_HOME）。 */
  function dshHome(): string {
    return join(app.getPath('userData'), 'dsh-home')
  }
  function shellDir(): string {
    const d = join(dshHome(), 'shell')
    mkdirSync(d, { recursive: true })
    return d
  }
  function portFile(): string {
    return join(shellDir(), 'control-port.json')
  }
  function prefsFile(): string {
    return join(shellDir(), 'prefs.json')
  }
  function logFile(): string {
    return join(app.getPath('userData'), 'logs', 'dsh.log')
  }

  /** 持久化的外壳偏好（重启恢复）。 */
  export interface ShellPrefs {
    frameless: boolean
    opacity: number
    alwaysOnTop: boolean
  }
  const DEFAULT_PREFS: ShellPrefs = { frameless: false, opacity: 1, alwaysOnTop: false }

  export function loadPrefs(): ShellPrefs {
    try {
      return { ...DEFAULT_PREFS, ...JSON.parse(readFileSync(prefsFile(), 'utf8')) as Partial<ShellPrefs> }
    } catch {
      return { ...DEFAULT_PREFS }
    }
  }
  export function savePrefs(p: ShellPrefs): void {
    writeFileSync(prefsFile(), JSON.stringify(p) + '\n')
  }

  let server: Server | undefined
  let boundPort = 0
  /** 取实际监听端口（供 main.ts 落盘/日志；插件读 control-port.json 发现）。 */
  export function currentPort(): number {
    return boundPort
  }

  function sendJson(res: ServerResponse, code: number, obj: unknown): void {
    const body = JSON.stringify(obj)
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cache-Control': 'no-store',
      'Content-Length': Buffer.byteLength(body),
    })
    res.end(body)
  }

  function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve) => {
      let body = ''
      req.on('data', (c: Buffer) => { body += c })
      req.on('end', () => {
        try { resolve(body ? JSON.parse(body) : {}) } catch { resolve({}) }
      })
      req.on('error', () => resolve({}))
    })
  }

  /** 路由上下文：注入窗口取值器与重建回调，避免循环依赖 main.ts。 */
  interface RouteCtx {
    req: IncomingMessage
    res: ServerResponse
    url: URL
    win: BrowserWindow | undefined
    recreate: (prefs: ShellPrefs) => void
  }
  type Handler = (ctx: RouteCtx) => Promise<void> | void

  function safe(handler: Handler): (ctx: RouteCtx) => Promise<void> {
    return async (ctx) => {
      try {
        await handler(ctx)
      } catch (e) {
        if (ctx.res.headersSent) { ctx.res.destroy(); return }
        sendJson(ctx.res, 500, { error: e instanceof Error ? e.message : String(e) })
      }
    }
  }

  function clampInt(v: unknown, min: number, max: number, def: number): number {
    const n = Math.floor(Number(v))
    if (!Number.isFinite(n)) return def
    return Math.min(max, Math.max(min, n))
  }
  function clampNum(v: unknown, min: number, max: number, def: number): number {
    const n = Number(v)
    if (!Number.isFinite(n)) return def
    return Math.min(max, Math.max(min, n))
  }

  // 路由表在 Task 3/4/5 填充，这里先放占位实现以保证骨架可编译。
  const ROUTES: Record<string, (ctx: RouteCtx) => Promise<void>> = {
    '/api/shell/state': safe(async (ctx) => {
      const { win, res } = ctx
      if (!win || win.isDestroyed()) return sendJson(res, 503, { error: 'window unavailable' })
      const b = win.getBounds()
      sendJson(res, 200, {
        bounds: b,
        maximized: win.isMaximized(),
        minimized: win.isMinimized(),
        fullscreen: win.isFullScreen(),
        alwaysOnTop: win.isAlwaysOnTop(),
        opacity: win.getOpacity(),
        frameless: loadPrefs().frameless,
      })
    }),
  }

  /** 探测一个可绑定的回环端口。 */
  function isFree(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const probe = createNetServer()
      probe.once('error', () => resolve(false))
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
    })
  }
  async function pickPort(): Promise<number> {
    for (let p = FIRST_PORT; p <= LAST_PORT; p++) {
      if (await isFree(p)) return p
    }
    throw new Error(`no free shell-control port between ${FIRST_PORT} and ${LAST_PORT}`)
  }

  /**
   * 启动 shell-control 服务。getWindow 返回当前主窗口（可能为空），
   * recreate 在 switch_frameless 时由 main.ts 提供以重建窗口。
   */
  export async function startShellControl(
    getWindow: () => BrowserWindow | undefined,
    recreate: (prefs: ShellPrefs) => void,
  ): Promise<void> {
    const port = await pickPort()
    boundPort = port
    writeFileSync(portFile(), JSON.stringify({ port, startedAt: new Date().toISOString() }) + '\n')
    server = createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        })
        res.end()
        return
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const handler = ROUTES[url.pathname]
      const ctx: RouteCtx = { req, res, url, win: getWindow(), recreate }
      if (!handler) return sendJson(res, 404, { error: 'not found: ' + url.pathname })
      safe(handler)(ctx).catch(() => { /* safe 已处理 */ })
    })
    server.listen(port, '127.0.0.1')
    appendFileSync(logFile(), `\n=== shell-control listening on 127.0.0.1:${port} ===\n`)
  }

  /** 停止服务（退出时清理）。 */
  export function stopShellControl(): void {
    if (server) { server.close(); server = undefined }
  }

  // 便于 Task 3/4/5 在本文件内追加路由：把工具函数与类型再导出一次。
  export const __internals = { sendJson, readBody, safe, clampInt, clampNum, ROUTES, ensureShellIcon }
  ```

- [ ] **2.2** 验证类型编译（此时 `shell-icon.js` 尚未创建，会报缺依赖；先空跑确认本文件无自身语法错，Task 5 补齐 `shell-icon.ts` 后再统一编译）：
  ```bash
  # 仅确认 shell-control.ts 自身语法（允许暂时的未解析导入报错）
  just build 2>&1 | Select-String "shell-control"
  ```
  预期：除 `Cannot find module './shell-icon.js'` 外无其它语法错误。

---

## Task 3：窗口操作路由（state / window / opacity / always-on-top）

**Files（修改）**
- `src/shell-control.ts`（向 `ROUTES` 追加 4 条路由）

**Steps**

- [ ] **3.1** 在 `src/shell-control.ts` 的 `ROUTES` 对象内追加 `/api/shell/window`（minimize / maximize / set_size）：
  ```ts
  '/api/shell/window': safe(async (ctx) => {
    const { req, res, win } = ctx
    if (!win || win.isDestroyed()) return sendJson(res, 503, { error: 'window unavailable' })
    const body = await readBody(req)
    const action = String(body.action ?? '')
    if (action === 'minimize') {
      win.minimize()
      return sendJson(res, 200, { ok: true, minimized: true })
    }
    if (action === 'maximize') {
      const next = win.isMaximized() ? false : true
      if (next) win.maximize(); else win.unmaximize()
      return sendJson(res, 200, { ok: true, maximized: next })
    }
    if (action === 'set_size') {
      const w = clampInt(body.w, 800, 4000, 1280)
      const h = clampInt(body.h, 600, 4000, 800)
      win.setSize(w, h)
      return sendJson(res, 200, { ok: true, bounds: win.getBounds() })
    }
    sendJson(res, 400, { error: 'unknown action: ' + action })
  }),
  ```

- [ ] **3.2** 追加 `/api/shell/opacity`（持久化到 `prefs.json`）：
  ```ts
  '/api/shell/opacity': safe(async (ctx) => {
    const { req, res, win } = ctx
    if (!win || win.isDestroyed()) return sendJson(res, 503, { error: 'window unavailable' })
    const body = await readBody(req)
    const o = clampNum(body.opacity, 0.2, 1, 1)
    win.setOpacity(o)
    const p = loadPrefs(); p.opacity = o; savePrefs(p)
    sendJson(res, 200, { ok: true, opacity: o })
  }),
  ```

- [ ] **3.3** 追加 `/api/shell/always-on-top`（持久化）：
  ```ts
  '/api/shell/always-on-top': safe(async (ctx) => {
    const { req, res, win } = ctx
    if (!win || win.isDestroyed()) return sendJson(res, 503, { error: 'window unavailable' })
    const body = await readBody(req)
    const on = body.on === true
    win.setAlwaysOnTop(on)
    const p = loadPrefs(); p.alwaysOnTop = on; savePrefs(p)
    sendJson(res, 200, { ok: true, alwaysOnTop: on })
  }),
  ```

- [ ] **3.4** 编译验证：
  ```bash
  just build 2>&1 | Select-String "shell-control"
  ```
  预期：仅剩 `shell-icon.js` 未解析导入；本任务新增路由无类型错误（`clampInt`/`clampNum` 已在 Task 2 定义）。

---

## Task 4：无边框切换 + preload 自绘标题栏

**Files（创建）**
- `src/preload.ts`

**Files（修改）**
- `src/shell-control.ts`（追加 `/api/shell/frameless` 路由）
- `src/main.ts`（`createWindow` 接受 prefs + preload + 重建 + IPC + `did-finish-load` 推送 frameless）

**Steps**

- [ ] **4.1** 创建 `src/preload.ts`：通过 `contextBridge` 暴露 `window.shell`（标题栏三按钮 + 状态查询 + 最大化/无边框事件），并在收到 `shell:frameless` 时注入/移除自绘标题栏覆盖层（仅 `frame:false` 时显示，避免遮挡 dsh UI）。
  ```ts
  /**
   * 渲染进程 preload：暴露 window.shell 给自绘标题栏按钮调用，并在 frameless 模式
   * 注入一个 36px 高、fixed 定位、最高 z-index 的拖拽标题栏 + 三按钮（最小化/最大化/关闭）。
   * @module dsh-desktop/preload
   */
  import { contextBridge, ipcRenderer } from 'electron'

  contextBridge.exposeInMainWorld('shell', {
    minimize: () => ipcRenderer.send('shell:window', { action: 'minimize' }),
    toggleMaximize: () => ipcRenderer.send('shell:window', { action: 'toggle-maximize' }),
    close: () => ipcRenderer.send('shell:window', { action: 'close' }),
    getState: () => ipcRenderer.invoke('shell:get-state'),
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
      const h = (_: unknown, v: boolean) => cb(v)
      ipcRenderer.on('shell:maximized', h)
      return () => ipcRenderer.removeListener('shell:maximized', h)
    },
    onFramelessChange: (cb: (frameless: boolean) => void) => {
      const h = (_: unknown, v: boolean) => cb(v)
      ipcRenderer.on('shell:frameless', h)
      return () => ipcRenderer.removeListener('shell:frameless', h)
    },
  })

  const TITLEBAR_ID = 'dsh-shell-titlebar'

  ipcRenderer.on('shell:frameless', (_e, frameless: boolean) => {
    if (frameless) injectTitlebar()
    else removeTitlebar()
  })

  function injectTitlebar(): void {
    if (document.getElementById(TITLEBAR_ID)) return
    const ready = () => buildTitlebar()
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready)
    else ready()
  }

  function buildTitlebar(): void {
    if (document.getElementById(TITLEBAR_ID)) return
    const bar = document.createElement('div')
    bar.id = TITLEBAR_ID
    bar.setAttribute('style', [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'height:36px', 'z-index:2147483647',
      'display:flex', 'align-items:center', 'justify-content:flex-end',
      'padding:0 8px', 'box-sizing:border-box',
      '-webkit-app-region:drag', 'user-select:none',
      'background:rgba(13,15,20,.72)', 'backdrop-filter:blur(8px)',
      'font:12px -apple-system,"Segoe UI",sans-serif', 'color:#e6e6e6',
    ].join(';'))
    const mkBtn = (label: string, action: string) => {
      const b = document.createElement('button')
      b.textContent = label
      b.setAttribute('style', '-webkit-app-region:no-drag;border:none;background:transparent;color:#e6e6e6;width:40px;height:28px;cursor:pointer;font-size:14px;')
      b.addEventListener('click', () => ipcRenderer.send('shell:window', { action }))
      return b
    }
    const mkToggle = () => {
      const b = document.createElement('button')
      b.textContent = '▢'
      b.setAttribute('style', '-webkit-app-region:no-drag;border:none;background:transparent;color:#e6e6e6;width:40px;height:28px;cursor:pointer;font-size:12px;')
      b.addEventListener('click', () => ipcRenderer.send('shell:window', { action: 'toggle-maximize' }))
      ipcRenderer.on('shell:maximized', (_e, m: boolean) => { b.textContent = m ? '⧉' : '▢' })
      return b
    }
    bar.appendChild(mkBtn('—', 'minimize'))
    bar.appendChild(mkToggle())
    bar.appendChild(mkBtn('✕', 'close'))
    document.body.appendChild(bar)
  }

  function removeTitlebar(): void {
    document.getElementById(TITLEBAR_ID)?.remove()
  }
  ```

- [ ] **4.2** 在 `src/shell-control.ts` 的 `ROUTES` 追加 `/api/shell/frameless`（写 prefs → 调 `recreate` 重建窗口）：
  ```ts
  '/api/shell/frameless': safe(async (ctx) => {
    const { req, res, recreate } = ctx
    const body = await readBody(req)
    const frame = body.frame === true // true=有边框, false=无边框
    const p = loadPrefs()
    p.frameless = !frame
    savePrefs(p)
    recreate(p)
    sendJson(res, 200, { ok: true, frameless: p.frameless })
  }),
  ```

- [ ] **4.3** 修改 `src/main.ts`：导入 prefs + preload 路径，把 `createWindow` 改为接受 prefs 并应用 `frame` / `opacity` / `alwaysOnTop` / `preload`，在 `did-finish-load` 推送 `shell:frameless`，并转发 `maximize`/`unmaximize` 事件。在文件顶部导入区追加：
  ```ts
  import { ipcMain } from 'electron'
  import { loadPrefs, type ShellPrefs, startShellControl, stopShellControl, ensureShellIconFromMain } from './shell-control.js'
  ```
  （`ensureShellIconFromMain` 是 `shell-icon.ts` 导出的薄封装，见 Task 5。）

- [ ] **4.4** 修改 `src/main.ts` 的 `createWindow`（替换原 `createWindow(port)`）：
  ```ts
  let recreating = false

  function createWindow(port: number, prefs: ShellPrefs = loadPrefs()): BrowserWindow {
    const saved = loadWindowState()
    const win = new BrowserWindow({
      width: saved?.width ?? 1280,
      height: saved?.height ?? 800,
      ...(saved === undefined ? {} : { x: saved.x, y: saved.y }),
      minWidth: 800,
      minHeight: 600,
      frame: !prefs.frameless,
      title: 'DSH Desktop',
      autoHideMenuBar: true,
      icon: devIcon(),
      alwaysOnTop: prefs.alwaysOnTop,
      webPreferences: {
        preload: join(app.getAppPath(), 'dist', 'preload.js'),
        contextIsolation: true,
      },
    })
    if (prefs.opacity < 1) win.setOpacity(prefs.opacity)
    if (saved?.maximized) win.maximize()
    let saveTimer: NodeJS.Timeout | undefined
    const persist = (): void => {
      if (saveTimer !== undefined) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = undefined
        if (!win.isDestroyed()) saveWindowState(win)
      }, 300)
    }
    win.on('resize', persist)
    win.on('move', persist)
    win.on('close', (event) => {
      if (quitting || recreating) return
      event.preventDefault()
      win.hide()
    })
    win.on('maximize', () => { if (!win.isDestroyed()) win.webContents.send('shell:maximized', true) })
    win.on('unmaximize', () => { if (!win.isDestroyed()) win.webContents.send('shell:maximized', false) })
    win.webContents.on('did-finish-load', () => {
      if (!win.isDestroyed()) win.webContents.send('shell:frameless', prefs.frameless)
    })
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (!url.startsWith('http://127.0.0.1:')) void shell.openExternal(url)
      return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (event, url) => {
      if (!url.startsWith('http://127.0.0.1:')) {
        event.preventDefault()
        void shell.openExternal(url)
      }
    })
    void win.loadURL(`http://127.0.0.1:${port}/`)
    return win
  }
  ```

- [ ] **4.5** 在 `src/main.ts` 新增 `recreateWindow`（保留几何 + 端口 + 图标，按新 prefs 重建，绕过 close-to-tray）：
  ```ts
  function recreateWindow(prefs: ShellPrefs): void {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const port = serverPort
    recreating = true
    try {
      saveWindowState(mainWindow)
      mainWindow.destroy()
      mainWindow = createWindow(port, prefs)
      ensureShellIconFromMain(mainWindow)
    } finally {
      recreating = false
    }
  }
  ```

- [ ] **4.6** 在 `src/main.ts` 注册 IPC（标题栏按钮 + 状态查询），在 `app.whenReady().then` 内、`boot()` 之前调用一次：
  ```ts
  function registerShellIpc(): void {
    ipcMain.on('shell:window', (_e, body: { action: string }) => {
      const win = mainWindow
      if (!win || win.isDestroyed()) return
      if (body.action === 'minimize') win.minimize()
      else if (body.action === 'toggle-maximize') win.isMaximized() ? win.unmaximize() : win.maximize()
      else if (body.action === 'close') { quitting = true; win.close(); app.quit() }
    })
    ipcMain.handle('shell:get-state', () => {
      const win = mainWindow
      if (!win || win.isDestroyed()) return { error: 'window unavailable' }
      const b = win.getBounds()
      return {
        bounds: b, maximized: win.isMaximized(), minimized: win.isMinimized(),
        fullscreen: win.isFullScreen(), alwaysOnTop: win.isAlwaysOnTop(),
        opacity: win.getOpacity(), frameless: loadPrefs().frameless,
      }
    })
  }
  ```

- [ ] **4.7** 编译验证：
  ```bash
  just build
  ```
  预期：`dist/preload.js`、`dist/shell-control.js`、`dist/main.js` 均生成，无类型错误（`shell-icon.ts` 在 Task 5 补齐后全绿；本步允许 `shell-icon` 导入报错）。

---

## Task 5：图标系统（PNG→ICO + 持久化 + .lnk + 启动恢复）

**Files（创建）**
- `src/shell-icon.ts`

**Files（修改）**
- `src/shell-control.ts`（追加 `/api/shell/icon`、`/api/shell/icon/reset`；导出 `ensureShellIconFromMain`）

**Steps**

- [ ] **5.1** 创建 `src/shell-icon.ts`：图标目录 `dsh-home/shell/icon/`、`isInsideBuild` 白名单校验、PNG→多尺寸 ICO（纯 node，嵌入 PNG 数据）、应用图标（`win.setIcon` + 持久化 `meta.json` + 改 `.lnk`）、`ensureShellIcon` 启动恢复。
  ```ts
  /**
   * 外壳图标系统：把 build/ 白名单内的图标应用到窗口/任务栏，持久化到
   * dsh-home/shell/icon/，并更新 Windows 快捷方式（.lnk）的 IconLocation。
   * PNG→多尺寸 ICO 用 nativeImage 纯 node 组装（不依赖 PowerShell）。
   * exe 文件图标不改（运行时不可改，需重打包）。
   * @module dsh-desktop/shell-icon
   */
  import { app, BrowserWindow, nativeImage } from 'electron'
  import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
  import { isAbsolute, join, relative, resolve } from 'node:path'
  import { spawnSync } from 'node:child_process'

  function dshHome(): string {
    return join(app.getPath('userData'), 'dsh-home')
  }
  function iconDir(): string {
    const d = join(dshHome(), 'shell', 'icon')
    mkdirSync(d, { recursive: true })
    return d
  }
  function currentPng(): string {
    return join(iconDir(), 'current.png')
  }
  function currentIco(): string {
    return join(iconDir(), 'current.ico')
  }
  function metaFile(): string {
    return join(iconDir(), 'meta.json')
  }
  function logFile(): string {
    return join(app.getPath('userData'), 'logs', 'dsh.log')
  }
  /** 应用 build/ 目录（dev 模式为源码 build/，打包后为 app.asar/build/）。 */
  function buildDir(): string {
    return join(app.getAppPath(), 'build')
  }

  export interface IconMeta {
    source: 'build' | 'default'
    fileName: string | null
    appliedAt: string | null
  }
  export function readIconMeta(): IconMeta {
    try {
      return { source: 'default', fileName: null, appliedAt: null, ...JSON.parse(readFileSync(metaFile(), 'utf8')) }
    } catch {
      return { source: 'default', fileName: null, appliedAt: null }
    }
  }

  /** 校验 path 解析到 build/ 目录内（防路径穿越）。 */
  function isInsideBuild(p: string): boolean {
    const abs = isAbsolute(p) ? p : resolve(p)
    const rel = relative(buildDir(), abs)
    return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
  }

  /** 用 nativeImage 把 PNG 缩放为多尺寸，组装成 ICO（嵌入 PNG 数据，Vista+ 支持）。 */
  function buildIcoFromPng(pngPath: string): { ok: boolean; error?: string } {
    try {
      const sizes = [16, 32, 48, 64, 128, 256]
      const base = nativeImage.createFromPath(pngPath)
      const blobs: { size: number; data: Buffer }[] = []
      for (const size of sizes) {
        const img = base.resize({ width: size, height: size })
        blobs.push({ size, data: img.toPNG() })
      }
      const count = blobs.length
      const header = Buffer.alloc(6)
      header.writeUInt16LE(0, 0)
      header.writeUInt16LE(1, 2)
      header.writeUInt16LE(count, 4)
      const dirSize = 16 * count
      const entries: Buffer[] = []
      const datas: Buffer[] = []
      let offset = 6 + dirSize
      for (const { size, data } of blobs) {
        const e = Buffer.alloc(16)
        e.writeUInt8(size >= 256 ? 0 : size, 0)
        e.writeUInt8(size >= 256 ? 0 : size, 1)
        e.writeUInt8(0, 2)
        e.writeUInt8(0, 3)
        e.writeUInt16LE(1, 4)
        e.writeUInt16LE(32, 6)
        e.writeUInt32LE(data.length, 8)
        e.writeUInt32LE(offset, 12)
        entries.push(e)
        datas.push(data)
        offset += data.length
      }
      writeFileSync(currentIco(), Buffer.concat([header, ...entries, ...datas]))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 改 Windows 快捷方式（桌面 / 开始菜单）的 IconLocation 指向 current.ico。 */
  function updateShortcuts(): { ok: boolean; applied: string[]; warning?: string } {
    if (process.platform !== 'win32') {
      return { ok: true, applied: [], warning: '非 Windows，跳过快捷方式' }
    }
    const home = app.getPath('home')
    const targets = [
      join(home, 'Desktop'),
      join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
      join('C:', 'ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    ].filter(existsSync)
    const ps =
      `$ws = New-Object -ComObject WScript.Shell\n` +
      targets.map((t) => `'${t.replace(/'/g, "''")}'`).join(',') +
      ` -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ` +
      `Where-Object { $_.Name -like '*DeepSeek*' -or $_.Name -like '*DSH*' } | ForEach-Object {\n` +
      `  $lnk = $ws.CreateShortcut($_.FullName)\n` +
      `  $lnk.IconLocation = "${currentIco()},0"\n` +
      `  $lnk.Save() }\n`
    try {
      spawnSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' })
      return { ok: true, applied: targets }
    } catch (e) {
      return { ok: false, applied: [], warning: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 应用图标：校验 build/ 白名单 → 存 current.png → 组装 current.ico → win.setIcon → 改快捷方式。 */
  export async function applyShellIcon(
    path: string | undefined,
    win: BrowserWindow | undefined,
  ): Promise<{ ok: boolean; applied?: string[]; warning?: string; error?: string }> {
    if (!path) return { ok: false, error: '缺少 path' }
    if (!isInsideBuild(path)) return { ok: false, error: '图标路径必须在 build/ 目录内' }
    const abs = isAbsolute(path) ? path : resolve(path)
    if (!existsSync(abs)) return { ok: false, error: '图标文件不存在: ' + abs }
    try {
      writeFileSync(currentPng(), readFileSync(abs))
    } catch (e) {
      return { ok: false, error: '写入 current.png 失败: ' + (e instanceof Error ? e.message : String(e)) }
    }
    const ico = buildIcoFromPng(currentPng())
    const meta: IconMeta = { source: 'build', fileName: abs, appliedAt: new Date().toISOString() }
    writeFileSync(metaFile(), JSON.stringify(meta, undefined, 2) + '\n')
    if (win && !win.isDestroyed()) {
      try {
        win.setIcon(nativeImage.createFromPath(currentPng()))
      } catch (e) {
        appendFileSync(logFile(), `\n=== setIcon failed: ${e instanceof Error ? e.message : String(e)} ===\n`)
      }
    }
    const sc = updateShortcuts()
    const applied = ['window', 'taskbar', 'shortcut']
    return {
      ok: true,
      applied,
      warning: !ico.ok ? 'ICO 转换失败，仅窗口/任务栏生效（' + ico.error + '）' : sc.warning,
    }
  }

  /** 恢复默认图标：删 meta + current，窗口恢复 devIcon（打包后为 baked-in 图标）。 */
  export async function resetShellIcon(
    win: BrowserWindow | undefined,
  ): Promise<{ ok: boolean; warning?: string }> {
    try {
      writeFileSync(metaFile(), JSON.stringify({ source: 'default', fileName: null, appliedAt: new Date().toISOString() }) + '\n')
    } catch { /* 忽略 */ }
    if (win && !win.isDestroyed()) {
      const di = devIconFile()
      if (di && existsSync(di)) {
        try { win.setIcon(nativeImage.createFromPath(di)) } catch { /* 忽略 */ }
      }
    }
    const sc = updateShortcuts()
    return { ok: true, warning: sc.warning }
  }

  function devIconFile(): string | undefined {
    const f = join(app.getAppPath(), 'build', 'icon.png')
    return existsSync(f) ? f : undefined
  }

  /** 启动恢复：读 meta，有自定义图标则 win.setIcon 恢复 + 同步快捷方式。 */
  export function ensureShellIcon(win: BrowserWindow | undefined): void {
    const meta = readIconMeta()
    if (meta.source === 'default' || !existsSync(currentPng())) return
    if (win && !win.isDestroyed()) {
      try { win.setIcon(nativeImage.createFromPath(currentPng())) } catch { /* 忽略 */ }
    }
    updateShortcuts()
  }
  ```

- [ ] **5.2** 在 `src/shell-control.ts` 把占位导入补全为真实命名导入（替换 Task 2 的导入行）：
  ```ts
  import { applyShellIcon, readIconMeta, resetShellIcon, ensureShellIcon } from './shell-icon.js'
  ```
  并在 `ROUTES` 追加图标路由：
  ```ts
  '/api/shell/icon': safe(async (ctx) => {
    const { req, res, win } = ctx
    if (req.method === 'GET') return sendJson(res, 200, readIconMeta())
    if (req.method === 'POST') {
      const body = await readBody(req)
      const result = await applyShellIcon(typeof body.path === 'string' ? body.path : undefined, win)
      return sendJson(res, result.ok ? 200 : 400, result)
    }
    sendJson(res, 405, { error: 'method not allowed' })
  }),
  '/api/shell/icon/reset': safe(async (ctx) => {
    const { res, win } = ctx
    const result = await resetShellIcon(win)
    sendJson(res, result.ok ? 200 : 500, result)
  }),
  ```

- [ ] **5.3** 在 `src/shell-control.ts` 导出 `ensureShellIconFromMain`（供 `main.ts` 启动恢复调用，见 Task 6），并把它加入 `__internals`：
  ```ts
  export function ensureShellIconFromMain(win: BrowserWindow | undefined): void {
    ensureShellIcon(win)
  }
  ```

- [ ] **5.4** 全量编译验证（此时 `shell-icon.ts` 已就位，应全绿）：
  ```bash
  just build
  ```
  预期：`dist/main.js`、`dist/shell-control.js`、`dist/shell-icon.js`、`dist/preload.js` 均生成，无类型错误。

---

## Task 6：主进程接线 + 预置插件

**Files（修改）**
- `src/main.ts`（启动 shell-control、启动恢复、IPC 注册、`PRESET_PLUGINS` 加项）
- `package.json`（依赖已在 Task 1.5 加，此处只核对）

**Steps**

- [ ] **6.1** 在 `src/main.ts` 的 `PRESET_PLUGINS` 加入新插件（[src/main.ts:136](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L136)）：
  ```ts
  const PRESET_PLUGINS = ['dshmarket', 'dsh-plugin-market', 'dsh-plugin-version-manager', 'dsh-shell-control']
  ```

- [ ] **6.2** 在 `app.whenReady().then` 内、`createSplash()` 之后调用 `registerShellIpc()`（已在 Task 4.6 定义）：
  ```ts
  app.whenReady().then(async () => {
    const icon = devIcon()
    if (icon && process.platform === 'darwin') app.dock?.setIcon(icon)
    setupAppMenu()
    setupAutoUpdate()
    registerShellIpc()
    createSplash()
    try {
      await boot()
    } catch (error) {
      destroySplash()
      dialog.showErrorBox('DSH Desktop 启动失败', `${error instanceof Error ? error.message : String(error)}\n\n日志：${logFile()}`)
      app.quit()
    }
  })
  ```

- [ ] **6.3** 在 `boot()` 成功分支（`mainWindow = createWindow(port)` 之后、`createTray(port)` 之前）启动 shell-control 并恢复图标/偏好。定位到 `boot()` 内：
  ```ts
  try {
    await waitReady(port, dshChild)
    destroySplash()
    const prefs = loadPrefs()
    mainWindow = createWindow(port, prefs)
    ensureShellIconFromMain(mainWindow)
    void startShellControl(() => mainWindow, recreateWindow)
    createTray(port)
    booted = true
    if (attempt > 1) appendFileSync(logFile(), `\n=== boot succeeded after ${attempt - 1} failed attempt(s) ===\n`)
    return
  } catch (error) {
    /* 原有恢复阶梯不变 */
  }
  ```
  注意：`createWindow(port, prefs)` 会按持久化的 `frameless/opacity/alwaysOnTop` 恢复外壳状态；`ensureShellIconFromMain` 恢复自定义图标。

- [ ] **6.4** 在 `will-quit` 里停止 shell-control（[src/main.ts:1230](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L1230) 附近）：
  ```ts
  app.on('will-quit', () => {
    tray?.destroy()
    stopShellControl()
    if (dshChild && dshChild.exitCode === null) dshChild.kill()
  })
  ```

- [ ] **6.5** 核对 `package.json` 已含 `"dsh-shell-control": "file:plugins/dsh-shell-control"`（Task 1.5 已加），并在 `dependencies` 内可见。若缺失补上后重装：
  ```bash
  pnpm install
  ```

- [ ] **6.6** 全量编译 + 实跑：
  ```bash
  just build
  just dev
  ```
  预期：应用启动后 `userData/logs/dsh.log` 出现 `=== shell-control listening on 127.0.0.1:<port> ===`；`dsh-home/shell/control-port.json` 生成。

---

## Task 7：插件 host 注册 8 个 AI 工具 + /api/shell/* 代理 + 端口发现

**Files（修改）**
- `plugins/dsh-shell-control/lib/index.js`（替换 Task 1.3 的骨架为完整实现）

**Steps**

- [ ] **7.1** 用完整实现替换 `plugins/dsh-shell-control/lib/index.js`：端口发现（读 `control-port.json`，失败则探测 3177–3179）、`callShell` 桥接（带超时 + 不可达明确反馈）、`/api/shell/*` 代理路由（供 client 面板同源调用）、8 个 AI 工具。
  ```js
  // dsh-shell-control · 插件入口（host 面）
  // 注册 8 个 AI 工具 + /api/shell/* 代理路由。AI 工具与面板共用同一套
  // /api/shell/* 接口（转发到 Electron 壳的 shell-control 服务 @ 127.0.0.1:<port>）。
  import { readFileSync, existsSync } from 'node:fs'
  import { join } from 'node:path'
  import { homedir } from 'node:os'

  export const name = 'dsh-shell-control'
  export const inject = ['webServer', 'tools']

  /** dsh-home（与 Electron 壳共享 DSH_HOME；DSH_HOME 缺失时退到 ~/.dsh-home）。 */
  function dshHome() {
    return process.env.DSH_HOME || join(homedir(), '.dsh-home')
  }
  function portFile() {
    return join(dshHome(), 'shell', 'control-port.json')
  }

  /** 发现 shell-control 端口：先读 control-port.json，失败则探测默认端口。 */
  let cachedPort = null
  async function shellPort() {
    if (cachedPort) return cachedPort
    try {
      const { port } = JSON.parse(readFileSync(portFile(), 'utf8'))
      if (port) { cachedPort = port; return port }
    } catch { /* 落盘文件不存在，走探测 */ }
    for (const p of [3177, 3178, 3179, 3180]) {
      try {
        const r = await fetch(`http://127.0.0.1:${p}/api/shell/state`, { signal: AbortSignal.timeout(1500) })
        if (r.ok) { cachedPort = p; return p }
      } catch { /* 继续探测 */ }
    }
    return null
  }

  /** 调用 shell-control；不可达时给 AI 明确可操作反馈。 */
  async function callShell(path, opts = {}) {
    const port = await shellPort()
    if (!port) {
      return { ok: false, error: '外壳控制服务未启动（Electron 壳未运行或端口未就绪）。请确认桌面应用已启动。' }
    }
    const timeout = opts.timeout ?? 10000
    try {
      const r = await fetch(`http://127.0.0.1:${port}${path}`, {
        ...opts,
        headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
        signal: AbortSignal.timeout(timeout),
      })
      const text = await r.text()
      try { return JSON.parse(text) } catch { return { ok: false, error: '外壳返回非 JSON: ' + text.slice(0, 200) } }
    } catch (e) {
      cachedPort = null // 下次重新发现
      return { ok: false, error: '外壳控制服务不可达: ' + (e && e.message ? e.message : String(e)) }
    }
  }

  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj)
    res.writeHead(code, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    })
    res.end(body)
  }
  function readBody(req) {
    return new Promise((resolveResult) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => { try { resolveResult(body ? JSON.parse(body) : {}) } catch { resolveResult({}) } })
      req.on('error', () => resolveResult({}))
    })
  }
  const route = (path, handler) => ({ kind: 'exact', path, handler })
  function safe(handler) {
    return async (req, res) => {
      try { await handler(req, res) } catch (e) {
        if (res.headersSent) { res.destroy(); return }
        sendJson(res, 500, { error: String(e) })
      }
    }
  }

  /** 代理 /api/shell/* 到 shell-control（供 client 面板同源调用，规避跨端口 CORS）。 */
  async function proxyToShell(shellPath, req, res) {
    const opts = { method: req.method, timeout: 10000 }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      opts.body = JSON.stringify(await readBody(req))
    }
    const result = await callShell(shellPath, opts)
    sendJson(res, 200, result)
  }

  // 懒加载 @deepseek-ai/dsh-tools 的 defineTool（与 dsh-plugin-market 同模式）。
  let defineToolCache = null
  async function loadDefineTool() {
    if (defineToolCache) return defineToolCache
    try {
      const mod = await import('@deepseek-ai/dsh-tools')
      defineToolCache = mod.defineTool
      return mod.defineTool
    } catch {
      defineToolCache = (options) => options
      return defineToolCache
    }
  }

  /** 文本渲染（与 market 工具一致：把 JSON 结果转成模型可读文本）。 */
  function jsonRender(_args, value) {
    return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
  }

  export function apply(ctx) {
    // —— AI 工具：让内置 AI 修改外壳本身 ——
    ctx.effect(async () => {
      const defineTool = await loadDefineTool()
      const disposers = []

      disposers.push(ctx.tools.register(defineTool({
        name: 'set_icon',
        description:
          '更换 DeepSeek Harness 桌面外壳的应用图标（窗口/任务栏/快捷方式）。path 必须是应用 build/ 目录内的图标文件（如 "build/icon.png"、"build/icon.ico"），'
          + '服务端做白名单校验，路径不得越出 build/。应用后即时生效并持久化，重启保留。',
        parameters: {
          path: { type: 'string', required: true, description: 'build/ 目录内的图标文件相对或绝对路径。' },
        },
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute(args) {
          return callShell('/api/shell/icon', { method: 'POST', body: JSON.stringify({ path: args.path }), timeout: 60000 })
        },
        timeoutMs: 60000,
      })))

      disposers.push(ctx.tools.register(defineTool({
        name: 'switch_frameless',
        description:
          '切换 DeepSeek Harness 桌面外壳的边框模式。frame=true 恢复系统原生标题栏（有边框）；frame=false 切换为无边框 + 自绘标题栏（最小化/最大化/关闭按钮 + 可拖拽）。'
          + 'Electron 的 frame 不可运行时直接改，此工具会重建窗口（保留位置/大小/图标）。',
        parameters: {
          frame: { type: 'boolean', required: true, description: 'true=有边框（系统标题栏）；false=无边框（自绘标题栏）。' },
        },
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute(args) {
          return callShell('/api/shell/frameless', { method: 'POST', body: JSON.stringify({ frame: args.frame === true }) })
        },
        timeoutMs: 10000,
      })))

      disposers.push(ctx.tools.register(defineTool({
        name: 'set_window_opacity',
        description:
          '设置 DeepSeek Harness 桌面外壳的窗口透明度。opacity 范围 0.2–1.0（1.0=不透明）。低于 0.2 会被夹到 0.2 以免窗口不可见。结果持久化，重启保留。',
        parameters: {
          opacity: { type: 'number', required: true, description: '0.2–1.0 之间的透明度。' },
        },
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute(args) {
          return callShell('/api/shell/opacity', { method: 'POST', body: JSON.stringify({ opacity: args.opacity }) })
        },
        timeoutMs: 10000,
      })))

      disposers.push(ctx.tools.register(defineTool({
        name: 'toggle_always_on_top',
        description:
          '开关 DeepSeek Harness 桌面外壳的窗口置顶。on=true 窗口常驻最前；on=false 取消置顶。结果持久化，重启保留。',
        parameters: {
          on: { type: 'boolean', required: true, description: 'true=置顶；false=取消置顶。' },
        },
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute(args) {
          return callShell('/api/shell/always-on-top', { method: 'POST', body: JSON.stringify({ on: args.on === true }) })
        },
        timeoutMs: 10000,
      })))

      disposers.push(ctx.tools.register(defineTool({
        name: 'minimize',
        description: '最小化 DeepSeek Harness 桌面外壳窗口到任务栏（窗口隐藏到托盘驻留，不退出）。',
        parameters: {},
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute() {
          return callShell('/api/shell/window', { method: 'POST', body: JSON.stringify({ action: 'minimize' }) })
        },
        timeoutMs: 10000,
      })))

      disposers.push(ctx.tools.register(defineTool({
        name: 'maximize',
        description: '最大化 DeepSeek Harness 桌面外壳窗口；若已最大化则还原。返回当前 maximized 状态。',
        parameters: {},
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute() {
          return callShell('/api/shell/window', { method: 'POST', body: JSON.stringify({ action: 'maximize' }) })
        },
        timeoutMs: 10000,
      })))

      disposers.push(ctx.tools.register(defineTool({
        name: 'set_size',
        description:
          '设置 DeepSeek Harness 桌面外壳窗口的尺寸（像素）。w/h 会被夹到 800–4000 / 600–4000，避免过小或超大。返回应用后的 bounds。',
        parameters: {
          w: { type: 'number', required: true, description: '窗口宽度（800–4000）。' },
          h: { type: 'number', required: true, description: '窗口高度（600–4000）。' },
        },
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute(args) {
          return callShell('/api/shell/window', { method: 'POST', body: JSON.stringify({ action: 'set_size', w: args.w, h: args.h }) })
        },
        timeoutMs: 10000,
      })))

      disposers.push(ctx.tools.register(defineTool({
        name: 'get_window_state',
        description:
          '查询 DeepSeek Harness 桌面外壳窗口的当前状态：位置(x,y)、大小(width,height)、是否最大化/最小化/全屏、是否置顶、透明度、是否无边框。'
          + '外壳控制服务未启动时返回 ok:false 与可操作错误文案。',
        parameters: {},
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute() {
          return callShell('/api/shell/state', { method: 'GET' })
        },
        timeoutMs: 10000,
      })))

      return () => { for (const d of disposers) d() }
    }, 'dsh-shell-control: ai tools')

    // —— /api/shell/* 代理路由：供 client 面板同源调用 ——
    ctx.effect(() => {
      const disposers = []
      const proxy = (shellPath) => route('/api/shell' + shellPath, safe((req, res) => proxyToShell(shellPath, req, res)))
      disposers.push(ctx.webServer.register(proxy('/state')))
      disposers.push(ctx.webServer.register(proxy('/window')))
      disposers.push(ctx.webServer.register(proxy('/opacity')))
      disposers.push(ctx.webServer.register(proxy('/always-on-top')))
      disposers.push(ctx.webServer.register(proxy('/frameless')))
      disposers.push(ctx.webServer.register(proxy('/icon')))
      disposers.push(ctx.webServer.register(proxy('/icon/reset')))
      ctx.logger?.info?.('[dsh-shell-control] mounted: 8 ai tools + /api/shell/* proxy (面板由 client.js 注入)')
      return () => { for (const d of disposers) d() }
    }, 'dsh-shell-control')
  }
  ```

- [ ] **7.2** 在 dsh 已运行的会话里热验证 host 挂载（重启 dsh 后看日志）：
  ```bash
  just dev
  ```
  预期：`dsh.log` 出现 `[dsh-shell-control] mounted: 8 ai tools + /api/shell/* proxy`。

---

## Task 8：插件 client 注入"外壳控制"侧边栏面板

**Files（修改）**
- `plugins/dsh-shell-control/lib/client.js`（替换 Task 1.4 的骨架为完整面板）

**Steps**

- [ ] **8.1** 用完整面板实现替换 `plugins/dsh-shell-control/lib/client.js`：侧边栏 footer 注入"外壳控制"按钮，弹出 Modal 面板，含——边框模式切换、透明度滑块、置顶开关、尺寸输入 + 应用、最小化/最大化按钮、图标路径输入 + 应用 + 恢复默认、当前状态实时显示。镜像 `dsh-plugin-market/lib/client.js` 的 `__ModuleLoader__.load` + React + `ui-primitives` + `ctx.slots.register` 范式。
  ```js
  window.__ModuleLoader__.load({
    id: "dsh-shell-control",
    factory: (require) => {
      var module = { exports: {} };
      var exports = module.exports;
      Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
      var React = require("react");
      var { useState, useEffect } = React;
      var __ui = require("@deepseek-ai/dsh-client-ui-primitives");
      var Modal = __ui.Modal, Button = __ui.Button, Input = __ui.Input;

      var NS = "shell-control";
      var zh = {
        fabLabel: "外壳控制", title: "外壳控制", subtitle: "AI 能改的外壳：边框 · 透明度 · 置顶 · 尺寸 · 图标",
        close: "关闭", loading: "加载中…", refresh: "刷新状态",
        frameless: "无边框模式", framelessHint: "切换会重建窗口（保留位置/大小/图标）",
        opacity: "透明度", alwaysOnTop: "窗口置顶", apply: "应用", minimize: "最小化", maximize: "最大化/还原",
        sizeW: "宽", sizeH: "高", setSize: "设置尺寸",
        iconPath: "图标路径（build/ 内）", applyIcon: "应用图标", resetIcon: "恢复默认图标",
        state: "当前状态", bounds: "位置/大小", maximized: "已最大化", minimized: "已最小化",
        fullscreen: "全屏", onTop: "置顶", framelessState: "无边框", opacityLabel: "透明度",
        errReach: "外壳控制服务未启动，请确认桌面应用已运行", applied: "已应用", iconWarn: "图标路径必须在 build/ 目录内",
      };
      var en = Object.assign({}, zh, {
        fabLabel: "Shell Control", title: "Shell Control", subtitle: "The shell AI can change: frame · opacity · on-top · size · icon",
        close: "Close", loading: "Loading…", refresh: "Refresh",
        frameless: "Frameless", framelessHint: "Rebuilds the window (keeps position/size/icon)",
        opacity: "Opacity", alwaysOnTop: "Always on top", apply: "Apply", minimize: "Minimize", maximize: "Maximize/Restore",
        sizeW: "W", sizeH: "H", setSize: "Set size",
        iconPath: "Icon path (inside build/)", applyIcon: "Apply icon", resetIcon: "Reset to default",
        state: "Current state", bounds: "Bounds", maximized: "Maximized", minimized: "Minimized",
        fullscreen: "Fullscreen", onTop: "On top", framelessState: "Frameless", opacityLabel: "Opacity",
        errReach: "Shell control service is not running. Make sure the desktop app is open.", applied: "Applied", iconWarn: "Icon path must be inside build/",
      });

      var T = {
        p: "var(--dsw-alias-label-primary)", s: "var(--dsw-alias-label-secondary)", t: "var(--dsw-alias-label-tertiary)",
        b2: "var(--dsw-alias-bg-layer-2)", b3: "var(--dsw-alias-bg-layer-3)",
        ln2: "var(--dsw-alias-border-l2)", brand: "var(--dsw-alias-brand-primary)",
        ok: "var(--dsw-alias-state-success-primary)", err: "var(--dsw-alias-state-error-primary)",
        font: "var(--dsw-font-family, inherit)", mono: "ui-monospace, SF Mono, Menlo, monospace",
      };

      function api(path, opts) {
        opts = opts || {};
        var ctrl = new AbortController();
        var timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 10000);
        var o = Object.assign({}, opts, { signal: ctrl.signal });
        return fetch("/api/shell/" + path, o).then(function (r) {
          clearTimeout(timer);
          return r.json().then(function (d) { return r.ok ? d : Object.assign({ ok: false }, d); });
        }).catch(function (e) {
          clearTimeout(timer);
          return { ok: false, error: e && e.name === "AbortError" ? "请求超时" : String((e && e.message) || e) };
        });
      }
      function post(path, body) {
        return api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      }

      function Row(props) {
        return React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid " + T.ln2 } }, props.children);
      }
      function Label(props) {
        return React.createElement("span", { style: { flex: "none", width: 96, fontSize: 12, color: T.s } }, props.children);
      }

      function ShellPanel(props) {
        var t = props.t;
        var open = props.open;
        var [state, setState] = useState(null);
        var [err, setErr] = useState("");
        var [okMsg, setOkMsg] = useState("");
        var [opacity, setOpacity] = useState(1);
        var [w, setW] = useState("");
        var [h, setH] = useState("");
        var [iconPath, setIconPath] = useState("build/icon.png");

        function refresh() {
          api("state").then(function (d) {
            if (d && d.error && !d.bounds) { setErr(t("errReach")); setState(null); return; }
            setState(d); setErr(""); if (typeof d.opacity === "number") setOpacity(d.opacity);
            if (d.bounds) { setW(String(d.bounds.width)); setH(String(d.bounds.height)); }
          });
        }
        useEffect(function () { if (open) refresh(); }, [open]);

        function flash(msg) { setOkMsg(msg); setErr(""); setTimeout(function () { setOkMsg(""); }, 2000); }
        function fail(msg) { setErr(msg); setOkMsg(""); }

        function toggleFrameless() {
          var next = !(state && state.frameless);
          post("frameless", { frame: !next }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); setTimeout(refresh, 500); });
        }
        function applyOpacity() { post("opacity", { opacity: opacity }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); refresh(); }); }
        function toggleOnTop() { var next = !(state && state.alwaysOnTop); post("always-on-top", { on: next }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); refresh(); }); }
        function doMinimize() { post("window", { action: "minimize" }).then(refresh); }
        function doMaximize() { post("window", { action: "maximize" }).then(refresh); }
        function applySize() { post("window", { action: "set_size", w: Number(w), h: Number(h) }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); refresh(); }); }
        function applyIcon() { post("icon", { path: iconPath }).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || t("iconWarn")); refresh(); }); }
        function resetIcon() { post("icon/reset", {}).then(function (d) { d && d.ok ? flash(t("applied")) : fail((d && d.error) || "失败"); refresh(); }); }

        var inputStyle = { flex: "1 1 80px", minWidth: 60, height: 30, padding: "0 8px", boxSizing: "border-box", border: "1px solid " + T.ln2, borderRadius: 6, outline: "none", background: T.b3, color: T.p, fontSize: 13, fontFamily: T.font };

        return React.createElement(Modal, { open: open, onClose: props.onClose, title: t("title"), description: t("subtitle"), closeLabel: t("close") },
          React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4, minWidth: 360, fontFamily: T.font } },
            okMsg ? React.createElement("div", { style: { color: T.ok, fontSize: 12, marginBottom: 4 } }, "✓ " + okMsg) : null,
            err ? React.createElement("div", { style: { color: T.err, fontSize: 12, marginBottom: 4 } }, "✕ " + err) : null,
            React.createElement(Row, null, React.createElement(Label, null, t("frameless")),
              React.createElement(Button, { size: "sm", variant: state && state.frameless ? "primary" : "ghost", onClick: toggleFrameless }, state && state.frameless ? "✓ " + t("frameless") : t("frameless")),
              React.createElement("span", { style: { fontSize: 11, color: T.t, flex: 1 } }, t("framelessHint"))
            ),
            React.createElement(Row, null, React.createElement(Label, null, t("opacity")),
              React.createElement("input", { type: "range", min: 0.2, max: 1, step: 0.05, value: opacity, onChange: function (e) { setOpacity(Number(e.target.value)); }, style: { flex: 1 } }),
              React.createElement("span", { style: { width: 36, textAlign: "right", fontSize: 12, color: T.p, fontFamily: T.mono } }, opacity.toFixed(2)),
              React.createElement(Button, { size: "sm", onClick: applyOpacity }, t("apply"))
            ),
            React.createElement(Row, null, React.createElement(Label, null, t("alwaysOnTop")),
              React.createElement(Button, { size: "sm", variant: state && state.alwaysOnTop ? "primary" : "ghost", onClick: toggleOnTop }, state && state.alwaysOnTop ? "✓ " + t("alwaysOnTop") : t("alwaysOnTop"))
            ),
            React.createElement(Row, null, React.createElement(Label, null, t("setSize")),
              React.createElement(Input, { style: inputStyle, type: "number", placeholder: t("sizeW"), value: w, onChange: function (e) { setW(e.target.value); } }),
              React.createElement(Input, { style: inputStyle, type: "number", placeholder: t("sizeH"), value: h, onChange: function (e) { setH(e.target.value); } }),
              React.createElement(Button, { size: "sm", onClick: applySize }, t("apply"))
            ),
            React.createElement(Row, null, React.createElement(Label, null, t("minimize") + "/" + t("maximize")),
              React.createElement(Button, { size: "sm", onClick: doMinimize }, t("minimize")),
              React.createElement(Button, { size: "sm", onClick: doMaximize }, t("maximize"))
            ),
            React.createElement(Row, null, React.createElement(Label, null, t("iconPath")),
              React.createElement(Input, { style: inputStyle, value: iconPath, onChange: function (e) { setIconPath(e.target.value); } }),
              React.createElement(Button, { size: "sm", onClick: applyIcon }, t("applyIcon")),
              React.createElement(Button, { size: "sm", variant: "ghost", onClick: resetIcon }, t("resetIcon"))
            ),
            React.createElement(Row, null, React.createElement(Label, null, t("state")),
              React.createElement("span", { style: { fontSize: 11, color: T.t, fontFamily: T.mono, flex: 1, wordBreak: "break-all" } },
                state && state.bounds ? (t("bounds") + ": " + state.bounds.x + "," + state.bounds.y + " " + state.bounds.width + "x" + state.bounds.height) : t("loading"),
                state ? (" | " + (state.maximized ? t("maximized") : "") + " " + (state.minimized ? t("minimized") : "") + " " + (state.fullscreen ? t("fullscreen") : "") + " " + (state.alwaysOnTop ? t("onTop") : "") + " " + (state.frameless ? t("framelessState") : "") + " " + t("opacityLabel") + "=" + (state.opacity != null ? state.opacity.toFixed(2) : "?")) : ""
              ),
              React.createElement(Button, { size: "sm", variant: "ghost", onClick: refresh }, t("refresh"))
            )
          )
        );
      }

      function ShellRoot(props) {
        var t = props.t;
        var _s = useState(false);
        var open = _s[0], setOpen = _s[1];
        return React.createElement(React.Fragment, null,
          React.createElement("button", {
            type: "button", title: t("fabLabel"), onClick: function () { setOpen(true); },
            style: { width: "100%", display: "flex", alignItems: "center", gap: 8, height: 36, padding: "0 12px", boxSizing: "border-box", border: "none", borderRadius: 12, background: "transparent", color: T.s, font: "500 14px/22px " + T.font, cursor: "pointer" }
          },
            React.createElement("span", { style: { flex: "none", color: T.s } },
              React.createElement("svg", { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none" },
                React.createElement("rect", { x: "2", y: "2.5", width: "12", height: "11", rx: "1.5", stroke: "currentColor", strokeWidth: 1.4 }),
                React.createElement("rect", { x: "2", y: "2.5", width: "12", height: "3", fill: "currentColor" })
              )
            ),
            React.createElement("span", null, t("fabLabel"))
          ),
          React.createElement(ShellPanel, { t: t, open: open, onClose: function () { setOpen(false); } })
        );
      }

      var inject = ["slots", "locale"];
      function apply(ctx) {
        ctx.effect(function () {
          return ctx.locale.register(NS, { zh: zh, en: en });
        }, "shell-control: dictionaries");
        ctx.slots.inject("sidebar.footer.action", function () {
          return ctx.slots.register({ name: "sidebar.footer.action", id: "shell-control", locale: NS }, ShellRoot);
        });
      }

      exports.apply = apply;
      exports.inject = inject;
      return module.exports;
    }
  });
  ```

- [ ] **8.2** 重启 dsh 并在侧边栏底部核对"外壳控制"按钮出现：
  ```bash
  just dev
  ```
  预期：侧边栏 footer 出现"外壳控制"按钮，点击弹出面板，状态行显示真实窗口状态。

---

## Task 9：构建验证 + 集成测试

**Files（无新增/修改，仅运行验证）**

**Steps**

- [ ] **9.1** 全量类型检查 + 编译：
  ```bash
  just build
  ```
  预期：`dist/` 生成 `main.js` / `shell-control.js` / `shell-icon.js` / `preload.js`，`tsc --strict` 无错。

- [ ] **9.2** 启动并核对 shell-control 落盘：
  ```bash
  just dev
  ```
  预期：
  - `userData/logs/dsh.log` 出现 `=== shell-control listening on 127.0.0.1:<port> ===`。
  - `userData/dsh-home/shell/control-port.json` 存在且 `port` 字段在 3177–3189。
  - dsh.log 出现 `[dsh-shell-control] mounted: 8 ai tools + /api/shell/* proxy`。

- [ ] **9.3** 用 curl 验证 shell-control 路由（把 `<port>` 换成 `control-port.json` 里的值）：
  ```powershell
  $port = (Get-Content "$env:APPDATA\DSH Desktop\dsh-home\shell\control-port.json" | ConvertFrom-Json).port
  Invoke-RestMethod "http://127.0.0.1:$port/api/shell/state"
  Invoke-RestMethod -Method POST "http://127.0.0.1:$port/api/shell/opacity" -Body '{"opacity":0.8}' -ContentType 'application/json'
  Invoke-RestMethod -Method POST "http://127.0.0.1:$port/api/shell/icon" -Body '{"path":"build/icon.png"}' -ContentType 'application/json'
  Invoke-RestMethod -Method POST "http://127.0.0.1:$port/api/shell/icon" -Body '{"path":"../../etc/passwd"}' -ContentType 'application/json'
  ```
  预期：
  - `/state` 返回真实 bounds/maximized/opacity/frameless。
  - `/opacity` 返回 `{ok:true,opacity:0.8}`，窗口实际变半透明。
  - `build/icon.png` 返回 `{ok:true,applied:[...]}`。
  - `../../etc/passwd` 返回 `{ok:false,error:"图标路径必须在 build/ 目录内"}`（白名单生效）。

- [ ] **9.4** 端口回退验证：临时占住 3177 后启动，确认自动用 3178 且 `control-port.json` 更新：
  ```powershell
  # 在一个 PowerShell 占住 3177
  python -c "import socket,time; s=socket.socket(); s.bind(('127.0.0.1',3177)); s.listen(1); time.sleep(60)"
  # 另开窗口启动应用
  just dev
  # 检查 control-port.json 的 port 应为 3178
  ```

- [ ] **9.5** 持久化验证：设透明度 0.7 + 无边框 + 置顶，退出应用（托盘 Quit），重新 `just dev`：
  预期：新窗口以 `frame:false`、`opacity:0.7`、`alwaysOnTop:true` 启动；自定义图标（若设过）经 `ensureShellIcon` 恢复。

- [ ] **9.6** AI 端到端验证：在 dsh 对话里对 AI 说"把窗口改成无边框，透明度调到 0.85，然后把图标换成 build/icon.png"。预期 AI 依次调用 `switch_frameless` / `set_window_opacity` / `set_icon`，窗口即时变化。

- [ ] **9.7** Windows 安装包烟雾测试（可选，需在 Windows 上）：
  ```bash
  just dist-win
  ```
  预期：`dist-installer/` 生成 NSIS 安装包；`node_modules/dsh-shell-control` 已 hoisted + asarUnpack；安装后首次启动 `presetBundledPlugins()` 把 `dsh-shell-control` 写入 profile bundles（marker 文件 `.bundled-plugins-preset` 含该插件版本）。

---

## 自检（Self-Check）

实施完成后逐项核对：

### 架构与通联
- [ ] shell-control 服务只监听 `127.0.0.1`（不暴露到网络）。
- [ ] `control-port.json` 在 `dsh-home/shell/` 下，且 `port` 字段反映实际端口；插件 `shellPort()` 先读它、失败再探测。
- [ ] dsh 与 Electron 共享 `DSH_HOME`（`main.ts` 的 `startDsh` 已注入 `DSH_HOME=dshHome()`），未引入新的进程间秘密通道。
- [ ] AI 工具（服务端）与面板（浏览器同源 `/api/shell/*`）共用同一套接口；面板经插件 host 代理，规避跨端口 CORS。

### AI 工具完整性
- [ ] 8 个工具全部注册：`set_icon` / `switch_frameless` / `set_window_opacity` / `toggle_always_on_top` / `minimize` / `maximize` / `set_size` / `get_window_state`，命名与计划一致。
- [ ] 每个工具有 `description` + `parameters` + `output.render`，`timeoutMs`：图标 60s、其余 10s。
- [ ] 壳不可达时工具返回 `{ok:false,error:"外壳控制服务未启动…"}`（可操作文案），而非抛异常。

### 安全白名单
- [ ] `set_icon` 的 `path` 经 `isInsideBuild()` 校验必须在 `build/` 内；越界返回 400，不执行 `setIcon`。
- [ ] 透明度夹到 `[0.2, 1]`、尺寸夹到 `[800–4000]×[600–4000]`，避免窗口不可见/超大。
- [ ] shell-control 路由全部 `safe()` 包装，错误→500 JSON，`headersSent` 时 destroy。
- [ ] CORS 头存在（`Access-Control-Allow-Origin: *` + OPTIONS 204），但服务仅监听回环，实际不可被外部访问。

### 持久化与恢复
- [ ] `shell/prefs.json` 存 `frameless/opacity/alwaysOnTop`，`createWindow(port, loadPrefs())` 在启动与重建时应用。
- [ ] `shell/icon/{current.png,current.ico,meta.json}` 在应用图标后生成；`ensureShellIcon()` 在 `boot()` 成功后恢复自定义图标 + 同步快捷方式。
- [ ] `recreateWindow` 用 `recreating` 标志绕过 close-to-tray 拦截，保留几何 + 端口 + 图标。

### 构建与打包
- [ ] `just build`（`tsc --strict`）无错，`dist/` 含 4 个产物。
- [ ] `package.json` 含 `"dsh-shell-control": "file:plugins/dsh-shell-control"`，`pnpm install` 后 `node_modules/dsh-shell-control` 存在（hoisted）。
- [ ] `PRESET_PLUGINS` 含 `dsh-shell-control`；首次启动 marker 文件 `.bundled-plugins-preset` 含其版本。
- [ ] `electron-builder.yml` 无需改动（`node_modules/**` 已 asarUnpack，插件随依赖解包）。

### 不做（YAGNI，确认未越界）
- [ ] 未改 exe 文件图标（运行时不可改，需重打包）。
- [ ] 未重建 dsh 内部 UI 主题/组件库（沿用 `ui-primitives` + `--dsw-alias-*` token）。
- [ ] 未引入新的跨进程秘密通道（沿用 HTTP + 落盘端口文件）。

### 回归
- [ ] 端口回退（3080–3099 for dsh、3177–3189 for shell-control）互不冲突；`pickPort` 逻辑未受影响。
- [ ] 安全模式阶梯（`safe-mode.ts`）未改动；`boot()` 恢复逻辑保留。
- [ ] 自动更新、托盘、splash、单实例锁、窗口几何记忆行为不变。
