// dsh-market-tools · 插件入口集成测试：假 ctx 走真实 apply()，
// 验证 4 个工具确实注册、参数转投正确的 /dsh-market/* 路由与请求体。
import { afterAll, describe, expect, it, vi } from 'vitest'
import { apply, name as pluginName, inject } from '../plugins/dsh-market-tools/lib/index.js'

const originalFetch = globalThis.fetch
afterAll(() => {
  globalThis.fetch = originalFetch
})

function makeCtx(fetchImpl: (...args: never[]) => Promise<unknown>, agentId?: string) {
  const registered: Array<Record<string, any>> = []
  const ctx: Record<string, any> = {
    webServer: { port: 4321 },
    connection: { authenticatedUrl: (url: string) => `${url}?token=TK` },
    tools: {
      register: (tool: Record<string, any>) => {
        registered.push(tool)
        return () => {
          const i = registered.indexOf(tool)
          if (i >= 0) registered.splice(i, 1)
        }
      },
    },
    effect: (fn: () => Promise<() => void>) => {
      void fn()
    },
    __fetch: fetchImpl,
  }
  if (agentId) {
    ;(ctx as Record<string, any>).agent = { id: agentId, session: { id: agentId } }
  }
  // 插件里直接用 globalThis.fetch；测试注入 mock 后还原
  ;(globalThis as Record<string, any>).fetch = fetchImpl
  return { ctx, registered }
}

function res(status: number, body: unknown, cookies: string[] = []) {
  return {
    status,
    headers: { getSetCookie: () => cookies, get: () => null },
    text: async () => JSON.stringify(body),
  }
}

describe('dsh-market-tools apply()', () => {
  it('exposes cordis plugin shape', () => {
    expect(pluginName).toBe('dsh-market-tools')
    expect(inject).toEqual(['webServer', 'connection', 'tools'])
  })

  it('registers four market_* tools and routes execute() to the right endpoints', async () => {
    const requests: Array<{ url: string; init: Record<string, any> }> = []
    const fetchImpl = vi.fn(async (url: string, init: Record<string, any> = {}) => {
      if (String(url).includes('?token=TK')) return res(303, {}, ['sid=t'])
      requests.push({ url: String(url), init })
      if (url.endsWith('/dsh-market/registry')) {
        return res(200, { source: 'live', registry: { plugins: [{ name: 'a', url: 'https://github.com/o/a', description: { zh: '啊' } }] } })
      }
      if (url.endsWith('/dsh-market/installed')) return res(200, { installed: { a: 'github:o/a' }, present: ['a'], disabled: [], live: {} })
      return res(200, { ok: true, hot: true })
    })
    const { ctx, registered } = makeCtx(fetchImpl as never)
    apply(ctx as never)
    await vi.waitFor(() => expect(registered.length).toBe(4))
    expect(registered.map((t) => t.name).sort()).toEqual(['market_install', 'market_list', 'market_uninstall', 'market_update'])

    const list = await registered.find((t) => t.name === 'market_list')!.execute({ query: '' })
    expect(list.ok).toBe(true)
    expect(list.catalog[0]).toMatchObject({ name: 'a', description: '啊', installed: true })

    const install = await registered.find((t) => t.name === 'market_install')!.execute({ url: 'https://github.com/o/a' })
    expect(install).toMatchObject({ ok: true, hot: true })
    const installReq = requests.find((r) => r.url.endsWith('/dsh-market/install'))!
    expect(installReq.init.method).toBe('POST')
    expect(installReq.init.body).toBe('{"url":"https://github.com/o/a"}')
    expect(installReq.init.headers.origin).toBe('http://127.0.0.1:4321')
    expect(installReq.init.headers.cookie).toBe('sid=t')

    await registered.find((t) => t.name === 'market_uninstall')!.execute({ name: 'a' })
    await registered.find((t) => t.name === 'market_update')!.execute({ name: 'a' })
    expect(requests.some((r) => r.url.endsWith('/dsh-market/uninstall') && r.init.body === '{"name":"a"}')).toBe(true)
    expect(requests.some((r) => r.url.endsWith('/dsh-market/update') && r.init.body === '{"name":"a"}')).toBe(true)

    const emptyInstall = await registered.find((t) => t.name === 'market_install')!.execute({ url: '  ' })
    expect(emptyInstall.ok).toBe(false)
  })

  it('truncates giant pnpm stdout in mutation results', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes('?token=TK')
        ? res(303, {}, ['sid=t'])
        : res(200, { ok: false, error: 'boom', stdout: 'x'.repeat(5000) }),
    )
    const { ctx, registered } = makeCtx(fetchImpl as never)
    apply(ctx as never)
    await vi.waitFor(() => expect(registered.length).toBe(4))
    const out = await registered.find((t) => t.name === 'market_install')!.execute({ url: 'https://github.com/o/a' })
    expect(out.stdout.length).toBeLessThan(1500)
    expect(out.stdout).toContain('截断')
  })

  it('blocks uninstall/update of link:/file: preset plugins locally, no request sent', async () => {    const sent = vi.fn()
    const fetchImpl = vi.fn(async (url: string) => {
      sent(String(url))
      if (String(url).includes('?token=TK')) return res(303, {}, ['sid=t'])
      if (url.endsWith('/dsh-market/installed')) {
        return res(200, {
          installed: {
            'dsh-shell-control': { spec: 'link:J:/.../node_modules/dsh-shell-control' },
            'dsh-theme-cyberpunk2077': { spec: 'github:o/cyberpunk' },
          },
        })
      }
      return res(200, { ok: true, hot: true })
    })
    const { ctx, registered } = makeCtx(fetchImpl as never)
    apply(ctx as never)
    await vi.waitFor(() => expect(registered.length).toBe(4))
    const uninstall = registered.find((t) => t.name === 'market_uninstall')!
    const update = registered.find((t) => t.name === 'market_update')!

    const block = await uninstall.execute({ name: 'dsh-shell-control' })
    expect(block).toMatchObject({ ok: false, blocked: true, name: 'dsh-shell-control' })
    const blockUpd = await update.execute({ name: 'dsh-shell-control' })
    expect(blockUpd).toMatchObject({ ok: false, blocked: true })

    const pass = await uninstall.execute({ name: 'dsh-theme-cyberpunk2077' })
    expect(pass.ok).toBe(true)
    // blocked preset mutations must NOT hit the mutating route (only /installed)
    expect(sent.mock.calls.filter(([u]) => String(u).includes('/dsh-market/uninstall'))).toHaveLength(1)
    expect(sent.mock.calls.filter(([u]) => String(u).includes('/dsh-market/update'))).toHaveLength(0)
    // that single uninstall call is the user-plugin pass, body carries the right name
    const uninstallUrl = sent.mock.calls.find(([u]) => String(u).includes('/dsh-market/uninstall'))![0] as string
    expect(uninstallUrl).toContain('http://127.0.0.1:4321/dsh-market/uninstall')
  })

  it('sends the running agent id on mutating calls when ctx.agent is present', async () => {
    const bodies: string[] = []
    const fetchImpl = vi.fn(async (url: string, init: Record<string, any> = {}) => {
      if (String(url).includes('?token=TK')) return res(303, {}, ['sid=t'])
      bodies.push(String(init.body))
      if (url.endsWith('/dsh-market/installed')) {
        return res(200, { installed: { a: 'github:o/a' }, present: ['a'], disabled: [], live: {} })
      }
      return res(200, { ok: true, hot: true })
    })
    const { ctx, registered } = makeCtx(fetchImpl as never, 'session-agent-1')
    apply(ctx as never)
    await vi.waitFor(() => expect(registered.length).toBe(4))
    await registered.find((t) => t.name === 'market_install')!.execute({ url: 'https://github.com/o/a' })
    await registered.find((t) => t.name === 'market_uninstall')!.execute({ name: 'a' })
    expect(bodies.find((b) => b.includes('/dsh-market/install') || b.includes('url'))).toBe('{"url":"https://github.com/o/a","agentId":"session-agent-1"}')
    expect(bodies).toContain('{"name":"a","agentId":"session-agent-1"}')
  })

  it('omits agentId when ctx has no running agent', async () => {
    const bodies: string[] = []
    const fetchImpl = vi.fn(async (url: string, init: Record<string, any> = {}) => {
      if (String(url).includes('?token=TK')) return res(303, {}, ['sid=t'])
      bodies.push(String(init.body))
      return res(200, { ok: true, hot: true })
    })
    const { ctx, registered } = makeCtx(fetchImpl as never)
    apply(ctx as never)
    await vi.waitFor(() => expect(registered.length).toBe(4))
    await registered.find((t) => t.name === 'market_install')!.execute({ url: 'https://github.com/o/a' })
    expect(bodies).toContain('{"url":"https://github.com/o/a"}')
    expect(bodies[0]).not.toContain('agentId')
  })
})
