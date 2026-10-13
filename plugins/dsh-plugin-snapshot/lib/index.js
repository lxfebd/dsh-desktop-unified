// dsh-plugin-snapshot · 插件入口（host 面）
//
// 补的洞：桌面壳的安全模式与托盘都有"回滚到最后一次良好状态"（src/main.ts:2091
// 与 :2175 调 latestSnapshot/restoreSnapshot），但写快照的那半边（旧 dsh-plugin-market）
// 已经不是本仓库的依赖，本机 C:\Users\<u>\.dsh\storages\dsh-plugin-market 整个目录都不存在
// —— 这个恢复功能一直没有任何东西可回。本插件把写侧补回来，格式与读取方逐字段对齐。
//
// 语义：只有"能启动成功"的状态才算良好，所以快照在 host 组合完成时写一份（每次启动一份），
// 装坏了导致启动失败时，最新的那份就是上一次成功启动的状态。
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import {
  MAX_SNAPSHOTS,
  buildSnapshot,
  diffBundles,
  findSnapshot,
  latestSnapshot,
  listSnapshots,
  pruneSnapshots,
  restoreBundles,
  snapshotDir,
  writeSnapshot,
} from './snapshot.js'

export const name = 'dsh-plugin-snapshot'
// profileContext 不写进 inject：dshmarket 也是 ctx.get 取它，写进 inject 会让本插件
// 在一个 launcher 不发布该服务的主机上永远组合不出来。
export const inject = ['webServer', 'tools']

const LIST_PATH = '/plugin-snapshot/list'
const SAFE_PROFILE = /^[A-Za-z0-9._-]+$/

function message(error) {
  return error instanceof Error ? error.message : String(error)
}

function expandHome(path) {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** 与 dshmarket 的 resolveDshHome 同一语义：DSH_HOME 空串等于没设。 */
export function envDshHome(env = process.env) {
  const fromEnv = env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return resolve(expandHome(fromEnv.trim()))
  return join(homedir(), '.dsh')
}

/**
 * 本次启动真正在用的 profile。优先级：launcher 的 profileContext（权威，dshmarket 同源）
 * → DSH_PROFILE + DSH_HOME → profiles 下唯一的目录。都不成立时不猜：写错 profile
 * 等于把快照落到别人的目录里，恢复时读到的就是错的状态。
 */
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
    const name = typeof launched.name === 'string' && launched.name.trim() !== ''
      ? launched.name.trim()
      : basename(launched.dir)
    if (!SAFE_PROFILE.test(name)) {
      return { ok: false, error: `profile 名「${name}」不能当目录名用`, home }
    }
    const parent = dirname(launched.dir)
    // profiles/<name> 这种结构才往上推 dshHome，否则用 DSH_HOME/默认
    const resolvedHome = basename(parent).toLowerCase() === 'profiles' ? dirname(parent) : home
    if (existsSync(launched.dir)) {
      return { ok: true, profile: name, profileDir: launched.dir, home: resolvedHome, source: 'profileContext' }
    }
    // launcher 说在用这个 profile，可目录不在：不拿它当依据，往下找真正存在的那个
    notes.push(`profileContext 指向不存在的 ${launched.dir}`)
  }

  const envProfile = typeof env.DSH_PROFILE === 'string' && env.DSH_PROFILE.trim() !== '' ? env.DSH_PROFILE.trim() : null
  if (envProfile !== null) {
    if (!SAFE_PROFILE.test(envProfile)) {
      return { ok: false, error: `DSH_PROFILE「${envProfile}」不能当目录名用`, home }
    }
    const dir = join(profilesDir, envProfile)
    if (existsSync(dir)) {
      return { ok: true, profile: envProfile, profileDir: dir, home, source: 'env DSH_PROFILE' }
    }
    // DSH_PROFILE 常被上层进程继承下来（桌面壳起了 web 子进程时就是这种情形），
    // 它指向的 profile 在本 home 里不存在时照用会把快照写到不存在的目录。
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
    error: `无法确定 profile：${notes.length > 0 ? `${notes.join('；')}，` : ''}launcher 没给出可用的 profileContext，DSH_PROFILE 不可用，${profilesDir} 下有 ${candidates.length} 个候选（${candidates.join(', ') || '无'}）。不猜——猜错会把快照写进别的 profile。`,
  }
}

// 懒加载 @deepseek-ai/dsh-tools 的 defineTool；版本不匹配时退到最小包装（与
// dsh-market-tools / dsh-shell-control 同款策略）。
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

/** 写一份快照并修剪到最近 MAX_SNAPSHOTS 份。 */
function takeSnapshot(loc, reason) {
  try {
    const snapshot = buildSnapshot({ profileDir: loc.profileDir, profile: loc.profile, reason })
    if (snapshot.bundles.length === 0) {
      return { ok: false, error: `${loc.profileDir}\package.json 里没有 dsh.profile.bundles，写快照没有意义。` }
    }
    const dir = snapshotDir(loc.home, loc.profile)
    const written = writeSnapshot(snapshot, dir)
    const pruned = pruneSnapshots(dir)
    return {
      ok: true,
      id: snapshot.id,
      file: written.file,
      dir,
      bundles: snapshot.bundles.length,
      dependencies: Object.keys(snapshot.dependencies).length,
      disabled: snapshot.disabled.length,
      pruned,
    }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

export function apply(ctx) {
  const loc = resolveProfile(ctx)

  ctx.effect(async () => {
    const defineTool = await loadDefineTool()
    const disposers = []
    const dir = loc.ok ? snapshotDir(loc.home, loc.profile) : null

    // 每次成功启动备份一份：只有起得来的状态才算"良好状态"。放在最前面，路由才报得出它的结果。
    const boot = loc.ok ? takeSnapshot(loc, 'boot') : null
    if (!loc.ok) {
      ctx?.logger?.warn?.(`dsh-plugin-snapshot: ${loc.error}`)
    } else if (boot && !boot.ok) {
      ctx?.logger?.warn?.(`dsh-plugin-snapshot: 启动备份未写入 - ${boot.error}`)
    }

    const listPayload = (limit) => {
      if (!loc.ok) return { ok: false, error: loc.error }
      return {
        ok: true,
        profile: loc.profile,
        profileDir: loc.profileDir,
        home: loc.home,
        resolvedFrom: loc.source,
        snapshotDir: dir,
        maxSnapshots: MAX_SNAPSHOTS,
        snapshots: listSnapshots(dir, { limit }),
        latest: latestSnapshot(dir)?.id ?? null,
        bootSnapshot: boot?.ok ? { id: boot.id, file: boot.file } : { error: boot?.error ?? '未执行' },
        // 排查"为什么没有 plugin_snapshot_* 工具"用：这台主机上真的挂上了几个工具位
        toolsRegistered,
      }
    }

    // 只读路由：给 UI / 外部脚本看当前快照状态，也是本插件"活着"的可观测证据。
    // 用 webServer.register（与 dsh-mermaid / dsh-mcp-connector / dsh-ssh-ops 同款）：
    // /api/* 是 connection 的 RPC 命名空间，插件路由挂在那下面会被 RPC 分发吃掉。
    if (ctx?.webServer?.register) {
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: LIST_PATH,
        async handler(req, res) {
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            res.writeHead(405)
            res.end()
            return
          }
          try {
            const limit = Number(new URL(req.url ?? '/', 'http://127.0.0.1').searchParams.get('limit'))
            const body = JSON.stringify(listPayload(Number.isFinite(limit) ? limit : 10), null, 2)
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
            res.end(req.method === 'HEAD' ? undefined : body)
          } catch (error) {
            // 路由出错要能看见原因，而不是被 webServer 吞成一个空的 400
            res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: message(error) }))
          }
        },
      }))
    }

    let toolsRegistered = 0
    const registerTool = (tool) => {
      disposers.push(ctx.tools.register(defineTool(tool)))
      toolsRegistered += 1
    }
    if (ctx?.tools?.register) {
      registerTool({
        name: 'plugin_snapshot_list',
        description:
          '列出插件集快照（新的在前）：每份的 id、时间、bundles 数、依赖数、被停用数，以及恢复它会新增/移除哪些插件。'
          + '快照是桌面壳安全模式「回滚到最后一次良好状态」读的那份文件，每次启动成功写一份。',
        parameters: { limit: { type: 'number', description: '最多返回几份（默认 10）。' } },
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute(args) {
          const payload = listPayload(typeof args?.limit === 'number' ? args.limit : 10)
          if (!payload.ok) return payload
          // 给模型补一句"恢复会动什么"，省得它自己去比
          const current = (() => {
            try {
              const snap = latestSnapshot(dir)
              return snap ? diffBundles(currentBundles(loc), snap.bundles) : null
            } catch {
              return null
            }
          })()
          return { ...payload, restoreLatestWould: current }
        },
        timeoutMs: 30000,
      })

      registerTool({
        name: 'plugin_snapshot_create',
        description:
          '立刻给当前插件集打一份快照。装/卸/更新插件之前先调它，比等下次启动才备份更早一档。',
        parameters: { reason: { type: 'string', description: '为什么打这份快照（会存进快照文件，便于事后辨认）。' } },
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute(args) {
          if (!loc.ok) return { ok: false, error: loc.error }
          const reason = typeof args?.reason === 'string' && args.reason.trim() !== '' ? args.reason.trim() : 'manual'
          return takeSnapshot(loc, reason)
        },
        timeoutMs: 30000,
      })

      registerTool({
        name: 'plugin_snapshot_restore',
        description:
          '把某份快照的 bundles 写回 profile 的 package.json（与壳的托盘回滚同一行为：只改启动列表，不动 dependencies）。'
          + '不带 confirm 时只返回会新增/移除哪些插件，不写文件；确认后需要重启才生效。',
        parameters: {
          id: { type: 'string', required: true, description: '快照 id（plugin_snapshot_list 的 id）。' },
          confirm: { type: 'boolean', description: '真正写入需显式 true。' },
        },
        output: { schema: { type: 'json' }, render: jsonRender },
        async execute(args) {
          if (!loc.ok) return { ok: false, error: loc.error }
          const found = findSnapshot(dir, args?.id)
          if (!found) return { ok: false, error: `找不到快照「${args?.id}」。先调 plugin_snapshot_list 看有哪些。` }
          const current = currentBundles(loc)
          const diff = diffBundles(current, found.snapshot?.bundles)
          if (args?.confirm !== true) {
            return {
              ok: true,
              dryRun: true,
              id: found.snapshot?.id ?? found.file,
              wouldAdd: diff.added,
              wouldRemove: diff.removed,
              hint: '没有 confirm: true，只做了预演，没有写文件。确认后再调一次并带 confirm: true。',
            }
          }
          try {
            const result = restoreBundles(loc.profileDir, found.snapshot)
            return {
              ok: true,
              id: found.snapshot?.id ?? found.file,
              file: found.file,
              before: result.before.length,
              after: result.after.length,
              ...result.diff,
              restartRequired: true,
              hint: '已写回 profile 的启动列表；重启后生效。依赖本身没有动（改依赖走插件市场）。',
            }
          } catch (error) {
            return { ok: false, error: message(error) }
          }
        },
        timeoutMs: 30000,
      })
    } else {
      ctx?.logger?.warn?.('dsh-plugin-snapshot: 这台主机没有 tools 服务，三个快照工具位没挂上（只读路由仍然可用）。')
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

function currentBundles(loc) {
  try {
    const pkg = JSON.parse(readFileSync(join(loc.profileDir, 'package.json'), 'utf8'))
    return Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  } catch {
    return []
  }
}
