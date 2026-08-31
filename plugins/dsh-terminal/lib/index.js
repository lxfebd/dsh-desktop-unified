// dsh-terminal · host 面
// 注册 /api/terminal/*：单个持久交互 shell（懒启动），
// GET /api/terminal/stream  → SSE 推 out/err/exit（含重连回放尾部）
// POST /api/terminal/input  → 写 stdin
// POST /api/terminal/kill   → 杀掉 shell（下次 stream/input 时重启）
import { spawn } from 'node:child_process'

export const name = 'dsh-terminal'
export const inject = ['webServer']

const route = (path, handler) => ({ kind: 'exact', path, handler })

function safe(handler) {
  return async (req, res) => {
    try { await handler(req, res) } catch (e) {
      if (res.headersSent) { res.destroy(); return }
      sendJson(res, 500, { ok: false, error: String(e) })
    }
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
  return new Promise((resolve) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch { resolve({}) }
    })
    req.on('error', () => resolve({}))
  })
}

// ---- 持久 shell：懒启动，单实例，输出广播给全部 SSE 客户端 ----

let child = null
const listeners = new Set()
const RING = 128
let ring = []

function shellSpec() {
  return process.platform === 'win32'
    ? { bin: 'powershell.exe', args: ['-NoLogo', '-NoProfile'] }
    : { bin: 'bash', args: ['-i'] }
}

function frame(event, text) {
  return `event: ${event}\ndata: ${JSON.stringify(text)}\n\n`
}

function running() {
  return child !== null && child.exitCode === null
}

function ensureShell() {
  if (running()) return
  const spec = shellSpec()
  child = spawn(spec.bin, spec.args, { env: process.env })
  ring = []
  child.stdout?.on('data', (d) => push('out', d.toString('utf8')))
  child.stderr?.on('data', (d) => push('err', d.toString('utf8')))
  child.on('exit', (code) => push('exit', String(code)))
  push('state', String(running()))
}

function push(event, text) {
  ring.push(frame(event, text))
  if (ring.length > RING) ring.splice(0, ring.length - RING)
  const data = ring[ring.length - 1]
  for (const res of listeners) {
    try { res.write(data) } catch { listeners.delete(res) }
  }
}

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = []

    disposers.push(ctx.webServer.register(route('/api/terminal/stream', safe((req, res) => {
      ensureShell()
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.write('retry: 2000\n\n')
      for (const f of ring) res.write(f)
      listeners.add(res)
      req.on('close', () => listeners.delete(res))
    }))))

    disposers.push(ctx.webServer.register(route('/api/terminal/input', safe(async (req, res) => {
      const body = await readBody(req)
      const text = typeof body.text === 'string' ? body.text : ''
      if (!text) return sendJson(res, 400, { ok: false, error: '缺少 text' })
      ensureShell()
      if (running()) child.stdin?.write(text)
      sendJson(res, 200, { ok: true, running: running() })
    }))))

    disposers.push(ctx.webServer.register(route('/api/terminal/kill', safe(async (req, res) => {
      if (running()) child.kill()
      child = null
      sendJson(res, 200, { ok: true })
    }))))

    ctx.logger?.info?.('[dsh-terminal host] mounted: /api/terminal/*')
    return () => {
      for (const d of disposers) d()
      if (running()) child.kill()
      child = null
    }
  }, 'dsh-terminal')
}
