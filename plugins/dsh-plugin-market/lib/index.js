// dsh-plugin-market · 插件入口（host 面）
// 通过官方 webServer 服务注册 `/api/market/*` 路由，并经 tapIndex 往官方 index
// 注入商城 UI。卸载时经 ctx.effect 自动回收，天然可逆。
import {
  OFFICIAL_CATALOG, loadSources, saveSources, readInstalled, listInstalledModules,
  runDshPlugin, runDshPluginStreaming, communityCatalog, resolveRepoOwners, loadTabPlugins,
  enqueueOp, getOps, killOp, disablePlugin, enablePlugin, listDisabled,
  themeCatalog, switchTheme, onThemeRemoved, restartDsh,
  getPluginMeta, getPluginReadme, getPluginVersions,
  listDisabledEffective, checkPluginUpdates, backupProfile, restoreProfile,
  diagnoseProfile, isAgentRunning, cleanOrphanStore, getPnpmErrorHint,
} from './market.js'
/** Cordis 稳定插件名。 */
export const name = 'dsh-plugin-market'

/** 前置服务：webServer 提供后方可注册路由与注入；tools 供 AI 在市场里自拉插件。 */
export const inject = ['webServer', 'tools']

const PROFILE_DEFAULT = 'web'

// 模块级社区缓存：catalog 走瞬时值，/community 负责拉取/刷新。
let communityItems = []

// 懒加载 @deepseek-ai/dsh-tools 的 defineTool（registry 校验同名工具）。
let defineToolCache = null
async function loadDefineTool() {
  if (defineToolCache) return defineToolCache
  try {
    const mod = await import('@deepseek-ai/dsh-tools')
    defineToolCache = mod.defineTool
    return mod.defineTool
  } catch {
    // 版本不匹配时退到最小包装：直接透传（register 仍会校验 output.render）。
    defineToolCache = (options) => options
    return defineToolCache
  }
}

/** 给模型看的市场摘要（安装/卸载/更新后的回读保持一致）。 */
async function marketSnapshot(profile) {
  const info = readInstalled(profile)
  const owners = resolveRepoOwners(profile)
  return {
    official: OFFICIAL_CATALOG,
    custom: loadSources(),
    community: communityItems.map((it) => {
      const installedAs = it.gitInstall ? owners[it.gitInstall] : undefined
      return installedAs ? { ...it, source: installedAs, installedAs } : it
    }),
    installed: installedMap(profile),
    bundles: info.bundles,
    modules: listInstalledModules(profile),
  }
}

/** 运行一次 dsh plugin 操作并返回模型友好的结果。 */
async function runMarketAction(kind, source, mirror) {
  const result = await runDshPlugin(PROFILE_DEFAULT, kind, source, mirror)
  const output = (result.stdout || '').trim()
  const err = (result.stderr || '').trim()
  const ok = result.code === 0
  if (ok) {
    // 安装成功但 UI 显示完整目录；失败则给出 pnpm 尾部错误（可操作）。
    return { ok, code: result.code, summary: output.split('\n').slice(-6).join('\n') }
  }
  return {
    ok,
    code: result.code,
    error: (err.split('\n').filter(Boolean).slice(-6).join('\n'))
      || output.split('\n').filter(Boolean).slice(-6).join('\n'),
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
  return new Promise((resolveResult) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      try { resolveResult(body ? JSON.parse(body) : {}) } catch { resolveResult({}) }
    })
    req.on('error', () => resolveResult({}))
  })
}

/** 已装映射：source(包名) -> true，供前端快速判定安装态。
 *  官方核心包（core + bundle）虽不在 profile node_modules，但由 dsh 安装树提供，
 *  必须视为"已装"——否则 UI 会误显"安装"按钮让用户走 npm 死路（这些私有包不在 npm registry）。 */
function installedMap(profile) {
  const map = {}
  // 官方核心 bundle 永远视为「已部署」：这些私有包不在 npm registry，
  // 不能安装/更新/卸载，必须优先于 readInstalled 的普通已装标记。
  for (const item of OFFICIAL_CATALOG) {
    if (item && item.core && item.bundle && item.source) map[item.source] = 'core-bundle'
  }
  // patch 中被热禁用的插件标记为 'disabled'，前端据此切换"启用"按钮
  const disabledSet = new Set(listDisabledEffective())
  for (const k of readInstalled(profile).all) {
    if (!map[k]) map[k] = disabledSet.has(k) ? 'disabled' : true
  }
  return map
}

/** 目录快照（列表 + 已装态 + bundles + 磁盘模块）。 */
function catalogSnapshot(profile) {
  const info = readInstalled(profile)
  const owners = resolveRepoOwners(profile)
  // 用 url/name/npm/owner 多维度匹配已装社区条目
  const ownersLower = {}
  for (const k in owners) ownersLower[k.toLowerCase()] = owners[k]
  return {
    official: OFFICIAL_CATALOG,
    custom: loadSources(),
    community: communityItems.map((it) => {
      // 1) git URL 形式（git+https://github.com/owner/repo）
      if (it.url) {
        const gitKey = 'git+https://' + it.url.replace(/^https?:\/\//, '').replace(/\.git$/, '')
        if (ownersLower[gitKey.toLowerCase()]) {
          return { ...it, source: ownersLower[gitKey.toLowerCase()], installedAs: ownersLower[gitKey.toLowerCase()] }
        }
      }
      // 2) npm 名直接命中 dependencies
      if (it.npm && info.deps.includes(it.npm)) {
        return { ...it, source: it.npm, installedAs: it.npm }
      }
      // 3) owner/repo 短名
      if (it.owner && it.name) {
        const shortKey = 'git+https://github.com/' + it.owner + '/' + it.name
        if (ownersLower[shortKey.toLowerCase()]) {
          return { ...it, source: ownersLower[shortKey.toLowerCase()], installedAs: ownersLower[shortKey.toLowerCase()] }
        }
      }
      return it
    }),
    installed: installedMap(profile),
    bundles: info.bundles,
    modules: listInstalledModules(profile),
  }
}

const route = (path, handler) => ({ kind: 'exact', path, handler })

/** 包装异步 handler，捕获错误返回 500，避免破坏 server。 */
function safe(handler) {
  return async (req, res) => {
    try { await handler(req, res) } catch (e) {
      if (res.headersSent) { res.destroy(); return }
      sendJson(res, 500, { error: String(e) })
    }
  }
}

export function apply(ctx) {
  // 启动时预热社区缓存（失败静默，不影响挂载）。
  void communityCatalog(false).then((s) => { communityItems = s.items }).catch(() => {})

  // —— AI 可调用的市场工具：让模型自己浏览、安装、卸载、更新插件 ——
  ctx.effect(async () => {
    const defineTool = await loadDefineTool()
    const disposers = []

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_list',
      description:
        'Browse the DeepSeek Harness plugin marketplace. Returns the official catalog, community catalog, custom '
        + 'sources, and the set of installed plugins (source -> status, where "core-bundle" means the package ships '
        + 'with the harness and cannot be installed/uninstalled). Call this before market_install to find a real '
        + 'source: prefer exact npm package names for official entries and git+https for community repositories.',
      parameters: {
        query: { type: 'string', description: 'Optional search keyword: matches plugin name or description.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const snap = await marketSnapshot(PROFILE_DEFAULT)
        const q = (args.query || '').toLowerCase().trim()
        if (!q) return snap
        const hit = (x) => ((x.name || '') + ' ' + (x.desc || '') + ' ' + (x.source || '')).toLowerCase().includes(q)
        return {
          official: (snap.official || []).filter(hit),
          community: (snap.community || []).filter(hit).slice(0, 20),
          custom: (snap.custom || []).filter(hit),
          installed: snap.installed,
        }
      },
      timeoutMs: 30000,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_install',
      description:
        'Install a plugin from the marketplace into the web profile. Pass an exact source: an npm package name '
        + '(e.g. "some-package") or a git URL (e.g. "git+https://github.com/owner/repo"). Use market_list first to '
        + 'discover valid sources. Official core bundles (status "core-bundle") cannot be installed: skip them. '
        + 'Installation runs pnpm and may take tens of seconds; the result reports whether it succeeded and the '
        + 'tail of the installer output on failure.',
      parameters: {
        source: { type: 'string', required: true, description: 'Exact npm package name or git+https source to install.' },
        mirror: { type: 'boolean', description: 'Use the npmmirror registry for npm packages (default false).' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        return runMarketAction('add', args.source, !!args.mirror)
      },
      timeoutMs: 200000,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_uninstall',
      description:
        'Uninstall a plugin from the web profile by its exact package name (the installed source). Core bundles '
        + '(status "core-bundle") cannot be uninstalled. After removal the plugin is no longer loaded in new '
        + 'sessions. Use market_list to confirm the exact installed name first.',
      parameters: {
        source: { type: 'string', required: true, description: 'Exact installed package name to remove.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const snap = await marketSnapshot(PROFILE_DEFAULT)
        const st = snap.installed?.[args.source]
        if (st === 'core-bundle') {
          return { ok: false, error: `"${args.source}" is a core bundle shipped with the harness and cannot be uninstalled` }
        }
        return runMarketAction('remove', args.source)
      },
      timeoutMs: 120000,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_update',
      description:
        'Update an installed plugin in the web profile by its exact package name (the installed source). Core '
        + 'bundles (status "core-bundle") cannot be updated: they follow the harness release. Use market_list to '
        + 'confirm the exact installed name first.',
      parameters: {
        source: { type: 'string', required: true, description: 'Exact installed package name to update.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      async execute(args) {
        const snap = await marketSnapshot(PROFILE_DEFAULT)
        const st = snap.installed?.[args.source]
        if (st === 'core-bundle') {
          return { ok: false, error: `"${args.source}" is a core bundle shipped with the harness and cannot be updated` }
        }
        return runMarketAction('update', args.source)
      },
      timeoutMs: 120000,
    })))

    return () => { for (const d of disposers) d() }
  }, 'dsh-plugin-market: ai tools')

  ctx.effect(() => {
    const disposers = []

    disposers.push(ctx.webServer.register(route('/api/market/catalog', safe((req, res) => {
      const profile = new URL(req.url ?? '/', 'http://x').searchParams.get('profile') || PROFILE_DEFAULT
      sendJson(res, 200, catalogSnapshot(profile))
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/installed', safe((req, res) => {
      const profile = new URL(req.url ?? '/', 'http://x').searchParams.get('profile') || PROFILE_DEFAULT
      sendJson(res, 200, readInstalled(profile))
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/install', safe(async (req, res) => {
      const body = await readBody(req)
      const source = (body.source || '').trim()
      if (!source) return sendJson(res, 400, { ok: false, error: '缺少 source' })
      const profile = body.profile || PROFILE_DEFAULT
      const result = await runDshPlugin(profile, 'add', source, !!body.mirror)
      sendJson(res, result.code === 0 ? 200 : 500, { ok: result.code === 0, ...result })
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/install-stream', safe(async (req, res) => {
      const body = await readBody(req)
      const source = (body.source || '').trim()
      if (!source) { sendJson(res, 400, { ok: false, error: '缺少 source' }); return }
      const profile = body.profile || PROFILE_DEFAULT
      let finalCode = 0
      let finalOut = ''
      let finalErr = ''
      // 流式响应设置
      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-store',
        'Connection': 'keep-alive',
      })
      const onEvent = (e) => {
        if (e.type === 'done') { finalCode = e.code; finalOut = e.stdout || ''; finalErr = e.stderr || '' }
        // 过滤掉原始 ndjson 事件（已翻译成 log）
        if (e.type === 'ndjson') return
        try { res.write(JSON.stringify(e) + '\n') } catch { /* 连接可能已断开 */ }
      }
      const result = await runDshPluginStreaming(profile, 'add', source, !!body.mirror, onEvent)
      try { res.end() } catch { /* 已断开 */ }
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/uninstall', safe(async (req, res) => {
      const body = await readBody(req)
      const source = (body.source || '').trim()
      if (!source) return sendJson(res, 400, { ok: false, error: '缺少 source' })
      const profile = body.profile || PROFILE_DEFAULT
      const result = await runDshPlugin(profile, 'remove', source)
      sendJson(res, result.code === 0 ? 200 : 500, { ok: result.code === 0, ...result })
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/update', safe(async (req, res) => {
      const body = await readBody(req)
      const source = (body.source || '').trim()
      if (!source) return sendJson(res, 400, { ok: false, error: '缺少 source' })
      const profile = body.profile || PROFILE_DEFAULT
      const result = await runDshPlugin(profile, 'update', source)
      sendJson(res, result.code === 0 ? 200 : 500, { ok: result.code === 0, ...result })
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/sources', safe(async (req, res) => {
      if (req.method === 'GET') return sendJson(res, 200, loadSources())
      if (req.method === 'DELETE') {
        const id = new URL(req.url ?? '/', 'http://x').searchParams.get('id')
        saveSources(loadSources().filter((s) => s.id !== id))
        return sendJson(res, 200, { ok: true })
      }
      if (req.method === 'POST') {
        const body = await readBody(req)
        const name = (body.name || '').trim()
        const source = (body.source || '').trim()
        if (!name || !source) return sendJson(res, 400, { ok: false, error: '名称和来源都不能为空' })
        const list = loadSources()
        if (list.some((s) => s.source === source)) return sendJson(res, 409, { ok: false, error: '该来源已存在' })
        const item = { id: 'cus-' + Date.now(), name, source, desc: body.desc || '用户自定义货源', type: 'custom' }
        list.push(item)
        saveSources(list)
        return sendJson(res, 200, { ok: true, item })
      }
      return sendJson(res, 405, { ok: false, error: 'method not allowed' })
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/tab-catalog', safe(async (req, res) => {
      const profile = new URL(req.url ?? '/', 'http://x').searchParams.get('profile') || PROFILE_DEFAULT
      const installed = installedMap(profile)
      // 联动 better-sidebar 的「添加 Tab 插件」：返回已知 Tab 兼容插件目录，
      // 并标注在本 profile 中的安装态（已装 / 核心 / 未装）。
      const tabPlugins = loadTabPlugins().map((p) => ({
        ...p,
        installState: installed[p.source] === 'core-bundle' ? 'core-bundle' : (installed[p.source] ? 'installed' : 'not-installed'),
      }))
      sendJson(res, 200, tabPlugins)
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/community', safe(async (req, res) => {
      const force = new URL(req.url ?? '/', 'http://x').searchParams.get('force') === '1'
      const snap = await communityCatalog(force)
      communityItems = snap.items
      sendJson(res, 200, snap)
    }))))

    // ---- 操作队列（新能力：FIFO 队列 / 白名单 / 试装验证 / 热挂载 / 禁用启用）----
    // POST /api/market/op  { method: 'install'|'uninstall'|'update'|'kill'|'clear', source, profile, skipCheck }
    // GET  /api/market/op/snapshot     当前队列快照
    disposers.push(ctx.webServer.register(route('/api/market/op', safe(async (req, res) => {
      if (req.method === 'GET') {
        const opId = new URL(req.url ?? '/', 'http://x').searchParams.get('opId')
        if (opId) {
          const hit = getOps().find((o) => o.id === opId)
          return sendJson(res, 200, hit || null)
        }
        return sendJson(res, 200, getOps())
      }
      if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method not allowed' })
      const body = await readBody(req)
      const method = (body.method || '').trim()
      // 同步类操作（无子进程）：禁用/启用/清队列
      if (method === 'disable') {
        return sendJson(res, 200, disablePlugin(body.profile || PROFILE_DEFAULT, (body.source || '').trim()))
      }
      if (method === 'enable') {
        return sendJson(res, 200, enablePlugin(body.profile || PROFILE_DEFAULT, (body.source || '').trim()))
      }
      if (method === 'clear') {
        for (const o of getOps()) { if (['done', 'failed', 'killed', 'timeout'].includes(o.status)) killOp(o.id) }
        return sendJson(res, 200, { ok: true })
      }
      // 队列类操作：install / uninstall / update
      const map = { install: 'add', uninstall: 'remove', update: 'update' }
      const kind = map[method]
      if (!kind) return sendJson(res, 400, { ok: false, error: '未知操作: ' + method })
      const source = (body.source || '').trim()
      if (!source) return sendJson(res, 400, { ok: false, error: '缺少 source' })
      const profile = body.profile || PROFILE_DEFAULT
      const result = enqueueOp(kind, profile, source, {
        mirror: !!body.mirror,
        skipCheck: !!body.skipCheck,
        origin: body.origin || (req.headers && req.headers.origin) || '',
        onEvent: null,
      })
      // 兼容旧客户端: opId 字段 + ok + id
      return sendJson(res, result.ok ? 200 : 400, result.ok
        ? { ok: true, opId: result.id, id: result.id }
        : { ok: false, error: result.error, output: result.output })
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/op/snapshot', safe(async (req, res) => {
      sendJson(res, 200, { ok: true, ops: getOps() })
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/op/kill', safe(async (req, res) => {
      const opId = new URL(req.url ?? '/', 'http://x').searchParams.get('opId')
      if (!opId) return sendJson(res, 400, { ok: false, error: '缺少 opId' })
      sendJson(res, 200, killOp(opId))
    }))))

    disposers.push(ctx.webServer.register(route('/api/market/disabled', safe((req, res) => {
      sendJson(res, 200, { ok: true, disabled: listDisabled() })
    }))))

    // ---- 主题系统 ----
    // GET /api/market/themes          → 主题列表（含已装/禁用状态）
    // POST /api/market/themes/switch  → { target: '主题名' } 切换主题
    disposers.push(ctx.webServer.register(route('/api/market/themes', safe(async (req, res) => {
      if (req.method === 'POST') {
        const body = await readBody(req)
        const target = (body.target || '').trim()
        if (!target) return sendJson(res, 400, { ok: false, error: '缺少 target' })
        return sendJson(res, 200, switchTheme('web', target))
      }
      const force = new URL(req.url ?? '/', 'http://x').searchParams.get('force') === '1'
      return sendJson(res, 200, await themeCatalog(force))
    }))))

    // ---- 详情页懒加载 API ----
    disposers.push(ctx.webServer.register(route('/api/market/plugin', safe(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const source = url.searchParams.get('source')
      if (!source) return sendJson(res, 400, { ok: false, error: '缺少 source' })
      const meta = await getPluginMeta(source)
      return sendJson(res, 200, meta || { ok: false, error: '未找到' })
    }))))
    disposers.push(ctx.webServer.register(route('/api/market/plugin/readme', safe(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const source = url.searchParams.get('source')
      if (!source) return sendJson(res, 400, { ok: false, error: '缺少 source' })
      const md = await getPluginReadme(source)
      return sendJson(res, 200, { ok: true, markdown: md })
    }))))
    disposers.push(ctx.webServer.register(route('/api/market/plugin/versions', safe(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const source = url.searchParams.get('source')
      if (!source) return sendJson(res, 400, { ok: false, error: '缺少 source' })
      const versions = await getPluginVersions(source)
      return sendJson(res, 200, { ok: true, versions })
    }))))

    // ---- 重启 dsh ----
    disposers.push(ctx.webServer.register(route('/api/market/restart-dsh', safe(async (req, res) => {
      sendJson(res, 200, { ok: true, hint: '正在重启 dsh…' })
      restartDsh()
    }))))

    // ---- 扩展能力 ----
    // GET /api/market/updates  → 每插件更新检测
    disposers.push(ctx.webServer.register(route('/api/market/updates', safe(async (req, res) => {
      return sendJson(res, 200, { ok: true, updates: await checkPluginUpdates('web') })
    }))))

    // POST /api/market/backup  → 备份当前配置
    // POST /api/market/restore → 恢复配置
    disposers.push(ctx.webServer.register(route('/api/market/backup', safe((req, res) => {
      return sendJson(res, 200, backupProfile('web'))
    }))))
    disposers.push(ctx.webServer.register(route('/api/market/restore', safe(async (req, res) => {
      const body = await readBody(req)
      if (!body || !body.backup) return sendJson(res, 400, { ok: false, error: '缺少 backup 字段' })
      return sendJson(res, 200, restoreProfile('web', body.backup))
    }))))

    // GET /api/market/diagnose  → 诊断面板
    disposers.push(ctx.webServer.register(route('/api/market/diagnose', safe((req, res) => {
      return sendJson(res, 200, diagnoseProfile('web'))
    }))))

    // GET /api/market/agent-running → 检查 agent 是否运行中
    disposers.push(ctx.webServer.register(route('/api/market/agent-running', safe((req, res) => {
      return sendJson(res, 200, { ok: true, ...isAgentRunning('web') })
    }))))

    // POST /api/market/clean-store  → 清理孤儿 store
    disposers.push(ctx.webServer.register(route('/api/market/clean-store', safe((req, res) => {
      return sendJson(res, 200, cleanOrphanStore('web'))
    }))))

    // GET /api/market/error-hint?key=ERR_PNPM_...&locale=zh → pnpm 错误双语提示
    disposers.push(ctx.webServer.register(route('/api/market/error-hint', safe((req, res) => {
      const url = new URL(req.url ?? '/', 'http://x')
      const key = url.searchParams.get('key') || ''
      const locale = url.searchParams.get('locale') || 'zh'
      return sendJson(res, 200, { ok: true, key, hint: getPnpmErrorHint(key, locale) || '未知错误类型' })
    }))))

    // GET /api/market/disabled-effective  → 合并的禁用列表
    disposers.push(ctx.webServer.register(route('/api/market/disabled-effective', safe((req, res) => {
      return sendJson(res, 200, { ok: true, disabled: listDisabledEffective() })
    }))))

    ctx.logger?.info?.('[dsh-plugin-market] mounted: /api/market/* + ai tools (UI 由 client.js 通过 ctx.slots.register 注入)')
    return () => { for (const d of disposers) d() }
  }, 'dsh-plugin-market')
}

/** 在 <body> 开标签后插入注入块（镜像 ui-theme 的侵入点）。 */
export function injectAfterBody(html, injection) {
  const body = /<body(?:\s[^>]*)?>/i.exec(html)
  if (body === null) return `${html}${injection}`
  const at = body.index + body[0].length
  return `${html.slice(0, at)}${injection}${html.slice(at)}`
}