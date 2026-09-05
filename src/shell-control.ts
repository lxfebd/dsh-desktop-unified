/**
 * Electron 主进程内的 shell-control 本地控制服务。
 * 只监听 127.0.0.1，端口 3177→3189 回退，实际端口落盘 dsh-home/shell/control-port.json。
 * 把 BrowserWindow 的图标/边框/透明度/置顶/尺寸/状态暴露为 /api/shell/* HTTP 接口，
 * 供 dsh 插件（跨进程）与侧边栏面板（同源代理）调用。
 *
 * 所有指令都经过白名单校验（仅 ROUTES 表里登记的路径 + 每个 handler 内部对 action/参数
 * 的范围校验），非法操作返回 4xx。窗口取值与重建回调由调用方注入，避免循环依赖 main.ts。
 * @module dsh-desktop/shell-control
 */

import { app, BrowserWindow } from 'electron'
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { randomBytes } from 'node:crypto'
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { applyShellIcon, readIconMeta, resetShellIcon, ensureShellIcon } from './shell-icon.js'

const FIRST_PORT = 3177
const LAST_PORT = 3189

/** dsh 状态目录（与 dsh 子进程共享 DSH_HOME）。 */
function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-home')
}

/** shell-control 专用目录（端口/偏好/图标）。 */
function shellDir(): string {
  const d = join(dshHome(), 'shell')
  mkdirSync(d, { recursive: true })
  return d
}

/** 实际监听端口落盘位置（插件/侧边栏通过它发现服务）。 */
function portFile(): string {
  return join(shellDir(), 'control-port.json')
}

/** 持久化的外壳偏好文件。 */
function prefsFile(): string {
  return join(shellDir(), 'prefs.json')
}

/** 日志文件（与 dsh.log 同目录）。 */
function logFile(): string {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'dsh.log')
}

/** 持久化的外壳偏好（重启恢复）。 */
export interface ShellPrefs {
  frameless: boolean
  opacity: number
  alwaysOnTop: boolean
}
const DEFAULT_PREFS: ShellPrefs = { frameless: false, opacity: 1, alwaysOnTop: false }

/** 读取外壳偏好；文件损坏/缺失时回退默认值。 */
export function loadPrefs(): ShellPrefs {
  try {
    return { ...DEFAULT_PREFS, ...(JSON.parse(readFileSync(prefsFile(), 'utf8')) as Partial<ShellPrefs>) }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

/** 写入外壳偏好。 */
export function savePrefs(p: ShellPrefs): void {
  writeFileSync(prefsFile(), JSON.stringify(p) + '\n')
}

let server: Server | undefined
let boundPort = 0
/** Pending /api/shell/restart timer — cleared by stopShellControl so a quit
 *  within the delay window can never relaunch the app after teardown. */
let restartTimer: ReturnType<typeof setTimeout> | undefined

/** H3 修复：请求鉴权 token（每次启动随机生成，写入 control-port.json 供插件读取）。 */
let authToken = ''

function generateToken(): string {
  return randomBytes(24).toString('hex')
}

/**
 * H3 修复：判断请求 Origin 是否来自受信任的回环页面（Electron Renderer / 本地侧边栏）。
 * 非白名单 Origin 一律不返回 CORS 放行头（浏览器读取不到响应），鉴权仍由 token 兜底。
 */
function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin) return false
  try {
    const u = new URL(origin)
    if (u.protocol !== 'http:') return false
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]'
  } catch {
    return false
  }
}

/** H3 修复：请求必须携带 Bearer token（Authorization 或 x-dsh-shell-token 均可）。 */
function authorized(req: IncomingMessage): boolean {
  if (!authToken) return false
  const bearer = req.headers['authorization']
  if (typeof bearer === 'string' && bearer === `Bearer ${authToken}`) return true
  const header = req.headers['x-dsh-shell-token']
  return typeof header === 'string' && header === authToken
}

/** 取实际监听端口（供 main.ts 落盘/日志；插件读 control-port.json 发现）。 */
export function currentPort(): number {
  return boundPort
}

/** 窗口取值器：返回当前主窗口（可能为 undefined）。 */
export type WindowGetter = () => BrowserWindow | undefined

/** 重建窗口回调：在 switch_frameless 时由 main.ts 提供，按新偏好重建窗口。 */
export type RecreateWindow = (prefs: ShellPrefs) => void

function sendJson(res: ServerResponse, code: number, obj: unknown): void {
  const body = JSON.stringify(obj)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-DSH-Shell-Token',
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(body)),
  }
  // H3 修复：仅对受信任 Origin 回显 CORS 放行，不再无条件 '*'（本机任意网页将无法读取响应）
  const req = (res as unknown as { req?: IncomingMessage }).req
  const origin = req?.headers.origin
  if (origin && isTrustedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
  }
  res.writeHead(code, headers)
  res.end(body)
}

/** 请求体大小上限：shell 指令都该是几百字节；过大即拒读，防本机进程灌爆内存。 */
const MAX_BODY_BYTES = 64 * 1024

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let body = ''
    let size = 0
    let aborted = false
    req.on('data', (c: Buffer) => {
      if (aborted) return
      size += c.length
      if (size > MAX_BODY_BYTES) {
        aborted = true
        resolve({})
        req.destroy()
        return
      }
      body += c
    })
    req.on('end', () => {
      if (aborted) return
      try { resolve(body ? JSON.parse(body) : {}) } catch { resolve({}) }
    })
    req.on('error', () => {
      if (!aborted) { aborted = true; resolve({}) }
    })
  })
}

/** 路由上下文：注入窗口取值器与重建回调，避免循环依赖 main.ts。 */
interface RouteCtx {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  win: BrowserWindow | undefined
  recreate: RecreateWindow
  onRestart?: RestartHandler
}

/** 由 main.ts 注入：优雅重启整个外壳（清理子进程/托盘后 relaunch+exit）。 */
export type RestartHandler = () => void

type Handler = (ctx: RouteCtx) => Promise<void> | void

/** 包装异步 handler，捕获错误返回 500，避免破坏 server。 */
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

/**
 * 路由表（白名单）：只有这里登记的路径才会被处理，未知路径返回 404。
 * 每个 handler 内部再对 action / 数值范围做校验，越界返回 400。
 */
const ROUTES: Record<string, (ctx: RouteCtx) => Promise<void>> = {
  // 窗口状态查询
  '/api/shell/state': safe(async (ctx) => {
    const { win, res } = ctx
    if (!win || win.isDestroyed()) return sendJson(res, 503, { error: 'window unavailable' })
    sendJson(res, 200, {
      bounds: win.getBounds(),
      maximized: win.isMaximized(),
      minimized: win.isMinimized(),
      fullscreen: win.isFullScreen(),
      alwaysOnTop: win.isAlwaysOnTop(),
      opacity: win.getOpacity(),
      frameless: loadPrefs().frameless,
    })
  }),

  // 窗口操作：minimize / maximize / set_size（白名单 action）
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

  // 透明度（持久化到 prefs.json），范围 0.2–1
  '/api/shell/opacity': safe(async (ctx) => {
    const { req, res, win } = ctx
    if (!win || win.isDestroyed()) return sendJson(res, 503, { error: 'window unavailable' })
    const body = await readBody(req)
    const o = clampNum(body.opacity, 0.2, 1, 1)
    win.setOpacity(o)
    const p = loadPrefs(); p.opacity = o; savePrefs(p)
    sendJson(res, 200, { ok: true, opacity: o })
  }),

  // 置顶切换（持久化）
  '/api/shell/always-on-top': safe(async (ctx) => {
    const { req, res, win } = ctx
    if (!win || win.isDestroyed()) return sendJson(res, 503, { error: 'window unavailable' })
    const body = await readBody(req)
    const on = body.on === true
    win.setAlwaysOnTop(on)
    const p = loadPrefs(); p.alwaysOnTop = on; savePrefs(p)
    sendJson(res, 200, { ok: true, alwaysOnTop: on })
  }),

  // 无边框切换：写 prefs → 调 recreate 重建窗口（重建回调由 main.ts 提供）
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

  // 图标：GET 读 meta；POST {path} 应用（path 必须位于 build/ 白名单内）
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

  // 图标重置为默认
  '/api/shell/icon/reset': safe(async (ctx) => {
    const { res, win } = ctx
    const result = await resetShellIcon(win)
    sendJson(res, result.ok ? 200 : 500, result)
  }),

  // 请求外壳优雅重启（版本升级后加载新 bundle）。先回 200 让插件读到结果，
  // 再延迟调用 main.ts 注入的重启回调（清理子进程/托盘 → app.relaunch+exit）。
  // 定时器被追踪：用户若在延迟窗口内退出，stopShellControl 会清除它。
  '/api/shell/restart': safe(async (ctx) => {
    const { req, res, onRestart } = ctx
    if (typeof onRestart !== 'function') return sendJson(res, 503, { error: 'restart unavailable' })
    const body = await readBody(req)
    // 延迟毫秒：给 UI 一点时间显示“正在重启”，并避免与当前响应写入竞争
    const delayMs = clampInt(body.delayMs, 0, 5000, 300)
    sendJson(res, 200, { ok: true, restarting: true, delayMs })
    if (restartTimer !== undefined) clearTimeout(restartTimer)
    restartTimer = setTimeout(() => {
      restartTimer = undefined
      try { onRestart() } catch { /* 重启路径自带日志 */ }
    }, delayMs)
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

/** 在 3177–3189 间挑第一个可绑定的回环端口。 */
async function pickPort(): Promise<number> {
  for (let p = FIRST_PORT; p <= LAST_PORT; p++) {
    if (await isFree(p)) return p
  }
  throw new Error(`no free shell-control port between ${FIRST_PORT} and ${LAST_PORT}`)
}

/**
 * 启动 shell-control 服务。
 * @param getWindow 返回当前主窗口（可能为空）
 * @param recreate 在 switch_frameless 时由 main.ts 提供以重建窗口
 * @param onRestart 在 /api/shell/restart 时由 main.ts 提供以优雅重启外壳（可选；缺省该路由返回 503）
 * 实际端口写入 control-port.json，并通过 currentPort() 暴露。
 */
export async function startShellControl(
  getWindow: WindowGetter,
  recreate: RecreateWindow,
  onRestart?: RestartHandler,
): Promise<void> {
  const port = await pickPort()
  boundPort = port
  authToken = generateToken()
  writeFileSync(portFile(), JSON.stringify({ port, token: authToken, startedAt: new Date().toISOString() }) + '\n')
  // control-port.json 携带 auth token：限制为仅当前用户可读写，避免同机其他
  // 用户进程读取 token 后调用本机 shell 接口。
  try { chmodSync(portFile(), 0o600) } catch { /* 只读文件系统/非 POSIX：尽力而为 */ }
  server = createServer((req, res) => {
    const origin = req.headers.origin
    if (req.method === 'OPTIONS') {
      const trusted = origin && isTrustedOrigin(origin)
      const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-DSH-Shell-Token',
        'Access-Control-Max-Age': '3600',
      }
      if (trusted) headers['Access-Control-Allow-Origin'] = origin
      res.writeHead(204, headers)
      res.end()
      return
    }
    // H3 修复：所有非 OPTIONS 请求必须先通过 token 鉴权
    if (!authorized(req)) {
      sendJson(res, 401, { error: 'unauthorized' })
      return
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const handler = ROUTES[url.pathname]
    const ctx: RouteCtx = { req, res, url, win: getWindow(), recreate, onRestart }
    if (!handler) return sendJson(res, 404, { error: 'not found: ' + url.pathname })
    void safe(handler)(ctx).catch(() => { /* safe 已处理 */ })
  })
  server.listen(port, '127.0.0.1')
  appendFileSync(logFile(), `\n=== shell-control listening on 127.0.0.1:${port} (auth enabled) ===\n`)
}

/**
 * 与 startShellControl 等价，但返回实际监听端口（便于 main.ts 在 Task 6 直接拿到端口）。
 * @param getWindow 返回当前主窗口（可能为空）
 * @param recreate 在 switch_frameless 时由 main.ts 提供以重建窗口
 */
export async function startShellControlBridge(
  getWindow: WindowGetter,
  recreate: RecreateWindow,
  onRestart?: RestartHandler,
): Promise<number> {
  await startShellControl(getWindow, recreate, onRestart)
  return currentPort()
}

/** 停止服务（退出时清理）。 */
export function stopShellControl(): void {
  if (restartTimer !== undefined) {
    clearTimeout(restartTimer)
    restartTimer = undefined
  }
  if (server) { server.close(); server = undefined }
}

/** 启动恢复：把已持久化的自定义图标重新应用到窗口（供 main.ts 在 Task 6 调用）。 */
export function ensureShellIconFromMain(win: BrowserWindow | undefined): void {
  ensureShellIcon(win)
}

// 便于 Task 3/4/5 在本文件内追加路由：把工具函数与类型再导出一次。
export const __internals = { sendJson, readBody, safe, clampInt, clampNum, ROUTES, ensureShellIcon }
