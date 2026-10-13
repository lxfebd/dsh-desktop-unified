// dsh-plugin-snapshot · 快照读写与入口集成测试
// 关键一条：写出来的东西要能被宿主自己的读取方（src/plugin-recovery-restore.ts）读回来，
// 格式对不对由真正的消费者判定，不是由写侧自己说了算。
import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  MAX_SNAPSHOTS,
  buildSnapshot,
  diffBundles,
  findSnapshot,
  latestSnapshot,
  listSnapshots,
  pruneSnapshots,
  readDisabledIds,
  readProfileState,
  restoreBundles,
  snapshotDir,
  snapshotId,
  writeSnapshot,
} from '../plugins/dsh-plugin-snapshot/lib/snapshot.js'
import { apply, envDshHome, name as pluginName, resolveProfile } from '../plugins/dsh-plugin-snapshot/lib/index.js'
// 宿主侧的真实读取方
import { latestSnapshot as hostLatestSnapshot, restoreSnapshot as hostRestore } from '../src/plugin-recovery-restore.js'

const dirs: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'snap-'))
  dirs.push(root)
  return root
}

afterEach(() => {
  while (dirs.length > 0) dirs.pop()
})

describe('snapshotId / snapshotDir', () => {
  it('文件名定宽、无冒号，字典序就是时间序（宿主按 sort().reverse() 取最新）', () => {
    const older = snapshotId(new Date('2026-10-13T09:00:00.000Z'))
    const newer = snapshotId(new Date('2026-10-13T09:00:00.500Z'))
    expect(older).toBe('2026-10-13T09-00-00-000Z')
    expect([older, newer].sort()[0]).toBe(older)
    expect(older).not.toContain(':')
  })

  it('落在宿主读取方那个目录里', () => {
    expect(snapshotDir('/home/.dsh', 'desktop')).toBe(join('/home/.dsh', 'storages', 'dsh-plugin-market', 'snapshots', 'desktop'))
  })
})

describe('readProfileState / readDisabledIds', () => {
  it('读出 bundles / dependencies / disabled', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: { dshmarket: '^1.66.17', local: 'link:C:/x' },
      dsh: { profile: { bundles: ['dshmarket', 'dsh-context', 42 as never, ''] } },
    }))
    writeFileSync(join(root, 'cordis.patch.yml'), [
      '- id: dsh-whale-pet',
      '  disabled: true',
      '- id: dsh-theme',
      '  disabled: false',
      '- insert:',
      '    - id: nested',
      '      disabled: true',
      '',
    ].join('\n'))
    const state = readProfileState(root)
    expect(state.bundles).toEqual(['dshmarket', 'dsh-context'])
    expect(state.dependencies.local).toBe('link:C:/x')
    // 只认顶层 `- id:` 后面紧跟 disabled: true；insert 块里的不算停用
    expect(state.disabled).toEqual(['dsh-whale-pet'])
  })

  it('没有补丁文件时 disabled 是空而不是抛错', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['a'] } } }))
    expect(readProfileState(root).disabled).toEqual([])
  })
})

describe('写侧与宿主读侧的格式对齐', () => {
  it('写出来的快照能被 src/plugin-recovery-restore.ts 读回来并还原 bundles', () => {
    const root = tempRoot()
    const home = join(root, '.dsh')
    const profileDir = join(home, 'profiles', 'desktop')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-desktop',
      dependencies: { dshmarket: '^1.66.17' },
      dsh: { profile: { bundles: ['dshmarket', 'dsh-context'] } },
    }, null, 2))

    const snapshot = buildSnapshot({ profileDir, profile: 'desktop', reason: 'boot', now: new Date('2026-10-13T09:00:00.000Z') })
    const dir = snapshotDir(home, 'desktop')
    writeSnapshot(snapshot, dir)

    const readByHost = hostLatestSnapshot(home, 'desktop')
    expect(readByHost).toBeDefined()
    expect(readByHost!.profile).toBe('desktop')
    expect(readByHost!.bundles).toEqual(['dshmarket', 'dsh-context'])
    expect(readByHost!.dependencies.dshmarket).toBe('^1.66.17')
    expect(readByHost!.exportedAt).toBe('2026-10-13T09:00:00.000Z')

    // 装坏一个插件之后：把 bundles 改烂，再让宿主回滚
    const broken = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    broken.dsh.profile.bundles = ['dshmarket', 'dsh-context', 'dsh-broken-plugin']
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify(broken, null, 2))
    const hint = hostRestore(home, 'desktop', readByHost!)
    expect(hint).toContain('bundles=2')
    expect(JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dsh.profile.bundles)
      .toEqual(['dshmarket', 'dsh-context'])
  })

  it('同一毫秒重复写不会互相覆盖，也不会打乱新旧顺序', () => {
    const dir = join(tempRoot(), 'snapshots')
    const now = new Date('2026-10-13T09:00:00.000Z')
    const a = writeSnapshot({ id: snapshotId(now), exportedAt: now.toISOString(), profile: 'p', bundles: ['x'], dependencies: {}, disabled: [] }, dir)
    const b = writeSnapshot({ id: snapshotId(now), exportedAt: now.toISOString(), profile: 'p', bundles: ['y'], dependencies: {}, disabled: [] }, dir)
    expect(a.id).not.toBe(b.id)
    expect(a.file).not.toBe(b.file)
    const listed = listSnapshots(dir)
    expect(listed).toHaveLength(2)
    expect(listed[0].id).toBe(b.id)
  })
})

describe('list / latest / prune / find / diff', () => {
  /** 按宿主的真实目录布局铺快照：<root>/storages/dsh-plugin-market/snapshots/desktop */
  function seeded(count: number) {
    const root = tempRoot()
    const dir = snapshotDir(root, 'desktop')
    for (let i = 0; i < count; i += 1) {
      const now = new Date(Date.UTC(2026, 9, 1 + i, 9, 0, 0))
      writeSnapshot({
        id: snapshotId(now), exportedAt: now.toISOString(), profile: 'desktop',
        bundles: ['a', 'b'].slice(0, i % 2 + 1), dependencies: { a: '^1.0.0' }, disabled: [],
      }, dir)
    }
    return { root, dir }
  }

  it('新的在前，limit 生效', () => {
    const { dir } = seeded(5)
    const listed = listSnapshots(dir, { limit: 3 })
    expect(listed).toHaveLength(3)
    expect(listed[0].id.endsWith('05T09-00-00-000Z')).toBe(true)
    expect(listed[0].bundles).toBeGreaterThan(0)
  })

  it('latestSnapshot 与宿主读侧取到同一份', () => {
    const { root, dir } = seeded(4)
    const mine = latestSnapshot(dir)
    const host = hostLatestSnapshot(root, 'desktop')
    expect(mine?.id).toBe(host?.id)
    expect(mine?.bundles).toEqual(host?.bundles)
    expect(latestSnapshot(join(dir, 'does-not-exist'))).toBeUndefined()
  })

  it('只留最近 MAX_SNAPSHOTS 份', () => {
    const { dir } = seeded(MAX_SNAPSHOTS + 7)
    expect(pruneSnapshots(dir)).toBe(7)
    expect(listSnapshots(dir, { limit: 100 }).length).toBe(MAX_SNAPSHOTS)
  })

  it('findSnapshot 认 id，也认文件名；同毫秒的两份各有各的 id', () => {
    const dir = join(tempRoot(), 'snapshots')
    const now = new Date('2026-10-13T09:00:00.000Z')
    const first = writeSnapshot({ id: snapshotId(now), exportedAt: '', profile: 'p', bundles: ['x'], dependencies: {}, disabled: [] }, dir)
    const second = writeSnapshot({ id: snapshotId(now), exportedAt: '', profile: 'p', bundles: ['y'], dependencies: {}, disabled: [] }, dir)
    expect(findSnapshot(dir, first.id)?.file).toBe(first.file)
    expect(findSnapshot(dir, second.id)?.snapshot.bundles).toEqual(['y'])
    expect(findSnapshot(dir, first.file)?.snapshot.bundles).toEqual(['x'])
    expect(findSnapshot(dir, 'nope')).toBeUndefined()
    expect(findSnapshot(dir, '')).toBeUndefined()
  })

  it('diffBundles 说清楚恢复会动什么', () => {
    expect(diffBundles(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] })
    expect(diffBundles(undefined, undefined)).toEqual({ added: [], removed: [] })
  })

  it('restoreBundles 只改 bundles，不碰 dependencies', () => {
    const root = tempRoot()
    writeFileSync(join(root, 'package.json'), JSON.stringify({
      dependencies: { keep: '^1.0.0' }, dsh: { profile: { bundles: ['a', 'bad'] } },
    }, null, 2))
    const result = restoreBundles(root, { bundles: ['a'] })
    const after = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    expect(after.dsh.profile.bundles).toEqual(['a'])
    expect(after.dependencies.keep).toBe('^1.0.0')
    expect(result.diff).toEqual({ added: [], removed: ['bad'] })
  })
})

describe('resolveProfile', () => {
  it('launcher 的 profileContext 优先，并据此推出 dshHome', () => {
    const root = tempRoot()
    const home = join(root, '.dsh')
    const dir = join(home, 'profiles', 'desktop')
    mkdirSync(dir, { recursive: true })
    const ctx = { get: () => ({ name: 'desktop', dir }) }
    const loc = resolveProfile(ctx as never, {})
    expect(loc).toMatchObject({ ok: true, profile: 'desktop', home, source: 'profileContext' })
  })

  it('没有 profileContext 时退到 DSH_PROFILE，再退到唯一候选目录', () => {
    const root = tempRoot()
    const home = join(root, '.dsh')
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
    const env = { DSH_HOME: home }
    expect(resolveProfile({} as never, env as never)).toMatchObject({ ok: true, profile: 'web', source: 'profiles 下唯一目录' })
    // DSH_PROFILE 指的 profile 真在本 home 里时按它走
    mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true })
    expect(resolveProfile({} as never, { ...env, DSH_PROFILE: 'desktop' } as never)).toMatchObject({ ok: true, profile: 'desktop', source: 'env DSH_PROFILE' })
  })

  it('多个候选又不明说时不猜，把候选列出来', () => {
    const root = tempRoot()
    const home = join(root, '.dsh')
    for (const p of ['desktop', 'web', 'headless']) mkdirSync(join(home, 'profiles', p), { recursive: true })
    const loc = resolveProfile({} as never, { DSH_HOME: home } as never)
    expect(loc.ok).toBe(false)
    expect((loc as { candidates: string[] }).candidates.sort()).toEqual(['desktop', 'headless', 'web'])
  })

  it('profile 名不能当目录名时直接拒绝', () => {
    expect(resolveProfile({ get: () => ({ name: '../evil', dir: '/x/profiles/evil' }) } as never, {}).ok).toBe(false)
  })

  it('envDshHome 空串等于没设', () => {
    expect(envDshHome({ DSH_HOME: '   ' })).toBe(envDshHome({}))
  })

  it('DSH_PROFILE 继承来的 profile 在本 home 里不存在时不照用，退到真正存在的那个', () => {
    const root = tempRoot()
    const home = join(root, '.dsh')
    mkdirSync(join(home, 'profiles', 'smoke'), { recursive: true })
    const loc = resolveProfile({ get: () => undefined } as never, { DSH_HOME: home, DSH_PROFILE: 'desktop' })
    expect(loc.ok).toBe(true)
    expect(loc.profile).toBe('smoke')
    expect(loc.source).toBe('profiles 下唯一目录')
    expect(loc.notes).toContain('DSH_PROFILE=desktop 在 ' + join(home, 'profiles', 'desktop') + ' 不存在')
  })

  it('profileContext 指向不存在的目录时也不照用', () => {
    const root = tempRoot()
    const home = join(root, '.dsh')
    mkdirSync(join(home, 'profiles', 'smoke'), { recursive: true })
    const ghost = join(home, 'profiles', 'ghost')
    const loc = resolveProfile({ get: () => ({ name: 'ghost', dir: ghost }) } as never, { DSH_HOME: home })
    expect(loc.profile).toBe('smoke')
    expect(loc.notes[0]).toContain('profileContext 指向不存在的')
  })
})

// 路由走 webServer.register（与 dsh-mermaid 等真实插件同款），所以这里假的是 (req, res) 面。
function fakeWebServer() {
  const routes: Array<Record<string, any>> = []
  return { routes, webServer: { register: (route: Record<string, any>) => { routes.push(route); return () => {} } } }
}

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
  it('注册 3 个工具 + 1 条只读路由，并在启动时备份一份', async () => {
    const root = tempRoot()
    const home = join(root, '.dsh')
    const profileDir = join(home, 'profiles', 'desktop')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      dependencies: { dshmarket: '^1.66.17' },
      dsh: { profile: { bundles: ['dshmarket', 'dsh-context'] } },
    }, null, 2))

    const tools: Array<Record<string, any>> = []
    const { routes, webServer } = fakeWebServer()
    const pending: Array<() => Promise<() => void>> = []
    const ctx: Record<string, any> = {
      webServer,
      tools: { register: (t: Record<string, any>) => { tools.push(t); return () => {} } },
      get: (key: string) => (key === 'profileContext' ? { name: 'desktop', dir: profileDir } : undefined),
      effect: (fn: () => Promise<() => void>) => pending.push(fn),
    }
    expect(pluginName).toBe('dsh-plugin-snapshot')
    apply(ctx as never)
    for (const fn of pending) await fn()

    expect(tools.map((t) => t.name).sort()).toEqual(['plugin_snapshot_create', 'plugin_snapshot_list', 'plugin_snapshot_restore'])
    expect(routes.map((r) => r.path)).toEqual(['/plugin-snapshot/list'])
    expect(routes[0].kind).toBe('exact')

    // 启动备份真的落盘，而且宿主读侧能读到
    const snapDir = snapshotDir(home, 'desktop')
    expect(listSnapshots(snapDir)[0].bundles).toBe(2)
    expect(hostLatestSnapshot(home, 'desktop')?.bundles).toEqual(['dshmarket', 'dsh-context'])

    const list = await tools.find((t) => t.name === 'plugin_snapshot_list')!.execute({})
    expect(list.ok).toBe(true)
    expect(list.profile).toBe('desktop')
    expect(list.snapshots[0].bundles).toBe(2)

    const created = await tools.find((t) => t.name === 'plugin_snapshot_create')!.execute({ reason: 'before-install' })
    expect(created.ok).toBe(true)
    expect(created.bundles).toBe(2)

    // restore 默认只预演
    const dry = await tools.find((t) => t.name === 'plugin_snapshot_restore')!.execute({ id: created.id })
    expect(dry.dryRun).toBe(true)
    expect(dry.wouldAdd).toEqual([])

    // 把 bundles 改烂，再确认恢复
    const broken = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    broken.dsh.profile.bundles = ['dshmarket', 'dsh-broken']
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify(broken, null, 2))
    const restored = await tools.find((t) => t.name === 'plugin_snapshot_restore')!.execute({ id: created.id, confirm: true })
    expect(restored.ok).toBe(true)
    expect(restored.restartRequired).toBe(true)
    expect(restored.added).toEqual(['dsh-context'])
    expect(restored.removed).toEqual(['dsh-broken'])

    const missing = await tools.find((t) => t.name === 'plugin_snapshot_restore')!.execute({ id: 'nope', confirm: true })
    expect(missing.ok).toBe(false)

    const routeResponse = await callRoute(routes[0], 'http://127.0.0.1/plugin-snapshot/list?limit=2')
    expect(routeResponse.status).toBe(200)
    expect(routeResponse.headers['content-type']).toContain('application/json')
    const body = routeResponse.json()
    expect(body.ok).toBe(true)
    expect(body.snapshots.length).toBeLessThanOrEqual(2)
    expect(body.bootSnapshot.id).toBeTruthy()
    expect(body.toolsRegistered).toBe(3)

    // 非 GET 要挡住，不能把快照列表当写入面
    expect((await callRoute(routes[0], 'http://127.0.0.1/plugin-snapshot/list', 'POST')).status).toBe(405)
  })

  it('profile 定不出来时工具不猜，直接说明缺什么', async () => {
    const root = tempRoot()
    const home = join(root, '.dsh')
    for (const p of ['desktop', 'web']) mkdirSync(join(home, 'profiles', p), { recursive: true })
    const tools: Array<Record<string, any>> = []
    const pending: Array<() => Promise<() => void>> = []
    // 把环境钉到这个临时 home：真实机器上 DSH_PROFILE/DSH_HOME 都可能是设好的，
    // 不钉住就会测到真实 profile 上去。
    const savedHome = process.env.DSH_HOME
    const savedProfile = process.env.DSH_PROFILE
    process.env.DSH_HOME = home
    delete process.env.DSH_PROFILE
    try {
      apply({
        webServer: { register: () => () => {} },
        tools: { register: (t: Record<string, any>) => { tools.push(t); return () => {} } },
        get: () => undefined,
        effect: (fn: () => Promise<() => void>) => pending.push(fn),
      } as never)
      for (const fn of pending) await fn()
      const out = await tools.find((t) => t.name === 'plugin_snapshot_list')!.execute({})
      expect(out.ok).toBe(false)
      expect(out.error).toContain('无法确定 profile')
      expect(out.error).toContain('desktop')
    } finally {
      if (savedHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = savedHome
      if (savedProfile === undefined) delete process.env.DSH_PROFILE
      else process.env.DSH_PROFILE = savedProfile
    }
  })
})
