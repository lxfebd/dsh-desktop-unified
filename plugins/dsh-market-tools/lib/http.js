// dsh-market-tools · 本地市场 HTTP 客户端 + 目录聚合（纯逻辑，可单测）
//
// 在 dsh web 进程内自调本进程的 webServer：先用 connection.authenticatedUrl
// 的 303 响应铸造会话 cookie（与 Electron 壳探测就绪的官方握手一致），再带
// Origin 头过 dshmarket 路由的同源校验。401（签名轮换/进程重启）时重铸一次。
//
// 聚合层的存在理由：精选目录已经 4500+ 条 / 4.3 MB（实测 GET /dsh-market/registry
// 返回 4347178 字节）。把整份目录原样交给模型等于一次调用灌进几十万字符，所以
// 这里做「过滤 → 排序 → 截断 → 只保留决策需要的字段」，并把市场侧已经提供的
// 分类中文名、capabilities 安全元数据保留下来。

/** 默认目录返回条数：够模型挑插件，又不至于撑爆上下文。 */
export const DEFAULT_LIMIT = 30
/** 上限：再多就该用 market_info 逐条看，而不是把目录当数据倒。 */
export const MAX_LIMIT = 150
/** 列表里的描述压到这么长；完整描述走 market_info。 */
const LIST_DESCRIPTION_MAX = 220
const INFO_DESCRIPTION_MAX = 1200
const DEFAULT_TIMEOUT_MS = 30000
const SORTS = new Set(['hot', 'new', 'name', 'installed'])

/** 从响应头提取 Set-Cookie（undici 的 getSetCookie 优先，退到单串 get）。 */
export function extractCookies(headers) {
  if (!headers) return []
  const raw = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [typeof headers.get === 'function' ? headers.get('set-cookie') : null].filter(Boolean)
  return raw
    .map((entry) => String(entry).split(';')[0].trim())
    .filter((pair) => pair.includes('='))
}

/**
 * 创建指向本机 dsh-market 路由的客户端。
 * @param deps - { port, authenticatedUrl, agentId?, fetchImpl?, timeoutMs? }
 *   agentId 会被放进每次 mutating POST 的 body。注意：dshmarket 1.40 到 1.66
 *   的 running-agent guard 并不读这个字段（整个 lib 目录里 `agentId` 出现 0
 *   次，guard 走的是 agents.list() 里 status === 'running' 的全部 agent），
 *   所以它现在只是向前兼容的占位。真正的「被挡回」处理在 interpretBlocked()。
 * @returns { call(path, opts) } — opts: { method?, body?, timeoutMs? }
 */
export function createMarketClient(deps) {
  const { port, authenticatedUrl, agentId, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = deps
  const origin = `http://127.0.0.1:${port}`
  let cookie = ''

  async function mintCookie() {
    cookie = ''
    const url = authenticatedUrl(`${origin}/`)
    const res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
    const pairs = extractCookies(res.headers ?? {})
    if (pairs.length > 0) cookie = pairs.join('; ')
    return cookie
  }

  async function once(path, method, body, signalMs) {
    const headers = { origin }
    if (cookie) headers.cookie = cookie
    if (body !== undefined) headers['content-type'] = 'application/json'
    return fetchImpl(origin + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(Math.max(1, signalMs)),
    })
  }

  /**
   * 调一次 dsh-market 路由。鉴权失效自动重铸 cookie 重试一次。
   * 每次尝试都用自己那份剩余预算新建 AbortSignal：旧实现只建一次 signal，
   * 401 重试复用同一个已经在倒计时的 signal，默认 30s 时重试可能一点时间都不剩。
   * @returns 路由返回的 JSON；解析失败时退到 { ok:false, error, raw }。
   */
  async function call(path, opts = {}) {
    const method = opts.method ?? 'GET'
    const budget = opts.timeoutMs ?? timeoutMs
    const startedAt = Date.now()
    const remaining = () => Math.max(1, budget - (Date.now() - startedAt))
    let body = opts.body
    if (method === 'POST' && typeof agentId === 'string' && agentId !== '') {
      body = { ...(body && typeof body === 'object' ? body : {}), agentId }
    }
    if (!cookie) await mintCookie()
    let res = await once(path, method, body, remaining())
    if (res.status === 401) {
      await mintCookie()
      res = await once(path, method, body, remaining())
    }
    const text = await res.text()
    try {
      return { status: res.status, json: JSON.parse(text) }
    } catch {
      return { status: res.status, json: { ok: false, error: `non-json response (HTTP ${res.status})`, raw: text.slice(0, 500) } }
    }
  }

  return { call, origin }
}

/** 目录条目的展示描述：兼容 string 与 {zh,en} 双语对象。 */
export function entryDescription(entry) {
  const d = entry?.description
  if (typeof d === 'string') return d
  if (d && typeof d === 'object') return d.zh ?? d.en ?? ''
  return ''
}

function trimText(text, max) {
  const value = String(text ?? '')
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}

function categoryList(entry) {
  if (Array.isArray(entry?.category)) {
    return entry.category.filter((item) => typeof item === 'string' && item !== '')
  }
  return typeof entry?.category === 'string' && entry.category !== '' ? [entry.category] : []
}

/**
 * registry.categories 的 {id: {id, zh, en}}。目录本身带中文标签（实测 23 个分类
 * 都有 zh），所以不需要插件自己编一套；缺字段时退到 id 自己。
 */
export function categoryLabels(registry) {
  const raw = registry?.categories
  const out = {}
  for (const [id, value] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    out[id] = {
      id,
      zh: typeof value?.zh === 'string' && value.zh !== '' ? value.zh : id,
      en: typeof value?.en === 'string' && value.en !== '' ? value.en : id,
    }
  }
  return out
}

function clampLimit(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : DEFAULT_LIMIT
  return Math.min(Math.max(n, 1), MAX_LIMIT)
}

/** 热度：目录里的 downloads 是累计值，取对数压平，避免头部插件把分数拉飞。 */
function popularity(entry) {
  const downloads = Number.isFinite(entry?.downloads) ? entry.downloads : 0
  const stars = Number.isFinite(entry?.stars) ? entry.stars : 0
  return Math.log10(downloads + 1) * 12 + Math.min(stars, 50) * 2
}

/** 搜索命中强度：名字精确 > 名字前缀 > 名字包含 > 作者 > 分类 > 描述 > URL。 */
function matchScore(entry, query, labels) {
  if (!query) return 0
  let score = 0
  const name = String(entry?.name ?? '').toLowerCase()
  if (name === query) score += 1000
  else if (name.startsWith(query)) score += 500
  else if (name.includes(query)) score += 200
  if (String(entry?.owner ?? '').toLowerCase().includes(query)) score += 80
  const categories = categoryList(entry)
  const categoryHit = categories.some((id) => {
    const label = labels[id] ?? { zh: id, en: id }
    return id.toLowerCase().includes(query)
      || String(label.zh).toLowerCase().includes(query)
      || String(label.en).toLowerCase().includes(query)
  })
  if (categoryHit) score += 60
  if (String(entryDescription(entry)).toLowerCase().includes(query)) score += 40
  if (String(entry?.url ?? '').toLowerCase().includes(query)) score += 20
  return score
}

/** 列表条目：只保留「挑插件」需要的字段，undefined 一律不占位。 */
function listEntry(entry, installedNames) {
  const out = {
    name: entry.name,
    owner: entry.owner,
    url: entry.url,
    category: categoryList(entry),
    description: trimText(entryDescription(entry), LIST_DESCRIPTION_MAX),
    installed: installedNames.has(entry.name),
  }
  if (entry.npm) out.npm = entry.npm
  if (entry.version) out.version = entry.version
  if (Number.isFinite(entry.stars)) out.stars = entry.stars
  if (Number.isFinite(entry.downloads)) out.downloads = entry.downloads
  // 市场侧的安全透明度数据：capabilities 是插件声明的能力（fs-write / env /
  // net…），capabilityRedLines 是红线标记。旧版聚合把它们全丢了，等于让 AI
  // 在看不见权限的情况下装插件。
  if (Array.isArray(entry.capabilities) && entry.capabilities.length > 0) out.capabilities = entry.capabilities
  if (Array.isArray(entry.capabilityRedLines) && entry.capabilityRedLines.length > 0) out.capabilityRedLines = entry.capabilityRedLines
  if (entry.added) out.added = entry.added
  return out
}

/**
 * installed 映射的值在真实主机上是字符串（实测："link:C:/Users/…/dsh-our-free-model"、
 * "^1.66.17"），但测试里出现过 { spec } 对象形状。两种都吃，否则预置守卫在真机上
 * 永远读不到 spec（字符串没有 .spec），link:/file: 预置插件的拦截形同不存在。
 */
export function specOf(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.spec === 'string') return value.spec
  return ''
}

function installedView(name, value, installedJson) {
  const present = new Set(Array.isArray(installedJson?.present) ? installedJson.present : [])
  const disabled = new Set(Array.isArray(installedJson?.disabled) ? installedJson.disabled : [])
  const live = new Set(Object.keys(installedJson?.live ?? {}))
  return {
    spec: specOf(value),
    present: present.has(name),
    disabled: disabled.has(name),
    live: live.has(name),
  }
}

function installedSummary(installedJson) {
  const installed = installedJson?.installed ?? {}
  const out = {}
  for (const [name, spec] of Object.entries(installed)) out[name] = installedView(name, spec, installedJson)
  return out
}

/**
 * market_list 的纯聚合：registry + installed 两份响应压成有界摘要。
 * @param registryJson - GET /dsh-market/registry 的 JSON
 * @param installedJson - GET /dsh-market/installed 的 JSON
 * @param opts - { query?, category?, limit?, sort?, installedOnly? }
 *   query 命中名称/作者/描述/分类（含中文名）/URL；category 可用 id 或中文名；
 *   sort 取 hot（默认，热度+命中强度）/ new / name / installed。
 *   也接受一个字符串当 query（旧调用方式）。
 */
export function summarizeCatalog(registryJson, installedJson, opts = {}) {
  const options = typeof opts === 'string' ? { query: opts } : (opts ?? {})
  const registry = registryJson?.registry ?? registryJson ?? {}
  const plugins = Array.isArray(registry.plugins) ? registry.plugins : []
  const labels = categoryLabels(registry)
  const installed = installedJson?.installed ?? {}
  const installedNames = new Set(Object.keys(installed))
  const query = String(options.query ?? '').toLowerCase().trim()
  const category = String(options.category ?? '').toLowerCase().trim()
  const limit = clampLimit(options.limit)
  const sort = SORTS.has(options.sort) ? options.sort : 'hot'

  let pool = plugins
  if (category) {
    pool = pool.filter((entry) => categoryList(entry).some((id) => {
      const label = labels[id] ?? { zh: id, en: id }
      return id.toLowerCase() === category
        || String(label.zh).toLowerCase() === category
        || String(label.en).toLowerCase() === category
    }))
  }
  if (options.installedOnly) pool = pool.filter((entry) => installedNames.has(entry.name))
  if (query) pool = pool.filter((entry) => matchScore(entry, query, labels) > 0)

  const matched = pool.length
  const sorted = pool.slice()
  if (sort === 'name') {
    sorted.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  } else if (sort === 'new') {
    sorted.sort((a, b) => String(b.added ?? '').localeCompare(String(a.added ?? '')))
  } else if (sort === 'installed') {
    sorted.sort((a, b) => (Number(installedNames.has(b.name)) - Number(installedNames.has(a.name)))
      || popularity(b) - popularity(a))
  } else {
    sorted.sort((a, b) => (matchScore(b, query, labels) - matchScore(a, query, labels))
      || popularity(b) - popularity(a))
  }

  const page = sorted.slice(0, limit)
  const counts = new Map()
  for (const entry of plugins) {
    for (const id of categoryList(entry)) counts.set(id, (counts.get(id) ?? 0) + 1)
  }

  return {
    source: registry.source ?? registryJson?.source ?? 'unknown',
    catalogUpdated: registry.updated ?? null,
    total: plugins.length,
    matched,
    returned: page.length,
    limit,
    sort,
    truncated: matched > page.length,
    categories: [...counts.entries()]
      .map(([id, count]) => ({ id, zh: labels[id]?.zh ?? id, count }))
      .sort((a, b) => b.count - a.count),
    catalog: page.map((entry) => listEntry(entry, installedNames)),
    installed: installedSummary(installedJson),
    note: '装插件用 catalog 条目的 url 字段（或 name）作为 market_install 参数；capabilities 是插件声明的能力，带 fs-write / env 这类标记的要先看清楚再装。installed 里 spec 以 link:/file: 开头的是桌面壳预置插件，不允许卸载或更新。',
  }
}

/**
 * market_info 的纯聚合：按 name / npm 包名 / url 精确定位一条目录条目。
 * 找不到时给出目录里的包含匹配作为候选，而不是只回一句「没有」。
 */
export function describeEntry(registryJson, installedJson, key) {
  const registry = registryJson?.registry ?? registryJson ?? {}
  const plugins = Array.isArray(registry.plugins) ? registry.plugins : []
  const installed = installedJson?.installed ?? {}
  const installedNames = new Set(Object.keys(installed))
  const needle = String(key ?? '').trim().toLowerCase()
  if (needle === '') return { ok: false, error: '缺少 name 参数' }

  const exact = (entry) => String(entry.name).toLowerCase() === needle
    || String(entry.npm ?? '').toLowerCase() === needle
    || String(entry.url ?? '').toLowerCase() === needle
    || String(entry.page ?? '').toLowerCase() === needle
  const entry = plugins.find(exact)

  if (entry === undefined) {
    const installedName = Object.keys(installed).find((name) => name.toLowerCase() === needle)
    if (installedName !== undefined) {
      return {
        ok: true,
        catalogEntry: null,
        installed: installedView(installedName, installed[installedName], installedJson),
        note: '这个插件不在精选目录里（本地安装或目录未收录），只能按已安装信息处理。',
      }
    }
    return {
      ok: false,
      error: `目录里没有「${key}」`,
      suggestions: plugins
        .filter((candidate) => String(candidate.name).toLowerCase().includes(needle))
        .slice(0, 5)
        .map((candidate) => ({ name: candidate.name, url: candidate.url })),
    }
  }

  const detail = listEntry(entry, installedNames)
  detail.description = trimText(entryDescription(entry), INFO_DESCRIPTION_MAX)
  if (entry.page) detail.page = entry.page
  if (entry.install) detail.install = entry.install
  if (entry.downloadsStart) detail.downloadsStart = entry.downloadsStart
  if (entry.downloadsEnd) detail.downloadsEnd = entry.downloadsEnd
  if (entry.downloadsCheckedAt) detail.downloadsCheckedAt = entry.downloadsCheckedAt
  if (entry.capabilityCheckedAt) detail.capabilityCheckedAt = entry.capabilityCheckedAt

  return {
    ok: true,
    catalogEntry: detail,
    installed: installedNames.has(entry.name)
      ? installedView(entry.name, installed[entry.name], installedJson)
      : null,
  }
}

/**
 * 把 name / npm 包名解析成目录条目，供 market_install 用。
 * 目录里同名条目是常态（实测 dsh-whale-pet 有 4 条、dsh-code-review 有 2 条，
 * 不同作者），所以名字撞车时不猜：返回全部候选让调用方改用 url。
 * @returns { ok: true, entry } | { ok: false, error, candidates }
 */
export function resolveCatalogEntry(registryJson, key) {
  const registry = registryJson?.registry ?? registryJson ?? {}
  const plugins = Array.isArray(registry.plugins) ? registry.plugins : []
  const needle = String(key ?? '').trim().toLowerCase()
  if (needle === '') return { ok: false, error: '缺少 name 参数' }
  const hits = plugins.filter((entry) => String(entry.name).toLowerCase() === needle
    || String(entry.npm ?? '').toLowerCase() === needle)
  if (hits.length === 1) return { ok: true, entry: hits[0] }
  if (hits.length === 0) {
    const loose = plugins.filter((entry) => String(entry.name).toLowerCase().includes(needle)).slice(0, 5)
    return {
      ok: false,
      error: `目录里没有「${key}」`,
      candidates: loose.map((entry) => ({ name: entry.name, owner: entry.owner, url: entry.url })),
    }
  }
  return {
    ok: false,
    error: `「${key}」在目录里有 ${hits.length} 个同名条目（不同作者），请改用其中一条的 url 参数`,
    candidates: hits.map((entry) => ({ name: entry.name, owner: entry.owner, url: entry.url })),
  }
}

/** market_categories 的纯聚合：每个分类的目录条数 + 本机已装条数。 */
export function summarizeCategories(registryJson, installedJson) {
  const registry = registryJson?.registry ?? registryJson ?? {}
  const plugins = Array.isArray(registry.plugins) ? registry.plugins : []
  const labels = categoryLabels(registry)
  const installedNames = new Set(Object.keys(installedJson?.installed ?? {}))
  const byId = new Map()
  for (const entry of plugins) {
    for (const id of categoryList(entry)) {
      const row = byId.get(id) ?? { id, zh: labels[id]?.zh ?? id, en: labels[id]?.en ?? id, count: 0, installed: 0 }
      row.count += 1
      if (installedNames.has(entry.name)) row.installed += 1
      byId.set(id, row)
    }
  }
  return {
    total: plugins.length,
    catalogUpdated: registry.updated ?? null,
    categories: [...byId.values()].sort((a, b) => b.count - a.count),
  }
}

/**
 * 把「被 running-agent guard 挡回」翻译成可行动的结论。
 * 实测本机市场日志里 install-blocked / uninstall-blocked / update-blocked 反复
 * 出现：guard 看的是 agents.list() 里所有 status === 'running' 的 agent，
 * 不区分发起者，所以只要这台机器上有任何 agent 在跑，mutating 请求就 409。
 */
export function interpretBlocked(result) {
  if (result?.status !== 409) return null
  const json = result.json ?? {}
  const runningAgents = Array.isArray(json.runningAgents) ? json.runningAgents : []
  if (json.agentsBusy !== true && runningAgents.length === 0) return null
  return {
    ok: false,
    blocked: true,
    reason: 'agents-busy',
    runningAgents,
    error: typeof json.error === 'string' ? json.error : '有 agent 正在运行，市场拒绝改动插件',
    hint: '市场不允许在任何 agent 运行中改动插件文件（会新旧代码混用）。等这些会话跑完再试，或让使用者在插件市场页面手动操作。',
  }
}

/** 预置插件名（spec 以 link:/file: 开头）——桌面壳自己挂的，不许卸/更。 */
export function presetNames(installedJson) {
  const installed = installedJson?.installed ?? {}
  return Object.entries(installed)
    .filter(([, value]) => {
      const spec = specOf(value)
      return spec.startsWith('link:') || spec.startsWith('file:')
    })
    .map(([name]) => name)
}

export function guardPreset(spec) {
  return typeof spec === 'string' && (spec.startsWith('link:') || spec.startsWith('file:'))
}

/**
 * 带 TTL 的目录缓存：/dsh-market/registry 一次 4.3 MB，逐次工具调用都重新解析
 * 一遍是白扔时间；mutating 成功后调用 invalidate() 让下一次读到新状态。
 */
export function createCachedSource(fetchers, ttlMs = 60000) {
  const cache = new Map()
  async function get(key) {
    const hit = cache.get(key)
    if (hit !== undefined && Date.now() - hit.at < ttlMs) return hit.value
    const value = await fetchers[key]()
    cache.set(key, { at: Date.now(), value })
    return value
  }
  return {
    registry: () => get('registry'),
    installed: () => get('installed'),
    invalidate: () => cache.clear(),
  }
}
