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
