// dsh-market-doctor · 插件入口（host 面）
//
// 一次调用给出一份分级体检：profile 与市场版本、预置插件挂上没有、可更新清单、
// 装卸被守卫挡回的次数、回滚快照存不存在、目录新鲜度。数据来自市场自己的路由
// （/dsh-market/installed、/api/v1/capabilities、/api/v1/updates/summary）加上
// profile 目录里的两份文件（.dsh-market/log.ndjson、storages 下的快照目录）。
//
// 与 dsh-plugin-snapshot 各带一份 profile 定位与市场自调客户端：两个插件都要能被
// 单独安装，不互相依赖；重复的是二十行路径推导和铸 cookie，不是判断逻辑。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { PRESET_PLUGIN_NAMES, diagnose, parseMarketLog } from './doctor.js'

export const name = 'dsh-market-doctor'
export const inject = ['webServer', 'connection', 'tools']

const REPORT_PATH = '/market-doctor/report'
const SAFE_PROFILE = /^[A-Za-z0-9._-]+$/
const SNAPSHOT_STORAGES = ['storages', 'dsh-plugin-market', 'snapshots']

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

export function envDshHome(env = process.env) {
  const fromEnv = env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(expandHome(fromEnv.trim()))
  return join(homedir(), '.dsh')
}

/** launcher 的 profileContext 优先；拿不到时退到 DSH_PROFILE + DSH_HOME，再退到唯一候选。
 *  两条都要验目录真的存在：DSH_PROFILE 常被上层进程继承下来，指向本 home 里不存在的
 *  profile 时照用会把体检读到不存在的目录，报出一份"看起来正常"的空体检。 */
export function resolveProfile(ctx, env = process.env) {
  let launched
  try {
    launched = ctx?.get?.('profileContext')
  } catch {
    launched = undefined
  }
  const home = envDshHome(env)
  const profilesDir = join(home, 'profiles')
  const notes = []
  if (launched && typeof launched.dir === 'string' && isAbsolute(launched.dir)) {
    const name = typeof launched.name === 'string' && launched.name.trim() !== '' ? launched.name.trim() : basename(launched.dir)
    if (!SAFE_PROFILE.test(name)) return { ok: false, error: `profile 名「${name}」不能当目录名用`, home }
    const parent = dirname(launched.dir)
    const resolvedHome = basename(parent).toLowerCase() === 'profiles' ? dirname(parent) : home
    if (existsSync(launched.dir)) {
      return { ok: true, profile: name, profileDir: launched.dir, home: resolvedHome, source: 'profileContext' }
    }
    notes.push(`profileContext 指向不存在的 ${launched.dir}`)
  }
  const envProfile = typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE.trim() !== '' ? env.DSH_PROFILE.trim() : null
  if (envProfile !== null) {
    if (!SAFE_PROFILE.test(envProfile)) return { ok: false, error: `DSH_PROFILE「${envProfile}」不能当目录名用`, home }
    const dir = join(profilesDir, envProfile)
    if (existsSync(dir)) return { ok: true, profile: envProfile, profileDir: dir, home, source: 'env DSH_PROFILE' }
    notes.push(`DSH_PROFILE=${envProfile} 在 ${dir} 不存在`)
  }
  let candidates = []
  try {
    // profiles/node_modules 是启动器放安装的地方，不是 profile
    candidates = readdirSync(profilesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== 'node_modules' && !d.name.startsWith('.'))
      .map((d) => d.name)
  } catch {
    candidates = []
  }
  if (candidates.length === 1) {
    return { ok: true, profile: candidates[0], profileDir: join(profilesDir, candidates[0]), home, source: 'profiles 下唯一目录', notes }
  }
  return {
    ok: false,
    home,
    profilesDir,
    candidates,
    error: `无法确定 profile：${notes.length > 0 ? `${notes.join('；')}，` : ''}候选 ${candidates.length} 个（${candidates.join(', ') || '无'}）。`,
  }
}

/** 市场自己的日志与回滚快照目录。读不到就返回 null，让报告明说而不是猜。 */
export function readProfileFiles(loc) {
  let log = null
  try {
    log = parseMarketLog(readFileSync(join(loc.profileDir, '.dsh-market', 'log.ndjson'), 'utf8'))
  } catch {
    log = null
  }
  const dir = join(loc.home, ...SNAPSHOT_STORAGES, loc.profile)
  let snapshots
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
    snapshots = { dir, exists: true, count: files.length, latest: files.length > 0 ? files[files.length - 1].replace(/\.json$/, '') : null }
  } catch {
    snapshots = { dir, exists: false, count: 0, latest: null }
  }
  return { log, snapshots }
}

/** 市场路由的本地自调：先铸一次 session cookie，401 时重铸一次。 */
export function createMarketClient({ port, authenticatedUrl, timeoutMs = 30000, fetchImpl = globalThis.fetch }) {
  const base = `http://127.0.0.1:${port}`
  let cookie = null

  function pickCookie(headers) {
    const raw = typeof headers?.getSetCookie === 'function' ? headers.getSetCookie() : [headers?.get?.('set-cookie')]
    const pairs = []
    for (const item of raw) {
      if (typeof item !== 'string') continue
      const pair = item.split(';')[0]?.trim()
      if (pair && pair.includes('=')) pairs.push(pair)
    }
    return pairs.join('; ')
  }

  async function mint() {
    const res = await fetchImpl(authenticatedUrl(`${base}/`), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const next = pickCookie(res.headers)
    if (next !== '') cookie = next
    return next !== ''
  }

  async function once(path, init = {}) {
    const headers = { origin: base, accept: 'application/json', ...init.headers }
    if (cookie) headers.cookie = cookie
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    const res = await fetchImpl(`${base}${path}`, {
      ...init,
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await res.text()
    let json = null
    try {
      json = text === '' ? null : JSON.parse(text)
    } catch {
      json = null
    }
    return { status: res.status, json }
  }

  return {
    async call(path, init = {}) {
      if (!cookie) await mint()
      let result = await once(path, init)
      if (result.status === 401 && await mint()) result = await once(path, init)
      return result
    },
  }
}

// 懒加载 @deepseek-ai/dsh-tools 的 defineTool；版本不匹配时退到最小包装。
let defineToolCache = null
async function loadDefineTool() {
  if (defineToolCache) return defineToolCache
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    defineToolCache = mod.defineTool
  } catch {
    defineToolCache = (options) => options
  }
  return defineToolCache
}

function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/** 可选：npm 上 dshmarket 的最新版本（查不到就跳过这条结论）。 */
async function npmLatest(pkgName, fetchImpl = globalThis.fetch, timeoutMs = 15000) {
  try {
    const res = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return null
    const json = await res.json()
    return typeof json?.['dist-tags']?.latest === 'string' ? json['dist-tags'].latest : null
  } catch {
    return null
  }
}

export function apply(ctx) {
  const loc = resolveProfile(ctx)
  const port = Number(ctx?.webServer?.port)
  const client = Number.isFinite(port) && ctx?.connection?.authenticatedUrl
    ? createMarketClient({ port, authenticatedUrl: (url) => ctx.connection.authenticatedUrl(url) })
    : null

  async function report(options = {}) {
    if (!client) {
      return { ok: false, error: '没有 webServer 端口或 connection 鉴权，市场自调不可用。' }
    }
    const [installed, capabilities] = await Promise.all([
      client.call('/dsh-market/installed'),
      client.call('/dsh-market/api/v1/capabilities'),
    ])
    if (installed.status !== 200) {
      return { ok: false, error: `installed HTTP ${installed.status}`, detail: installed.json }
    }

    const files = loc.ok ? readProfileFiles(loc) : { log: null, snapshots: null }
    const wantUpdates = options.updates !== false
    let updates = null
    if (wantUpdates) {
      const summary = await client.call('/dsh-market/api/v1/updates/summary')
      if (summary.status === 200) updates = summary.json
    }

    let registry = null
    if (options.catalog === true) {
      const res = await client.call('/dsh-market/registry')
      if (res.status === 200) {
        registry = {
          total: Array.isArray(res.json?.registry?.plugins) ? res.json.registry.plugins.length : null,
          updated: res.json?.registry?.updated ?? null,
        }
      }
    }

    let runningAgents
    try {
      const listed = ctx?.get?.('agents')?.list?.()
      runningAgents = Array.isArray(listed)
        ? listed.filter((a) => a?.status === 'running' && typeof a?.id === 'string').map((a) => a.id)
        : []
    } catch {
      runningAgents = undefined
    }

    const npm = options.npm === true ? await npmLatest('dshmarket') : undefined

    const result = diagnose({
      installed: installed.json,
      capabilities: capabilities.status === 200 ? capabilities.json : undefined,
      updates,
      registry,
      log: files.log,
      snapshots: files.snapshots,
      runningAgents,
      presetExpect: Array.isArray(options.presetExpect) && options.presetExpect.length > 0 ? options.presetExpect : PRESET_PLUGIN_NAMES,
      npmLatest: npm ?? undefined,
    })
    return {
      ...result,
      profileSource: loc.ok ? loc.source : null,
      profileDir: loc.ok ? loc.profileDir : null,
      profileNote: loc.ok ? null : loc.error,
    }
  }

  ctx.effect(async () => {
    const defineTool = await loadDefineTool()
    const disposers = []

    // 只读体检路由。用 webServer.register：/api/* 是 connection 的 RPC 命名空间，
    // 插件路由挂那下面会被 RPC 分发接管（实测返回空 400）。
    if (ctx?.webServer?.register) {
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: REPORT_PATH,
        async handler(req, res) {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          try {
            const params = new URL(req.url ?? '/', 'http://127.0.0.1').searchParams
            const body = await report({
              catalog: params.get('catalog') === '1',
              npm: params.get('npm') === '1',
              updates: params.get('updates') !== '0',
            })
            const payload = JSON.stringify(body, null, 2)
            res.writeHead(body.ok ? 200 : 503, { 'content-type': 'application/json; charset=utf-8' })
            res.end(req.method === 'HEAD' ? undefined : payload)
          } catch (error) {
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: message(error) }))
          }
        },
      }))
    }

    if (ctx?.tools?.register) {
      disposers.push(ctx.tools.register(defineTool({
        name: 'market_doctor',
        description:
          '给当前 DSH 的插件生态做一次体检，返回按 critical/high/medium/low/info 分级的结论，每条带证据：'
          + '预置插件是否真的挂上（没挂上时 market_* 这类工具位其实不可用）、哪些插件可更新、'
          + '装卸是否被 running-agent 守卫挡回过、回滚快照是否存在、精选目录是否过期、插件是否声明了但加载不起来。'
          + '排查"市场不好用/插件装了没反应"时先调它，别一条条手查。catalog:true 顺带查目录新鲜度（会拉整份目录）。',
        parameters: {
          catalog: { type: 'boolean', description: '顺带检查精选目录的新鲜度（默认不查，整份目录很大）。' },
          npm: { type: 'boolean', description: '顺带比对 npm 上 dshmarket 的最新版本（需要外网）。' },
          updates: { type: 'boolean', description: '是否查可更新清单（默认查）。' },
        },
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute(args) {
          try {
            return await report({
              catalog: args?.catalog === true,
              npm: args?.npm === true,
              updates: args?.updates !== false,
            })
          } catch (error) {
            return { ok: false, error: message(error) }
          }
        },
        timeoutMs: 90000,
      })))
    }

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          // 一个卸载失败不影响其它卸载
        }
      }
    }
  })
}
