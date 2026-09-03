// dsh-market-tools · 本地市场 HTTP 客户端与目录聚合的单测（纯 mock，零网络）
import { describe, expect, it, vi } from 'vitest'
import { createMarketClient, entryDescription, extractCookies, summarizeCatalog } from '../plugins/dsh-market-tools/lib/http.js'

/** 构造一个最小 fetch 响应。 */
function res(status: number, body: unknown, cookies: string[] = []) {
  return {
    status,
    headers: {
      getSetCookie: () => cookies,
      get: (name: string) => (name === 'set-cookie' ? cookies.join(', ') : null),
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

describe('extractCookies', () => {
  it('prefers undici getSetCookie and strips attributes', () => {
    const headers = { getSetCookie: () => ['dsh_session=abc; Path=/; HttpOnly', 'x=1; Secure'] }
    expect(extractCookies(headers as never)).toEqual(['dsh_session=abc', 'x=1'])
  })

  it('falls back to a single get(set-cookie) header', () => {
    const headers = { get: (name: string) => (name === 'set-cookie' ? 'sid=42; Path=/' : null) }
    expect(extractCookies(headers as never)).toEqual(['sid=42'])
  })

  it('drops entries without a value and missing headers', () => {
    expect(extractCookies({ getSetCookie: () => ['garbage'] } as never)).toEqual([])
    expect(extractCookies(undefined)).toEqual([])
  })
})

describe('createMarketClient', () => {
  const deps = { port: 3456, authenticatedUrl: (url: string) => `${url}?token=TOK` }

  it('mints a session cookie once, then sends Origin + Cookie on every call', async () => {
    const calls: Array<{ url: string; init: Record<string, never> }> = []
    const fetchImpl = vi.fn(async (url: string, init: Record<string, never>) => {
      calls.push({ url, init })
      if (url.includes('?token=')) return res(303, '', ['sid=99; Path=/'])
      return res(200, { ok: true })
    })
    const client = createMarketClient({ ...deps, fetchImpl: fetchImpl as never })
    expect(await client.call('/dsh-market/registry')).toEqual({ status: 200, json: { ok: true } })
    expect(await client.call('/dsh-market/installed')).toEqual({ status: 200, json: { ok: true } })
    // 铸一次 cookie + 两次路由调用；cookie 交换走 manual redirect
    expect(calls).toHaveLength(3)
    expect(calls[0].url).toBe('http://127.0.0.1:3456/?token=TOK')
    expect(calls[0].init.redirect).toBe('manual')
    expect(calls[1].init.headers).toMatchObject({ origin: 'http://127.0.0.1:3456', cookie: 'sid=99' })
    expect(calls[2].init.headers).toMatchObject({ cookie: 'sid=99' })
  })

  it('re-mints and retries once after a 401', async () => {
    let routeHits = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('?token=')) return res(303, '', [`sid=v${String(routeHits)}`])
      routeHits += 1
      return routeHits === 1 ? res(401, { error: 'unauthorized' }) : res(200, { ok: true })
    })
    const client = createMarketClient({ ...deps, fetchImpl: fetchImpl as never })
    expect(await client.call('/dsh-market/toggle', { method: 'POST', body: { name: 'x' } })).toEqual({ status: 200, json: { ok: true } })
    expect(routeHits).toBe(2)
  })

  it('sends JSON bodies with content-type for mutations', async () => {
    let seen: Record<string, never> | undefined
    const fetchImpl = vi.fn(async (url: string, init: Record<string, never>) => {
      if (!url.includes('?token=')) seen = init
      return url.includes('?token=') ? res(303, '', ['sid=1']) : res(200, { ok: true })
    })
    const client = createMarketClient({ ...deps, fetchImpl: fetchImpl as never })
    await client.call('/dsh-market/install', { method: 'POST', body: { url: 'https://github.com/a/b' } })
    expect(seen?.method).toBe('POST')
    expect(seen?.headers).toMatchObject({ 'content-type': 'application/json' })
    expect(seen?.body).toBe('{"url":"https://github.com/a/b"}')
  })

  it('degrades non-JSON responses to a readable error payload', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('?token=') ? res(303, '', ['sid=1']) : res(500, '<html>boom</html>'),
    )
    const client = createMarketClient({ ...deps, fetchImpl: fetchImpl as never })
    const out = await client.call('/dsh-market/registry')
    expect(out.status).toBe(500)
    expect(out.json.ok).toBe(false)
    expect(out.json.raw).toContain('boom')
  })
})

describe('summarizeCatalog', () => {
  const registryJson = {
    source: 'live',
    registry: {
      plugins: [
        { name: 'dsh-sentinel', owner: 'fuhefei', url: 'https://github.com/fuhefei/dsh-sentinel', category: 'automation', description: { zh: '唤醒系统', en: 'wake system' } },
        { name: 'other', owner: 'x', url: 'https://github.com/x/other', category: 'ui', description: 'plain string desc' },
      ],
    },
  }
  const installedJson = {
    installed: { 'dsh-sentinel': 'github:fuhefei/dsh-sentinel', dshmarket: 'link:J:/app/node_modules/dshmarket' },
    present: ['dsh-sentinel', 'dshmarket'],
    disabled: [],
    live: { 'dsh-sentinel': {} },
  }

  it('merges registry and installed state, preserving source', () => {
    const out = summarizeCatalog(registryJson, installedJson)
    expect(out.source).toBe('live')
    expect(out.total).toBe(2)
    expect(out.catalog[0]).toMatchObject({ name: 'dsh-sentinel', installed: true, description: '唤醒系统' })
    expect(out.installed.dshmarket).toMatchObject({ present: true, disabled: false, live: false })
    expect(out.note).toContain('link:')
  })

  it('filters case-insensitively across name/owner/description/category', () => {
    expect(summarizeCatalog(registryJson, installedJson, 'SENTINEL').catalog).toHaveLength(1)
    expect(summarizeCatalog(registryJson, installedJson, '唤醒').catalog).toHaveLength(1)
    expect(summarizeCatalog(registryJson, installedJson, '  UI  ').catalog).toHaveLength(1)
    expect(summarizeCatalog(registryJson, installedJson, 'zzz').catalog).toHaveLength(0)
  })

  it('survives malformed inputs', () => {
    expect(summarizeCatalog({}, {}).catalog).toEqual([])
    expect(entryDescription(undefined)).toBe('')
    expect(entryDescription({ description: { en: 'e' } })).toBe('e')
  })
})
