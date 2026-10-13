// dsh-market-tools · 纯逻辑层单测
// 跑法：node --test test/
// 不碰网络、不碰 profile：所有输入都是构造出来的 registry/installed 形状，
// 形状取自实测的 GET /dsh-market/registry 与 /dsh-market/installed 响应。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  summarizeCatalog,
  summarizeCategories,
  describeEntry,
  resolveCatalogEntry,
  interpretBlocked,
  presetNames,
  guardPreset,
  createMarketClient,
  createCachedSource,
  extractCookies,
  DEFAULT_LIMIT,
  MAX_LIMIT,
} from '../lib/http.js'

const registry = {
  source: 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin',
  updated: '2026-10-11',
  count: 6,
  categories: {
    ui: { en: 'UI Enhancements', zh: 'UI 增强' },
    security: { en: 'Security', zh: '安全与权限' },
    market: { en: 'Market', zh: '插件市场与管理' },
  },
  plugins: [
    {
      name: 'dsh-whale-pet', owner: 'aaa', url: 'https://github.com/aaa/pet',
      category: 'fun', description: { en: 'pet', zh: '桌宠' }, npm: 'dsh-whale-pet', version: '1.0.0',
      stars: 3, downloads: 10, capabilities: ['fs-read'], added: '2026-01-01',
    },
    {
      name: 'dsh-whale-pet', owner: 'bbb', url: 'https://github.com/bbb/pet',
      category: 'fun', description: { en: 'pet 2', zh: '桌宠二号' }, npm: 'dsh-whale-pet-bbb', version: '2.0.0',
      stars: 9, downloads: 900, capabilities: [], added: '2026-02-01',
    },
    {
      name: 'dsh-audit', owner: 'ccc', url: 'https://github.com/ccc/audit',
      category: 'security', description: { en: 'audit', zh: '接口审计' }, npm: 'dsh-audit', version: '0.5.0',
      stars: 40, downloads: 5000, capabilities: ['fs-write', 'env'], capabilityRedLines: ['env'], added: '2026-03-01',
    },
    {
      name: 'dsh-skin', owner: 'ddd', url: 'https://github.com/ddd/skin',
      category: ['ui'], description: { en: 'skin', zh: '换肤' }, npm: 'dsh-skin', version: '3.1.0',
      stars: 1, downloads: 20, capabilities: [], added: '2026-09-01',
    },
    {
      name: 'dsh-market-tools', owner: 'eee', url: 'https://github.com/eee/tools',
      category: 'market', description: { en: 'tools', zh: '市场工具位' }, npm: 'dsh-market-tools', version: '0.2.0',
      stars: 2, downloads: 30, capabilities: ['fs-write'], added: '2026-08-01',
    },
    {
      name: 'dsh-long-desc', owner: 'fff', url: 'https://github.com/fff/long',
      category: 'ui', description: { zh: 'x'.repeat(500) }, version: '0.1.0', downloads: 5, added: '2026-04-01',
    },
  ],
}
const registryJson = { registry, hostVersion: '0.1.7' }
const installedJson = {
  profile: 'desktop',
  installed: {
    'dsh-audit': '^0.5.0',
    '@agents-anywhere/dsh-bridge-next': 'link:C:/x/y',
  },
  present: ['dsh-audit', '@agents-anywhere/dsh-bridge-next'],
  disabled: [],
  live: { 'dsh-audit': {} },
}

test('空 query 不返回整份目录：默认只给 DEFAULT_LIMIT 条并标记 truncated', () => {
  const big = { ...registry, plugins: Array.from({ length: 400 }, (_, i) => ({
    name: `p${i}`, owner: 'o', url: `https://github.com/o/p${i}`, category: 'tools',
    description: { zh: 'd' }, downloads: i,
  })) }
  const out = summarizeCatalog({ registry: big }, installedJson)
  assert.equal(out.catalogTotal, 400)
  assert.equal(out.matched, 400)
  assert.equal(out.returned, DEFAULT_LIMIT)
  assert.equal(out.truncated, true)
  // 热度排序：downloads 高的在前
  assert.equal(out.catalog[0].downloads, 399)
})

test('limit 有上限，非法值退回默认', () => {
  assert.equal(summarizeCatalog(registryJson, installedJson, { limit: 99999 }).limit, MAX_LIMIT)
  assert.equal(summarizeCatalog(registryJson, installedJson, { limit: 'abc' }).limit, DEFAULT_LIMIT)
  assert.equal(summarizeCatalog(registryJson, installedJson, { limit: -5 }).limit, 1)
})

test('capabilities 与 capabilityRedLines 被保留（旧版聚合会丢掉）', () => {
  const out = summarizeCatalog(registryJson, installedJson, { query: 'dsh-audit' })
  const entry = out.catalog.find((e) => e.name === 'dsh-audit')
  assert.deepEqual(entry.capabilities, ['fs-write', 'env'])
  assert.deepEqual(entry.capabilityRedLines, ['env'])
  assert.equal(entry.installed, true)
})

test('分类中文名可以直接当 query 用', () => {
  const out = summarizeCatalog(registryJson, installedJson, { query: '安全与权限' })
  assert.deepEqual(out.catalog.map((e) => e.name), ['dsh-audit'])
})

test('category 支持 id 与中文名两种写法', () => {
  const byId = summarizeCatalog(registryJson, installedJson, { category: 'ui' })
  assert.deepEqual(byId.catalog.map((e) => e.name).sort(), ['dsh-long-desc', 'dsh-skin'])
  const byZh = summarizeCatalog(registryJson, installedJson, { category: 'UI 增强' })
  assert.deepEqual(byZh.catalog.map((e) => e.name).sort(), ['dsh-long-desc', 'dsh-skin'])
  assert.equal(summarizeCatalog(registryJson, installedJson, { category: '不存在' }).matched, 0)
})

test('列表里的长描述被截断，market_info 给更长的版本', () => {
  const listed = summarizeCatalog(registryJson, installedJson, { query: 'dsh-long-desc' })
  assert.ok(listed.catalog[0].description.length <= 221)
  const info = describeEntry(registryJson, installedJson, 'dsh-long-desc')
  assert.ok(info.catalogEntry.description.length > listed.catalog[0].description.length)
  assert.ok(info.catalogEntry.description.length <= 1201)
})

test('installedOnly 只看目录里已装的条目', () => {
  const out = summarizeCatalog(registryJson, installedJson, { installedOnly: true })
  assert.deepEqual(out.catalog.map((e) => e.name), ['dsh-audit'])
})

test('sort=new 按收录时间，sort=name 按名字', () => {
  assert.equal(summarizeCatalog(registryJson, installedJson, { sort: 'new' }).catalog[0].name, 'dsh-skin')
  assert.equal(summarizeCatalog(registryJson, installedJson, { sort: 'name' }).catalog[0].name, 'dsh-audit')
})

test('旧调用方式（第三个参数给字符串）仍然可用', () => {
  const out = summarizeCatalog(registryJson, installedJson, 'dsh-audit')
  assert.deepEqual(out.catalog.map((e) => e.name), ['dsh-audit'])
})

test('installed 摘要带 present/disabled/live', () => {
  const out = summarizeCatalog(registryJson, installedJson)
  assert.deepEqual(out.installed['dsh-audit'], { spec: '^0.5.0', present: true, disabled: false, live: true })
  assert.equal(out.installed['@agents-anywhere/dsh-bridge-next'].live, false)
})

test('summarizeCategories 给出中文名与已装条数', () => {
  const out = summarizeCategories(registryJson, installedJson)
  const security = out.categories.find((c) => c.id === 'security')
  assert.equal(security.zh, '安全与权限')
  assert.equal(security.count, 1)
  assert.equal(security.installed, 1)
  assert.equal(out.catalogTotal, 6)
})

test('describeEntry 认 name / npm / url，找不到时给候选', () => {
  assert.equal(describeEntry(registryJson, installedJson, 'dsh-skin').catalogEntry.version, '3.1.0')
  assert.equal(describeEntry(registryJson, installedJson, 'dsh-whale-pet-bbb').catalogEntry.owner, 'bbb')
  assert.equal(describeEntry(registryJson, installedJson, 'https://github.com/ccc/audit').catalogEntry.name, 'dsh-audit')
  const miss = describeEntry(registryJson, installedJson, 'dsh-whale')
  assert.equal(miss.ok, false)
  assert.ok(miss.suggestions.length >= 1)
  // 目录里没有但本机装着的，按已安装信息回答
  const local = describeEntry(registryJson, installedJson, '@agents-anywhere/dsh-bridge-next')
  assert.equal(local.ok, true)
  assert.equal(local.catalogEntry, null)
  assert.equal(local.installed.spec, 'link:C:/x/y')
})

test('resolveCatalogEntry 同名多条时不猜，返回全部候选 url', () => {
  const dup = resolveCatalogEntry(registryJson, 'dsh-whale-pet')
  assert.equal(dup.ok, false)
  assert.equal(dup.candidates.length, 2)
  assert.ok(dup.candidates.every((c) => typeof c.url === 'string' && c.url.startsWith('https://')))
  assert.equal(resolveCatalogEntry(registryJson, 'dsh-skin').entry.url, 'https://github.com/ddd/skin')
  assert.equal(resolveCatalogEntry(registryJson, '').ok, false)
})

test('interpretBlocked 只把 guard 的 409 翻译成可行动结论', () => {
  const blocked = interpretBlocked({
    status: 409,
    json: { error: '有 agent 正在运行', agentsBusy: true, runningAgents: ['session-1'] },
  })
  assert.equal(blocked.blocked, true)
  assert.deepEqual(blocked.runningAgents, ['session-1'])
  assert.equal(typeof blocked.hint, 'string')
  assert.equal(interpretBlocked({ status: 400, json: { error: 'plugin is not in the curated registry' } }), null)
  assert.equal(interpretBlocked({ status: 409, json: { error: '另一个更新操作在跑' } }), null)
  assert.equal(interpretBlocked({ status: 200, json: { ok: true } }), null)
})

test('预置插件按 spec 前缀识别，不靠硬编码名单', () => {
  assert.equal(guardPreset('link:C:/a'), true)
  assert.equal(guardPreset('file:./x'), true)
  assert.equal(guardPreset('^1.66.17'), false)
  assert.deepEqual(presetNames(installedJson), ['@agents-anywhere/dsh-bridge-next'])
})

test('401 重铸 cookie 后重试，且每次尝试用各自的新 signal', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, signal: init?.signal })
    if (url.includes('?token=')) return { status: 303, headers: { getSetCookie: () => ['dsh_launch_token=tok; Path=/'] } }
    if (calls.filter((c) => c.url === url).length === 1) return { status: 401, text: async () => '{"error":"no session"}' }
    return { status: 200, text: async () => '{"ok":true}' }
  }
  const client = createMarketClient({ port: 19387, authenticatedUrl: (u) => `${u}?token=x`, fetchImpl })
  const res = await client.call('/dsh-market/installed')
  assert.equal(res.status, 200)
  assert.equal(res.json.ok, true)
  const attempts = calls.filter((c) => c.url.includes('/dsh-market/installed'))
  assert.equal(attempts.length, 2)
  assert.notEqual(attempts[0].signal, attempts[1].signal, '两次尝试不能共用同一个 AbortSignal')
  assert.equal(attempts[0].signal.aborted, false)
})

test('mutating POST 带上发起 agent 的 id（向前兼容占位，市场当前不读）', async () => {
  const seen = []
  const fetchImpl = async (url, init) => {
    seen.push({ url, body: init?.body })
    if (url.endsWith('/')) return { status: 303, headers: { getSetCookie: () => ['t=1; Path=/'] } }
    return { status: 200, text: async () => '{"ok":true}' }
  }
  const client = createMarketClient({ port: 1, authenticatedUrl: (u) => u, agentId: 'session-abc', fetchImpl })
  await client.call('/dsh-market/install', { method: 'POST', body: { url: 'https://github.com/o/p' } })
  await client.call('/dsh-market/registry')
  const post = seen.find((c) => c.url.endsWith('/install'))
  assert.deepEqual(JSON.parse(post.body), { url: 'https://github.com/o/p', agentId: 'session-abc' })
  const get = seen.find((c) => c.url.endsWith('/registry'))
  assert.equal(get.body, undefined)
})

test('目录缓存：TTL 内不重复取，invalidate 后重新取', async () => {
  let hits = 0
  const source = createCachedSource({
    registry: async () => { hits += 1; return { registry } },
    installed: async () => installedJson,
  }, 60000)
  await source.registry()
  await source.registry()
  assert.equal(hits, 1)
  source.invalidate()
  await source.registry()
  assert.equal(hits, 2)
})

test('extractCookies 兼容 getSetCookie 与单串 get', () => {
  assert.deepEqual(extractCookies({ getSetCookie: () => ['a=1; Path=/', 'b=2; HttpOnly'] }), ['a=1', 'b=2'])
  assert.deepEqual(extractCookies({ get: () => 'c=3; Path=/' }), ['c=3'])
  assert.deepEqual(extractCookies(undefined), [])
})
