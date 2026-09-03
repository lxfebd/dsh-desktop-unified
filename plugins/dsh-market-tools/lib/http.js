// dsh-market-tools · 本地市场 HTTP 客户端（纯逻辑，可单测）
// 在 dsh web 进程内自调本进程的 webServer：先用 connection.authenticatedUrl
// 的 303 响应铸造会话 cookie（与 Electron 壳探测就绪的官方握手一致），再带
// Origin 头过 dshmarket 路由的同源校验。401（签名轮换/进程重启）时重铸一次。

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
 * @param deps - { port, authenticatedUrl, fetchImpl?, timeoutMs? }
 * @returns { call(path, opts) } — opts: { method?, body?, timeoutMs? }
 */
export function createMarketClient(deps) {
  const { port, authenticatedUrl, fetchImpl = globalThis.fetch, timeoutMs = 30000 } = deps
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

  async function once(path, method, body, signal) {
    const headers = { origin }
    if (cookie) headers.cookie = cookie
    if (body !== undefined) headers['content-type'] = 'application/json'
    return fetchImpl(origin + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    })
  }

  /**
   * 调一次 dsh-market 路由。鉴权失效自动重铸 cookie 重试一次。
   * @returns 路由返回的 JSON；解析失败时退到 { ok:false, error, raw }。
   */
  async function call(path, opts = {}) {
    const method = opts.method ?? 'GET'
    const signal = AbortSignal.timeout(opts.timeoutMs ?? timeoutMs)
    if (!cookie) await mintCookie()
    let res = await once(path, method, opts.body, signal)
    if (res.status === 401) {
      await mintCookie()
      res = await once(path, method, opts.body, signal)
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

/**
 * market_list 的纯聚合：registry + installed 两份响应压成模型友好摘要。
 * @param registryJson - GET /dsh-market/registry 的 JSON
 * @param installedJson - GET /dsh-market/installed 的 JSON
 * @param query - 可选搜索词（名称/作者/描述/分类/URL）
 */
export function summarizeCatalog(registryJson, installedJson, query = '') {
  const registry = registryJson?.registry ?? registryJson ?? {}
  const plugins = Array.isArray(registry.plugins) ? registry.plugins : []
  const installed = installedJson?.installed ?? {}
  const present = new Set(installedJson?.present ?? [])
  const disabled = new Set(Array.isArray(installedJson?.disabled) ? installedJson.disabled : [])
  const live = new Set(Object.keys(installedJson?.live ?? {}))
  const q = String(query).toLowerCase().trim()
  const hit = (text) => String(text).toLowerCase().includes(q)
  const catalog = plugins
    .map((entry) => ({
      name: entry.name,
      owner: entry.owner,
      url: entry.url,
      category: entry.category,
      description: entryDescription(entry),
      installed: Object.prototype.hasOwnProperty.call(installed, entry.name),
    }))
    .filter((entry) => !q || hit(entry.name) || hit(entry.owner) || hit(entry.description) || hit(entry.category) || hit(entry.url))
  const installedSummary = {}
  for (const [name, spec] of Object.entries(installed)) {
    installedSummary[name] = {
      spec: typeof spec === 'string' ? spec : String(spec),
      present: present.has(name),
      disabled: disabled.has(name),
      live: live.has(name),
    }
  }
  return {
    source: registryJson?.source ?? 'unknown',
    total: plugins.length,
    catalog,
    installed: installedSummary,
    note: 'catalog 条目用 url 字段作为 market_install 的参数；installed 里 spec 以 link:/file: 开头的是桌面壳预置插件，不应卸载或更新。',
  }
}
