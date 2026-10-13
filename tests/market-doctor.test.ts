// dsh-market-doctor · 体检逻辑与入口集成测试
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRESET_PLUGIN_NAMES, catalogAgeDays, diagnose, parseMarketLog } from '../plugins/dsh-market-doctor/lib/doctor.js'
import { apply, envDshHome, name as pluginName, readProfileFiles, resolveProfile } from '../plugins/dsh-market-doctor/lib/index.js'

const NOW = new Date('2026-10-13T12:00:00.000Z')

/** 本机 profiles/desktop/.dsh-market/log.ndjson 的真实行形状。 */
const REAL_LOG = [
  '{"at":"2026-10-09T05:37:38.352Z","level":"info","event":"region","detail":"no region on record; network check chose china"}',
  '{"at":"2026-10-09T09:26:39.760Z","level":"warn","event":"install-blocked","detail":"refused while agents are running — session-8def1d37"}',
  '{"at":"2026-10-10T12:09:37.197Z","level":"warn","event":"update-blocked","detail":"dshmarket: refused while agents are running — session-3fd73d34"}',
  '{"at":"2026-10-11T14:52:29.171Z","level":"warn","event":"install-blocked","detail":"refused while agents are running — session-0707e9cf"}',
  '{"at":"2026-10-13T03:35:13.410Z","level":"warn","event":"install-rejected","detail":"not in curated registry: https://github.com/does-not-exist/dsh-probe-only"}',
  'not json at all',
  '',
].join('\n')

describe('parseMarketLog', () => {
  it('坏行跳过，事件按窗口计数，新的在前', () => {
    const log = parseMarketLog(REAL_LOG, { days: 14, limit: 3, now: NOW })
    expect(log.total).toBe(5)
    expect(log.counts).toMatchObject({ 'install-blocked': 2, 'update-blocked': 1, 'install-rejected': 1 })
    expect(log.latest[0].event).toBe('install-rejected')
    expect(log.latest).toHaveLength(3)
  })

  it('窗口外的老事件不进计数', () => {
    // NOW 往前 2 天 = 10-11T12:00：10-09 与 10-10 的三条被排除，只剩 10-11 与 10-13 两条
    const log = parseMarketLog(REAL_LOG, { days: 2, now: NOW })
    expect(log.recent).toBe(2)
    expect(log.counts).toEqual({ 'install-blocked': 1, 'install-rejected': 1 })
  })

  it('空日志不抛错', () => {
    expect(parseMarketLog(undefined, { now: NOW }).total).toBe(0)
  })
})

describe('catalogAgeDays', () => {
  it('按天算新鲜度，认不出来返回 null', () => {
    expect(catalogAgeDays('2026-10-01T00:00:00.000Z', NOW)).toBe(12)
    expect(catalogAgeDays('nonsense', NOW)).toBeNull()
    expect(catalogAgeDays(undefined, NOW)).toBeNull()
  })
})

describe('diagnose', () => {
  const installed = {
    profile: 'desktop',
    present: [...PRESET_PLUGIN_NAMES, 'dsh-context', 'dsh-browser'],
    bundles: [...PRESET_PLUGIN_NAMES, 'dsh-context'],
    disabled: ['dsh-theme'],
    patchForced: ['dsh-whale-widget'],
    unbundled: 'multisim-mcp-dsh-plugin',
    brokenPlugins: {},
  }
  const capabilities = { marketVersion: '1.66.17', profile: 'desktop', runtime: 'desktop', apiVersion: 1, restart: { supported: false } }

  function codes(report: { findings: Array<{ code: string }> }) {
    return report.findings.map((f) => f.code)
  }

  it('市场路由没回答时只给一条 critical，不再编后续结论', () => {
    const report = diagnose({ installed: undefined, capabilities })
    expect(report.findings).toHaveLength(1)
    expect(report.findings[0]).toMatchObject({ severity: 'critical', code: 'market-unreachable' })
  })

  it('预置插件没挂上 → high，并列出缺哪几个', () => {
    const report = diagnose({
      installed: { ...installed, present: ['dshmarket'], bundles: ['dshmarket'] },
      capabilities,
      updates: { checked: 24, updatable: 0, packages: [] },
      snapshots: { exists: true, count: 3, latest: 'x', dir: '/d' },
      now: NOW,
    })
    const hit = report.findings.find((f) => f.code === 'preset-missing')
    expect(hit?.severity).toBe('high')
    expect(hit!.evidence.missing).toEqual(PRESET_PLUGIN_NAMES.filter((n) => n !== 'dshmarket'))
  })

  it('没有回滚快照 → high（安全模式的回滚没有东西可回）', () => {
    const report = diagnose({ installed, capabilities, snapshots: { exists: false, count: 0, latest: null, dir: '/d' }, now: NOW })
    expect(codes(report)).toContain('no-snapshots')
    expect(report.findings.find((f) => f.code === 'no-snapshots')!.severity).toBe('high')
  })

  it('可更新清单 → medium 并带上版本对', () => {
    const report = diagnose({
      installed,
      capabilities,
      updates: { checked: 24, updatable: 2, packages: [{ name: 'dshmarket', installedVersion: '1.66.17', latestVersion: '1.66.18' }] },
      snapshots: { exists: true, count: 1, latest: 'x', dir: '/d' },
      now: NOW,
    })
    const hit = report.findings.find((f) => f.code === 'updatable')!
    expect(hit.severity).toBe('medium')
    expect(hit.evidence.packages[0]).toEqual({ name: 'dshmarket', installedVersion: '1.66.17', latestVersion: '1.66.18' })
  })

  it('声明了但加载不起来 → critical；在依赖里但没启用 → high', () => {
    const report = diagnose({
      installed: { ...installed, brokenPlugins: { 'dsh-cad': 'missing entry' } },
      capabilities,
      snapshots: { exists: true, count: 1, latest: 'x', dir: '/d' },
      now: NOW,
    })
    expect(codes(report)).toContain('broken-plugins')
    expect(codes(report)).toContain('unbundled')
    expect(report.findings[0].severity).toBe('critical')
  })

  it('被守卫挡回过 → medium，并给出次数', () => {
    const report = diagnose({
      installed,
      capabilities,
      updates: { checked: 0, updatable: 0, packages: [] },
      snapshots: { exists: true, count: 1, latest: 'x', dir: '/d' },
      log: parseMarketLog(REAL_LOG, { days: 14, now: NOW }),
      now: NOW,
    })
    const hit = report.findings.find((f) => f.code === 'mutations-blocked')!
    expect(hit.severity).toBe('medium')
    expect(hit.evidence.counts['install-blocked']).toBe(2)
    expect(codes(report)).toContain('install-rejected')
  })

  it('目录过期 → medium；新鲜 → info', () => {
    const stale = diagnose({ installed, capabilities, snapshots: { exists: true, count: 1, latest: 'x', dir: '/d' }, registry: { total: 4508, updated: '2026-09-01T00:00:00.000Z' }, now: NOW })
    expect(stale.findings.find((f) => f.code === 'catalog-stale')!.severity).toBe('medium')
    const fresh = diagnose({ installed, capabilities, snapshots: { exists: true, count: 1, latest: 'x', dir: '/d' }, registry: { total: 4508, updated: '2026-10-12T00:00:00.000Z' }, now: NOW })
    expect(codes(fresh)).toContain('catalog-fresh')
  })

  it('有 agent 在跑 → info（这段时间装不上）', () => {
    const report = diagnose({ installed, capabilities, snapshots: { exists: true, count: 1, latest: 'x', dir: '/d' }, runningAgents: ['session-a'], now: NOW })
    expect(report.findings.find((f) => f.code === 'guard-busy')!.evidence.runningAgents).toEqual(['session-a'])
  })

  it('本机版本与 npm 最新不一致 → medium', () => {
    const report = diagnose({ installed, capabilities, snapshots: { exists: true, count: 1, latest: 'x', dir: '/d' }, npmLatest: '1.66.18', now: NOW })
    expect(report.findings.find((f) => f.code === 'market-version-drift')!.evidence).toMatchObject({ local: '1.66.17', npm: '1.66.18' })
  })

  it('结论按严重度排序，summary 计数对得上', () => {
    const report = diagnose({
      installed: { ...installed, brokenPlugins: { x: 'boom' } },
      capabilities,
      updates: { checked: 10, updatable: 3, packages: [] },
      snapshots: { exists: false, count: 0, latest: null, dir: '/d' },
      log: parseMarketLog(REAL_LOG, { days: 14, now: NOW }),
      registry: { total: 4508, updated: '2026-09-01T00:00:00.000Z' },
      now: NOW,
    })
    const ranks = report.findings.map((f) => ['critical', 'high', 'medium', 'low', 'info'].indexOf(f.severity))
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    const total = Object.values(report.summary).reduce((a, b) => a + b, 0)
    expect(total).toBe(report.findings.length)
    expect(report.summary.critical).toBe(1)
    expect(report.profile).toBe('desktop')
    expect(report.marketVersion).toBe('1.66.17')
  })
})

describe('resolveProfile / readProfileFiles', () => {
  it('profile 定不出来时不猜', () => {
    const loc = resolveProfile({ get: () => undefined } as never, { DSH_HOME: 'Z:\\definitely-not-here-91827364' })
    expect(loc.ok).toBe(false)
  })

  it('读不到日志与快照目录时如实报告', () => {
    const files = readProfileFiles({ profileDir: 'Z:\\definitely-not-here-91827364\\profiles\\desktop', home: 'Z:\\definitely-not-here-91827364', profile: 'desktop' })
    expect(files.log).toBeNull()
    expect(files.snapshots.exists).toBe(false)
    expect(files.snapshots.count).toBe(0)
  })

  it('envDshHome 空串等于没设', () => {
    expect(envDshHome({ DSH_HOME: '  ' })).toBe(envDshHome({}))
  })

  it('继承来的 DSH_PROFILE 在本 home 里不存在时退到真正存在的 profile', () => {
    const root = mkdtempSync(join(tmpdir(), 'doctor-profile-'))
    const home = join(root, '.dsh')
    mkdirSync(join(home, 'profiles', 'smoke'), { recursive: true })
    const loc = resolveProfile({ get: () => undefined } as never, { DSH_HOME: home, DSH_PROFILE: 'desktop' })
    expect(loc.ok).toBe(true)
    expect(loc.profile).toBe('smoke')
    expect(loc.notes[0]).toContain('DSH_PROFILE=desktop')
  })
})

// 路由走 webServer.register，所以这里假的是 (req, res) 面。
async function callRoute(route: Record<string, any>, url: string, method = 'GET') {
  const res = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as string | undefined,
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status
      Object.assign(this.headers, headers ?? {})
      return this
    },
    end(chunk?: string) {
      this.body = chunk
    },
  }
  await route.handler({ method, url }, res)
  return {
    status: res.statusCode,
    headers: res.headers,
    text: () => String(res.body ?? ''),
    json: () => JSON.parse(String(res.body)),
  }
}

describe('apply()', () => {
  it('注册 market_doctor 工具与只读路由，报告从市场路由真实取数', async () => {
    const calls: string[] = []
    const tools: Array<Record<string, any>> = []
    const routes: Array<Record<string, any>> = []
    const pending: Array<() => Promise<() => void>> = []
    const fetchImpl = async (url: string) => {
      const path = new URL(url).pathname
      calls.push(path)
      const body = path === '/dsh-market/installed'
        ? { profile: 'desktop', present: PRESET_PLUGIN_NAMES, bundles: PRESET_PLUGIN_NAMES, brokenPlugins: {}, disabled: [] }
        : path === '/dsh-market/api/v1/capabilities'
          ? { marketVersion: '1.66.17', profile: 'desktop', runtime: 'desktop', apiVersion: 1 }
          : path === '/dsh-market/api/v1/updates/summary'
            ? { checked: 24, updatable: 6, packages: [{ name: 'dshmarket', installedVersion: '1.66.17', latestVersion: '1.66.18' }] }
          : path === '/'
            ? {}
            : { registry: { total: 4508, updated: '2026-10-12T00:00:00.000Z', plugins: [] } }
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: path === '/' ? { 'set-cookie': 'dsh_session=abc; Path=/' } : {},
      })
    }
    const ctx: Record<string, any> = {
      webServer: {
        port: 3999,
        register: (r: Record<string, any>) => { routes.push(r); return () => {} },
      },
      connection: {
        authenticatedUrl: (url: string) => `${url}?token=t`,
      },
      tools: { register: (t: Record<string, any>) => { tools.push(t); return () => {} } },
      get: (key: string) => (key === 'agents' ? { list: () => [{ id: 'session-a', status: 'running' }] } : undefined),
      effect: (fn: () => Promise<() => void>) => pending.push(fn),
    }
    // 让插件里的自调走这个 fetchImpl：模块顶层用的是 globalThis.fetch
    const original = globalThis.fetch
    globalThis.fetch = fetchImpl as never
    try {
      expect(pluginName).toBe('dsh-market-doctor')
      apply(ctx as never)
      for (const fn of pending) await fn()

      expect(tools.map((t) => t.name)).toEqual(['market_doctor'])
      expect(routes.map((r) => r.path)).toEqual(['/market-doctor/report'])

      const report = await tools[0].execute({})
      expect(report.ok).toBe(true)
      expect(report.summary.medium).toBeGreaterThanOrEqual(1)
      expect(report.findings.find((f: any) => f.code === 'updatable')).toBeTruthy()
      expect(report.findings.find((f: any) => f.code === 'guard-busy')).toBeTruthy()
      expect(calls).toContain('/dsh-market/installed')
      expect(calls).toContain('/dsh-market/api/v1/updates/summary')
      // 默认不拉整份目录
      expect(calls).not.toContain('/dsh-market/registry')

      const deep = await tools[0].execute({ catalog: true })
      expect(deep.findings.some((f: any) => f.code === 'catalog-fresh')).toBe(true)
      expect(calls).toContain('/dsh-market/registry')

      const response = await callRoute(routes[0], 'http://127.0.0.1:3999/market-doctor/report')
      expect(response.status).toBe(200)
      expect(response.json().ok).toBe(true)
      expect((await callRoute(routes[0], 'http://127.0.0.1:3999/market-doctor/report', 'POST')).status).toBe(405)
    } finally {
      globalThis.fetch = original
    }
  })

  it('市场路由挂了 → 报告是 503 而不是一份假的健康报告', async () => {
    const tools: Array<Record<string, any>> = []
    const pending: Array<() => Promise<() => void>> = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string) => new Response(JSON.stringify({ error: 'nope' }), {
      status: new URL(url).pathname === '/' ? 200 : 503,
      headers: new URL(url).pathname === '/' ? { 'set-cookie': 'dsh_session=abc; Path=/' } : {},
    })) as never
    try {
      apply({
        webServer: { port: 3999 },
        connection: { authenticatedUrl: (url: string) => `${url}?token=t`, fetch: { register: () => () => {} } },
        tools: { register: (t: Record<string, any>) => { tools.push(t); return () => {} } },
        get: () => undefined,
        effect: (fn: () => Promise<() => void>) => pending.push(fn),
      } as never)
      for (const fn of pending) await fn()
      const report = await tools[0].execute({})
      expect(report.ok).toBe(false)
      expect(report.error).toContain('503')
    } finally {
      globalThis.fetch = original
    }
  })
})
