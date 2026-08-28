// dsh-plugin-version-manager · host 面
// 只注册 /api/version/* HTTP 路由。
// UI 不在 host 侧注入 —— 改由 lib/client.js 通过官方 ctx.slots.register 走 React 组件。
import { queryTags, installedVersion, findDshRoot, upgradeTo, checkPatches, applyPatches } from './core.js'

export const name = 'dsh-plugin-version-manager'
export const inject = ['webServer']

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
    req.on('end', () => {
      try { resolveResult(body ? JSON.parse(body) : {}) } catch { resolveResult({}) }
    })
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

export function apply(ctx) {
  ctx.effect(() => {
    const disposers = []

    disposers.push(ctx.webServer.register(route('/api/version/info', safe(async (req, res) => {
      const tags = await queryTags()
      const installed = installedVersion()
      const root = findDshRoot()
      const patches = root ? checkPatches(root) : []
      sendJson(res, 200, {
        installed,
        installRoot: root,
        channels: {
          stable: { tag: 'latest', version: tags.latest, installed: installed === tags.latest ? installed : '' },
          explorer: { tag: 'next', version: tags.next, installed: installed === tags.next ? installed : '' },
        },
        patches,
      })
    }))))

    disposers.push(ctx.webServer.register(route('/api/version/upgrade', safe(async (req, res) => {
      const body = await readBody(req)
      const channel = body.channel || 'stable'
      ctx.logger?.info?.('[dsh-plugin-version-manager] upgrade to', channel)
      const result = await upgradeTo(channel)
      sendJson(res, result.ok ? 200 : 500, result)
    }))))

    disposers.push(ctx.webServer.register(route('/api/version/patches', safe((req, res) => {
      const root = findDshRoot()
      if (!root) return sendJson(res, 500, { error: '未找到已安装的 dsh' })
      sendJson(res, 200, { root, patches: checkPatches(root) })
    }))))

    disposers.push(ctx.webServer.register(route('/api/version/patches/apply', safe((req, res) => {
      const root = findDshRoot()
      if (!root) return sendJson(res, 500, { error: '未找到已安装的 dsh' })
      sendJson(res, 200, { root, applied: applyPatches(root) })
    }))))

    ctx.logger?.info?.('[dsh-plugin-version-manager host] mounted: /api/version/*')
    return () => { for (const d of disposers) d() }
  }, 'dsh-plugin-version-manager')
}