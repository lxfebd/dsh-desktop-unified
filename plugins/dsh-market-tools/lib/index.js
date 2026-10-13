// dsh-market-tools · 插件入口（host 面）
// 把 dshmarket 的官方 /dsh-market/* 路由包装成 7 个内置 AI 工具：
//   market_list / market_info / market_categories / market_updates
//   market_install / market_uninstall / market_update
// 纯转调：安装/卸载/更新的全部逻辑（pnpm 坑位恢复、热挂载、allowBuilds、同源
// 校验）都在 dshmarket 路由本体里，本插件只做本地自调鉴权、目录聚合和结果裁剪。
import {
  createMarketClient,
  createCachedSource,
  summarizeCatalog,
  summarizeCategories,
  describeEntry,
  resolveCatalogEntry,
  interpretBlocked,
  presetNames,
  guardPreset,
} from './http.js'

export const name = 'dsh-market-tools'
export const inject = ['webServer', 'connection', 'tools']

// 懒加载 @deepseek-ai/dsh-tools 的 defineTool；版本不匹配时退到最小包装
// （register 仍会校验 output.render），与 dsh-shell-control 同款策略。
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

function jsonRender(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** 压掉 pnpm 长输出，模型只需要结论。 */
function trimResult(json) {
  if (!json || typeof json !== 'object') return json
  const out = { ...json }
  for (const field of ['stdout', 'stderr', 'output', 'log']) {
    if (typeof out[field] === 'string' && out[field].length > 1200) {
      out[field] = out[field].slice(0, 600) + '\n…(截断)…\n' + out[field].slice(-400)
    }
  }
  return out
}

const MUTATE_TIMEOUT_MS = 300000
const MAX_WAIT_SECONDS = 120
// 允许「等一会儿再试」时，工具总超时要把等待时间也算进去。
const MUTATE_TOOL_TIMEOUT_MS = MUTATE_TIMEOUT_MS + MAX_WAIT_SECONDS * 1000 + 20000

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function clampWait(value) {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : 0
  return Math.min(Math.max(n, 0), MAX_WAIT_SECONDS)
}

export function apply(ctx) {
  // 当前运行 agent 的会话 id（session-xxx）。放进 mutating POST 的 body 里。
  // 说明清楚：dshmarket 1.40–1.66 的 running-agent guard 并不读这个字段
  // （guard 取 agents.list() 里全部 status === 'running' 的 agent），所以它
  // 现在只是向前兼容的占位；被挡回时靠 interpretBlocked() 给出可行动的结论。
  const currentAgentId = () => {
    const direct = ctx?.agent?.id
    if (typeof direct === 'string' && direct !== '') return direct
    try {
      const initiator = ctx?.get?.('agents')?.currentInitiator?.()
      if (initiator && typeof initiator.id === 'string' && initiator.id !== '') return initiator.id
    } catch {
      // 无 initiator 边界：不携带 agentId。
    }
    return undefined
  }

  const marketCall = (path, opts) =>
    createMarketClient({
      port: ctx.webServer.port,
      agentId: currentAgentId(),
      authenticatedUrl: (url) => ctx.connection.authenticatedUrl(url),
    }).call(path, opts)

  // /dsh-market/registry 一次 4.3 MB，别每次工具调用都重解析；mutating 成功后
  // invalidate()，保证下一次读到的是改动后的状态。
  const source = createCachedSource({
    registry: async () => {
      const res = await marketCall('/dsh-market/registry')
      if (res.status !== 200) throw new Error(`registry HTTP ${res.status}: ${JSON.stringify(res.json).slice(0, 200)}`)
      return res.json
    },
    installed: async () => {
      const res = await marketCall('/dsh-market/installed')
      if (res.status !== 200) throw new Error(`installed HTTP ${res.status}: ${JSON.stringify(res.json).slice(0, 200)}`)
      return res.json
    },
  })

  /**
   * 共用 mutation 流程：POST → 被 guard 挡回时可选等待重试 → 成功则失效缓存。
   * @returns 路由结果（裁剪过），或 guard 挡回的结构化结果。
   */
  async function runMutation(path, body, waitSeconds) {
    let res = await marketCall(path, { method: 'POST', body, timeoutMs: MUTATE_TIMEOUT_MS })
    let blocked = interpretBlocked(res)
    const wait = clampWait(waitSeconds)
    if (blocked !== null && wait > 0) {
      await sleep(wait * 1000)
      res = await marketCall(path, { method: 'POST', body, timeoutMs: MUTATE_TIMEOUT_MS })
      blocked = interpretBlocked(res)
    }
    if (blocked !== null) return blocked
    source.invalidate()
    return trimResult(res.json)
  }

  /** 预置插件（spec 以 link:/file: 开头）在本地直接拒绝，请求根本不发出去。 */
  async function presetBlock(name) {
    const installedJson = await source.installed()
    const spec = installedJson?.installed?.[name]?.spec
    if (!guardPreset(spec)) return null
    const presets = presetNames(installedJson)
    return {
      ok: false,
      blocked: true,
      name,
      spec,
      reason: 'preset-plugin',
      presetPlugins: presets,
      error: '该插件是桌面壳预置插件（spec 以 link:/file: 开头），不允许卸载或更新。',
    }
  }

  ctx.effect(async () => {
    const defineTool = await loadDefineTool()
    const disposers = []

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_list',
      description:
        '浏览 DeepSeek Harness 插件市场（精选目录 4500+ 条）。默认只返回热度最高的 30 条，'
        + '不会把整份目录倒给你。query 按名称/作者/描述/分类（可用中文名，如「安全」「界面」）/URL 过滤；'
        + 'category 按分类 id 或中文名筛；sort 取 hot/new/name/installed；installedOnly 只看已装的。'
        + '每条带 capabilities（插件声明的能力，如 fs-write/env/net）——带写文件、读环境变量标记的先看清楚再装。'
        + '装插件用返回条目的 url 或 name 交给 market_install。',
      parameters: {
        query: { type: 'string', description: '可选搜索关键词。' },
        category: { type: 'string', description: '可选分类筛选：id（ui/tools/security…）或中文名（安全/工具/安全与权限）。' },
        sort: { type: 'string', description: '排序：hot（默认）/ new / name / installed。' },
        limit: { type: 'number', description: `最多返回多少条（默认 30，上限 150）。` },
        installedOnly: { type: 'boolean', description: '只看目录里已安装的条目。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        try {
          const [registryJson, installedJson] = await Promise.all([source.registry(), source.installed()])
          return { ok: true, ...summarizeCatalog(registryJson, installedJson, {
            query: args.query,
            category: args.category,
            sort: args.sort,
            limit: args.limit,
            installedOnly: args.installedOnly === true,
          }) }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
      timeoutMs: 60000,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_info',
      description:
        '看单个插件的完整详情：目录里的版本、npm 包名、stars/downloads、capabilities 与 capabilityRedLines、'
        + '收录时间、市场给出的 install 命令，以及本机安装状态（present/disabled/live）。'
        + 'name 可以是目录名、npm 包名或目录 url。',
      parameters: {
        name: { type: 'string', required: true, description: '插件名 / npm 包名 / 目录条目的 url。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        const key = String(args.name || '').trim()
        if (!key) return { ok: false, error: '缺少 name 参数。' }
        try {
          const [registryJson, installedJson] = await Promise.all([source.registry(), source.installed()])
          const info = describeEntry(registryJson, installedJson, key)
          if (!info.ok) return info
          // 已装的插件顺带回答「有没有得更新」，省得再调一次 market_updates。
          if (info.installed !== null) {
            const update = await marketCall(`/dsh-market/api/v1/updates?name=${encodeURIComponent(key)}`)
            if (update.status === 200) info.update = update.json?.package ?? null
          }
          return { ok: true, ...info }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
      timeoutMs: 60000,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_categories',
      description:
        '列出精选目录的分类：每个分类的 id、中文名、目录条数、本机已装条数。'
        + '用户说「有什么界面类插件」这种模糊需求时先调本工具拿到准确的分类 id，再用 market_list 的 category 筛。',
      parameters: {},
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute() {
        try {
          return { ok: true, ...summarizeCategories(await source.registry(), await source.installed()) }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
      timeoutMs: 60000,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_updates',
      description:
        '查已安装插件里哪些有更新：返回 checked（检查了多少个）、updatable（有更新的个数）和逐包的 '
        + 'installedVersion/latestVersion，另带市场版本与 restart 是否由市场托管。'
        + 'checked 与 updatable 同时给出，才能区分「没有可更新」和「没检查过」。',
      parameters: {
        force: { type: 'boolean', description: '强制重新检查，忽略市场的缓存结果。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        try {
          const caps = await marketCall('/dsh-market/api/v1/capabilities')
          const features = caps.json?.features ?? {}
          const summaryPath = caps.status === 200 && features.updatesSummary === true
            ? caps.json?.endpoints?.updatesSummary
            : null
          if (!summaryPath) {
            return { ok: false, error: '当前市场版本不提供 updates/summary 端点', capabilities: caps.json ?? null }
          }
          const summary = await marketCall(summaryPath + (args.force === true ? '?force=1' : ''), { timeoutMs: 120000 })
          if (summary.status !== 200) return { ok: false, error: `updates/summary HTTP ${summary.status}`, detail: summary.json }
          return {
            ok: true,
            marketVersion: caps.json?.marketVersion ?? null,
            profile: caps.json?.profile ?? null,
            runtime: caps.json?.runtime ?? null,
            restartSupported: features.restart === true,
            ...summary.json,
          }
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
      },
      timeoutMs: 150000,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_install',
      description:
        '从市场安装插件：url 用 market_list 条目的 url 字段（github.com 仓库链接，可带 /tree/分支/子目录），'
        + '或者只给 name（插件会去目录里解析出 url；同名多条时会列出候选让你改用 url）。'
        + '返回含 ok/hot/activation：hot=true 表示已热挂载立即生效，无需重启。'
        + 'pnpm 解析整个 profile，耗时可达数分钟。'
        + '注意：市场不允许在任何 agent 运行中改动插件文件——被挡回时返回 blocked:true 与正在运行的会话，'
        + '可以带 waitSeconds（最多 120）让它等一会儿再试一次。',
      parameters: {
        url: { type: 'string', description: 'github.com 插件仓库 URL（来自 market_list 的 url 字段）。与 name 二选一。' },
        name: { type: 'string', description: '目录条目名或 npm 包名；插件会解析成该条目的 url。' },
        version: { type: 'string', description: '可选：钉住某个版本（市场支持时）。' },
        waitSeconds: { type: 'number', description: '被「agent 正在运行」挡回时最多等这么久再试一次（0-120，默认 0）。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        const url = String(args.url || '').trim()
        const name = String(args.name || '').trim()
        if (!url && !name) return { ok: false, error: '需要 url 或 name 之一；先用 market_list 找目录条目。' }
        let target = url
        if (!target) {
          try {
            const resolved = resolveCatalogEntry(await source.registry(), name)
            if (!resolved.ok) return resolved
            target = resolved.entry.url
          } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error) }
          }
        }
        const body = { url: target }
        if (typeof args.version === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(args.version)) {
          body.version = args.version
        }
        return runMutation('/dsh-market/install', body, args.waitSeconds)
      },
      timeoutMs: MUTATE_TOOL_TIMEOUT_MS,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_uninstall',
      description:
        '卸载已安装的插件：name 是 profile 依赖里的包名（market_list / market_updates 的 installed 键）。'
        + '桌面壳预置插件（spec 以 link:/file: 开头）会被本地拒绝，不要尝试卸载。'
        + '被「agent 正在运行」挡回时返回 blocked:true，可带 waitSeconds 重试一次。',
      parameters: {
        name: { type: 'string', required: true, description: '已安装插件的包名。' },
        waitSeconds: { type: 'number', description: '被挡回时最多等这么久再试一次（0-120，默认 0）。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        const name = String(args.name || '').trim()
        if (!name) return { ok: false, error: '缺少 name 参数。' }
        try {
          const blockedPreset = await presetBlock(name)
          if (blockedPreset !== null) return blockedPreset
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
        return runMutation('/dsh-market/uninstall', { name }, args.waitSeconds)
      },
      timeoutMs: MUTATE_TOOL_TIMEOUT_MS,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_update',
      description:
        '更新一个已安装插件到其来源最新版：git 安装看 HEAD，registry 安装看 npm latest dist-tag；'
        + '已是最新或会造成降级时返回错误。预置插件（link:/file:）会被本地拒绝。'
        + '先用 market_updates 确认它真的有更新，再调本工具。被挡回时可带 waitSeconds 重试一次。',
      parameters: {
        name: { type: 'string', required: true, description: '已安装插件的包名。' },
        waitSeconds: { type: 'number', description: '被挡回时最多等这么久再试一次（0-120，默认 0）。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        const name = String(args.name || '').trim()
        if (!name) return { ok: false, error: '缺少 name 参数。' }
        try {
          const blockedPreset = await presetBlock(name)
          if (blockedPreset !== null) return blockedPreset
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) }
        }
        return runMutation('/dsh-market/update', { name }, args.waitSeconds)
      },
      timeoutMs: MUTATE_TOOL_TIMEOUT_MS,
    })))

    return () => { for (const dispose of disposers) dispose() }
  })
}
