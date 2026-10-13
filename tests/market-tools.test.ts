// dsh-market-tools · 本地市场 HTTP 客户端与目录聚合的单测（纯 mock，零网络）
import { describe, expect, it, vi } from 'vitest'
import {
  createMarketClient,
  describeEntry,
  entryDescription,
  extractCookies,
  guardPreset,
  interpretBlocked,
  presetNames,
  resolveCatalogEntry,
  specOf,
  summarizeCatalog,
  summarizeCategories,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '../plugins/dsh-market-tools/lib/http.js'

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

  it('merges agentId into mutating POST bodies when provided', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string, init: Record<string, never>) => {
      if (!url.includes('?token=')) seen.push(String(init.body))
      return url.includes('?token=') ? res(303, '', ['sid=1']) : res(200, { ok: true })
    })
    const client = createMarketClient({ ...deps, agentId: 'session-test-abc', fetchImpl: fetchImpl as never })
    await client.call('/dsh-market/install', { method: 'POST', body: { url: 'https://github.com/a/b' } })
    await client.call('/dsh-market/uninstall', { method: 'POST', body: { name: 'x' } })
    expect(seen[0]).toBe('{"url":"https://github.com/a/b","agentId":"session-test-abc"}')
    expect(seen[1]).toBe('{"name":"x","agentId":"session-test-abc"}')
  })

  it('does not touch GET or bodyless calls, nor POSTs without an agentId', async () => {
    const seen: string[] = []
    const fetchImpl = vi.fn(async (url: string, init: Record<string, never>) => {
      if (!url.includes('?token=')) seen.push(String(init.body))
      return url.includes('?token=') ? res(303, '', ['sid=1']) : res(200, { ok: true })
    })
    const withAgent = createMarketClient({ ...deps, agentId: 'session-x', fetchImpl: fetchImpl as never })
    await withAgent.call('/dsh-market/registry')
    expect(seen[0]).toBe('undefined')
    const withoutAgent = createMarketClient({ ...deps, fetchImpl: fetchImpl as never })
    await withoutAgent.call('/dsh-market/install', { method: 'POST', body: { url: 'https://github.com/a/b' } })
    expect(seen[1]).toBe('{"url":"https://github.com/a/b"}')
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

  it('空 query 不返回整份目录：默认有界 + truncated + 热度排序', () => {
    const big = { registry: { plugins: Array.from({ length: 400 }, (_, i) => ({
      name: `p${i}`, owner: 'o', url: `https://github.com/o/p${i}`, category: 'tools',
      description: { zh: 'd' }, downloads: i,
    })) } }
    const out = summarizeCatalog(big, {})
    expect(out.total).toBe(400)
    expect(out.matched).toBe(400)
    expect(out.returned).toBe(DEFAULT_LIMIT)
    expect(out.truncated).toBe(true)
    expect(out.catalog[0].downloads).toBe(399)
  })

  it('limit 有上限，非法值退回默认', () => {
    expect(summarizeCatalog({}, {}, { limit: 99999 }).limit).toBe(MAX_LIMIT)
    expect(summarizeCatalog({}, {}, { limit: 'abc' as never }).limit).toBe(DEFAULT_LIMIT)
    expect(summarizeCatalog({}, {}, { limit: -5 }).limit).toBe(1)
  })

  it('保留 capabilities / capabilityRedLines（旧聚合会丢掉，等于让 AI 看不见权限就装插件）', () => {
    const reg = { registry: { plugins: [{
      name: 'dsh-audit', owner: 'c', url: 'https://github.com/c/audit', category: 'security',
      description: { zh: '审计' }, capabilities: ['fs-write', 'env'], capabilityRedLines: ['env'],
    }] } }
    const entry = summarizeCatalog(reg, {}).catalog[0]
    expect(entry.capabilities).toEqual(['fs-write', 'env'])
    expect(entry.capabilityRedLines).toEqual(['env'])
  })

  it('目录自带的分类中文名可以直接当 query / category 用', () => {
    const reg = { registry: {
      categories: { security: { en: 'Security', zh: '安全与权限' }, ui: { en: 'UI', zh: 'UI 增强' } },
      plugins: [
        { name: 'a', owner: 'o', url: 'https://github.com/o/a', category: 'security', description: { zh: 'a' } },
        { name: 'b', owner: 'o', url: 'https://github.com/o/b', category: ['ui'], description: { zh: 'b' } },
      ],
    } }
    expect(summarizeCatalog(reg, {}, { query: '安全与权限' }).catalog.map((e) => e.name)).toEqual(['a'])
    expect(summarizeCatalog(reg, {}, { category: 'UI 增强' }).catalog.map((e) => e.name)).toEqual(['b'])
    expect(summarizeCatalog(reg, {}, { category: '不存在' }).matched).toBe(0)
  })

  it('列表描述截断，market_info 给更长的版本', () => {
    const reg = { registry: { plugins: [{ name: 'long', owner: 'o', url: 'https://github.com/o/long', category: 'ui', description: { zh: 'x'.repeat(500) } }] } }
    const listed = summarizeCatalog(reg, {}, { query: 'long' }).catalog[0]
    const info = describeEntry(reg, {}, 'long')
    expect(listed.description.length).toBeLessThanOrEqual(221)
    expect(info.catalogEntry!.description.length).toBeGreaterThan(listed.description.length)
    expect(info.catalogEntry!.description.length).toBeLessThanOrEqual(1201)
  })

  it('installedOnly / sort=new / sort=name 生效', () => {
    const reg = { registry: { plugins: [
      { name: 'a', owner: 'o', url: 'https://github.com/o/a', category: 'ui', description: { zh: 'a' }, added: '2026-01-01', downloads: 10 },
      { name: 'b', owner: 'o', url: 'https://github.com/o/b', category: 'ui', description: { zh: 'b' }, added: '2026-09-01', downloads: 1 },
    ] } }
    const installed = { installed: { a: '^1.0.0' }, present: ['a'], disabled: [], live: {} }
    expect(summarizeCatalog(reg, installed, { installedOnly: true }).catalog.map((e) => e.name)).toEqual(['a'])
    expect(summarizeCatalog(reg, {}, { sort: 'new' }).catalog[0].name).toBe('b')
    expect(summarizeCatalog(reg, {}, { sort: 'name' }).catalog[0].name).toBe('a')
    expect(summarizeCatalog(reg, installed, { sort: 'installed' }).catalog[0].name).toBe('a')
  })

  it('旧调用方式（第三个参数给字符串）仍然可用', () => {
    const reg = { registry: { plugins: [{ name: 'a', owner: 'o', url: 'https://github.com/o/a', category: 'ui', description: { zh: 'a' } }] } }
    expect(summarizeCatalog(reg, {}, 'a').catalog.map((e) => e.name)).toEqual(['a'])
  })
})

describe('installed spec 形状（真机是字符串，测试里见过对象）', () => {
  it('specOf 两种形状都吃', () => {
    expect(specOf('link:C:/x/y')).toBe('link:C:/x/y')
    expect(specOf({ spec: 'file:./x' })).toBe('file:./x')
    expect(specOf(undefined)).toBe('')
    expect(specOf(null)).toBe('')
    expect(specOf(42 as never)).toBe('')
  })

  it('真机形状下预置守卫真的能拦住（字符串没有 .spec，旧读法永远读不到）', () => {
    const realShape = {
      installed: {
        'dsh-our-free-model': 'link:C:/Users/me/.dsh/local-plugins/dsh-our-free-model',
        dshmarket: '^1.66.17',
      },
      present: ['dsh-our-free-model', 'dshmarket'],
      disabled: [],
      live: {},
    }
    expect(presetNames(realShape)).toEqual(['dsh-our-free-model'])
    expect(guardPreset(specOf(realShape.installed['dsh-our-free-model']))).toBe(true)
    expect(guardPreset(specOf(realShape.installed.dshmarket))).toBe(false)
    const out = summarizeCatalog({}, realShape)
    expect(out.installed['dsh-our-free-model'].spec).toBe('link:C:/Users/me/.dsh/local-plugins/dsh-our-free-model')
  })
})

describe('describeEntry / resolveCatalogEntry / interpretBlocked / summarizeCategories', () => {
  const registryJson = { registry: {
    categories: { memory: { en: 'Memory', zh: '记忆' } },
    plugins: [
      { name: 'dsh-knit', owner: 'o1', url: 'https://github.com/o1/knit', npm: 'dsh-knit', category: 'memory', description: { zh: 'knit' }, version: '0.22.0', downloads: 3880, capabilities: ['shell'], added: '2026-08-01', install: 'dsh plugin add dsh-knit' },
      { name: 'dsh-whale-pet', owner: 'a', url: 'https://github.com/a/pet', category: 'fun', description: { zh: 'pet' } },
      { name: 'dsh-whale-pet', owner: 'b', url: 'https://github.com/b/pet', category: 'fun', description: { zh: 'pet2' } },
    ],
  } }
  const installedJson = { installed: { 'dsh-knit': '^0.22.0' }, present: ['dsh-knit'], disabled: [], live: {} }

  it('describeEntry 认 name / npm / url，找不到时给候选，目录外已装的按已安装回答', () => {
    expect(describeEntry(registryJson, installedJson, 'dsh-knit')!.catalogEntry!.version).toBe('0.22.0')
    expect(describeEntry(registryJson, installedJson, 'https://github.com/b/pet').catalogEntry!.owner).toBe('b')
    expect(describeEntry(registryJson, installedJson, 'dsh-knit').installed).toMatchObject({ spec: '^0.22.0', present: true })
    const miss = describeEntry(registryJson, installedJson, 'dsh-whale')
    expect(miss.ok).toBe(false)
    expect(miss.suggestions!.length).toBe(2)
    expect(describeEntry(registryJson, installedJson, '').ok).toBe(false)
  })

  it('resolveCatalogEntry 同名多条时不猜，返回全部候选 url', () => {
    const dup = resolveCatalogEntry(registryJson, 'dsh-whale-pet')
    expect(dup.ok).toBe(false)
    expect(dup.candidates!.map((c) => c.url)).toEqual(['https://github.com/a/pet', 'https://github.com/b/pet'])
    expect(resolveCatalogEntry(registryJson, 'dsh-knit').entry!.name).toBe('dsh-knit')
    expect(resolveCatalogEntry(registryJson, 'nope').ok).toBe(false)
  })

  it('interpretBlocked 只把 running-agent guard 的 409 翻译成可行动结论', () => {
    const blocked = interpretBlocked({ status: 409, json: { error: '有 agent 正在运行', agentsBusy: true, runningAgents: ['session-1'] } })
    expect(blocked).toMatchObject({ blocked: true, reason: 'agents-busy' })
    expect(blocked!.runningAgents).toEqual(['session-1'])
    expect(typeof blocked!.hint).toBe('string')
    expect(interpretBlocked({ status: 400, json: { error: 'plugin is not in the curated registry' } })).toBeNull()
    expect(interpretBlocked({ status: 409, json: { error: '另一个更新操作在跑' } })).toBeNull()
    expect(interpretBlocked({ status: 200, json: { ok: true } })).toBeNull()
  })

  it('summarizeCategories 给出中文名与已装条数', () => {
    const out = summarizeCategories(registryJson, installedJson)
    expect(out.total).toBe(3)
    const memory = out.categories.find((c) => c.id === 'memory')
    expect(memory).toMatchObject({ zh: '记忆', count: 1, installed: 1 })
  })
})
