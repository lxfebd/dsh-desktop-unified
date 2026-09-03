// dsh-market-tools · 插件入口（host 面）
// 把 dshmarket 的官方 /dsh-market/* 路由包装成 4 个内置 AI 工具。纯转调：
// 安装/卸载/更新的全部逻辑（pnpm 坑位恢复、热挂载、allowBuilds、同源校验）
// 都在 dshmarket 路由本体里，本插件只负责本机自调的鉴权握手（见 http.js）。
// 卸载旧版自研市场（dsh-plugin-market）后，AI 工具位由本插件恢复。
import { createMarketClient, summarizeCatalog } from './http.js'

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

export function apply(ctx) {
  const marketCall = (path, opts) =>
    createMarketClient({
      port: ctx.webServer.port,
      authenticatedUrl: (url) => ctx.connection.authenticatedUrl(url),
    }).call(path, opts)

  ctx.effect(async () => {
    const defineTool = await loadDefineTool()
    const disposers = []

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_list',
      description:
        '浏览 DeepSeek Harness 插件市场：返回官方精选目录（name/owner/url/category/description/installed）'
        + '与当前已安装插件（spec/present/disabled/live）。query 可选，按名称、作者、描述、分类、URL 过滤。'
        + '装插件前先调本工具确认真实 url；spec 以 link: 或 file: 开头的是桌面壳预置插件，禁止卸载或更新。',
      parameters: {
        query: { type: 'string', description: '可选搜索关键词。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        const registry = await marketCall('/dsh-market/registry')
        const installed = await marketCall('/dsh-market/installed')
        if (registry.status !== 200) return { ok: false, error: `registry HTTP ${registry.status}`, detail: registry.json }
        if (installed.status !== 200) return { ok: false, error: `installed HTTP ${installed.status}`, detail: installed.json }
        return { ok: true, ...summarizeCatalog(registry.json, installed.json, args.query || '') }
      },
      timeoutMs: 30000,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_install',
      description:
        '从市场安装插件：url 必须是 market_list 目录条目里的 url 字段（github.com 仓库链接，可带 /tree/分支/子目录），'
        + '与安装请求同源可信。返回含 ok/hot/activation：hot=true 表示已热挂载立即生效，无需重启。'
        + 'pnpm 解析整个 profile，耗时可达数分钟，失败时 error 带完整原因（如包不存在、需要构建审批 allowBuilds）。',
      parameters: {
        url: { type: 'string', required: true, description: 'github.com 插件仓库 URL（来自 market_list 的 url 字段）。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        const url = String(args.url || '').trim()
        if (!url) return { ok: false, error: '缺少 url 参数，先用 market_list 找目录条目的 url 字段。' }
        const res = await marketCall('/dsh-market/install', { method: 'POST', body: { url }, timeoutMs: MUTATE_TIMEOUT_MS })
        return trimResult(res.json)
      },
      timeoutMs: MUTATE_TIMEOUT_MS,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_uninstall',
      description:
        '卸载已安装的插件：name 是 profile 依赖里的包名（market_list 的 installed 键）。'
        + '预置插件（spec 为 link:/file:：dshmarket、dsh-shell-control、dsh-terminal、dsh-plugin-version-manager、dsh-desktop-preset-transfer、dsh-market-tools）会被拒绝，不要尝试卸载。',
      parameters: {
        name: { type: 'string', required: true, description: '已安装插件的包名。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        const name = String(args.name || '').trim()
        if (!name) return { ok: false, error: '缺少 name 参数。' }
        const res = await marketCall('/dsh-market/uninstall', { method: 'POST', body: { name }, timeoutMs: MUTATE_TIMEOUT_MS })
        return trimResult(res.json)
      },
      timeoutMs: MUTATE_TIMEOUT_MS,
    })))

    disposers.push(ctx.tools.register(defineTool({
      name: 'market_update',
      description:
        '更新一个已安装插件到其来源最新版：git 安装看 HEAD，registry 安装看 npm latest dist-tag；'
        + '已是最新或会造成降级时返回错误。预置插件（link:/file:）会返回“从本地检出更新”提示，跳过即可。',
      parameters: {
        name: { type: 'string', required: true, description: '已安装插件的包名。' },
      },
      output: { schema: { type: 'json' }, render: jsonRender },
      async execute(args) {
        const name = String(args.name || '').trim()
        if (!name) return { ok: false, error: '缺少 name 参数。' }
        const res = await marketCall('/dsh-market/update', { method: 'POST', body: { name }, timeoutMs: MUTATE_TIMEOUT_MS })
        return trimResult(res.json)
      },
      timeoutMs: MUTATE_TIMEOUT_MS,
    })))

    return () => { for (const dispose of disposers) dispose() }
  })
}
