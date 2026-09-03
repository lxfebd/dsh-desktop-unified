# Phase 3 实施计划：融合 flaqai 安全特性

**Goal:** 将 `flaqai/open-deepseek-harness-desktop` 的五项安全特性（依赖安全层、动态工具投影、capability-scoped IPC、三次连续退出失败明确失败状态、外部编码工具中心）融合进 `d:\deepseekhar\dsh-desktop-unified`，使桌面壳在插件代码执行前完成依赖收敛/隔离、对外只暴露最小且有界的能力面、外部工具按连接状态动态投影，且连续崩溃时给出明确失败态而非无限"启动中"。

**Architecture:** 分三层落地。① **Boot 层**（`src/main.ts` + 新增 `src/dependency-safety.ts` + 既有 `src/safe-mode.ts`）：在 `startDsh()` 之前运行依赖分析，先收敛（让插件共享 Host 依赖），收敛失败才隔离故障插件；连续退出失败时停止 splash 循环、弹出明确失败窗口。② **Host 能力面**（新增 `src/preload.ts` + `src/bridges/capabilities.ts` + `src/ipc-handlers.ts`）：通过 `contextBridge` 向 dsh web UI 暴露 `window.dshDesktop`，仅含 `desktopPrefs / logs / releases / externalTools` 四个有界 bridge，禁用通用 shell/fs/URL 能力。③ **外部工具中心**（新增 `src/dynamic-projection.ts` + `src/external-tools/{store,manager}.ts` + 设置窗口）：管理 Codex/Claude Code 连接，连接状态经 `projectTools()` 在安全 turn 边界动态投影。

**Tech Stack:** Electron 43（内嵌 Node 22/24）、TypeScript ESM（`"type":"module"`，`moduleResolution: NodeNext`，`strict`）、pnpm 11（hoisted）、`semver`（版本冲突判定，须移入生产依赖）、`vitest`（新增，纯逻辑模块 TDD）、electron-builder 26、electron-updater。

**前置说明（适用于所有 Task）：**
- 所有命令在 `d:\deepseekhar\dsh-desktop-unified` 目录下执行；优先用 `just`（见 `justfile`）。
- 项目为 ESM，`.ts` 间导入必须带 `.js` 扩展名（NodeNext 约定，如 `import { x } from './safe-mode.js'`）。
- `just build` = `tsc`（strict 类型检查），是每个 Task 的最小验证；改了主进程的 Task 还要 `just dev` 实跑。
- 提交信息用 Conventional Commits（`feat(scope): ...`）。

---

## 文件结构总览

| 文件 | 责任 | Task |
|------|------|------|
| `package.json` | 加 `vitest`(dev) / `semver`(prod) / `test` 脚本 | 1,2 |
| `tsconfig.json` | 排除 `*.test.ts` 不进 `dist/` | 1 |
| `vitest.config.ts` | vitest 配置（include `src/**/*.test.ts`） | 1 |
| `src/safe-mode.test.ts` | 既有 `findCulprit` 的回归测试（TDD 起步） | 1 |
| `src/dependency-safety.ts` | 依赖关系图分析 + 收敛 + 隔离（纯逻辑） | 2 |
| `src/dependency-safety.test.ts` | 依赖安全层单测 | 2 |
| `src/main.ts` | 接入 `preflightDependencies()` / 失败窗口 / preload / 托盘入口 | 2,4,6,7 |
| `src/dynamic-projection.ts` | 连接状态 → 投影工具集（纯逻辑） | 3 |
| `src/dynamic-projection.test.ts` | 投影单测 | 3 |
| `src/bridges/capabilities.ts` | bridge 白名单 + 禁用能力断言（纯逻辑） | 4 |
| `src/bridges/capabilities.test.ts` | 白名单单测 | 4 |
| `src/preload.ts` | `contextBridge` 暴露有界 `dshDesktop` | 4,5 |
| `src/ipc-handlers.ts` | 注册各 bridge 的 `ipcMain.handle`（desktopPrefs/logs/releases） | 4 |
| `src/external-tools/store.ts` | 外部工具配置持久化 | 5 |
| `src/external-tools/manager.ts` | 连接健康检查 + 投影对接 | 5 |

---

## Task 1: 引入 vitest 测试基建

**Files:**
- Modify: `d:\deepseekhar\dsh-desktop-unified\package.json`
- Modify: `d:\deepseekhar\dsh-desktop-unified\tsconfig.json`
- Create: `d:\deepseekhar\dsh-desktop-unified\vitest.config.ts`
- Create: `d:\deepseekhar\dsh-desktop-unified\src\safe-mode.test.ts`

本仓库目前零单测（仅有 `scripts/ci-smoke.mjs` 端到端冒烟）。本 Task 引入 vitest，并用一个既有纯函数 `findCulprit`（[safe-mode.ts:72](file:///d:/deepseekhar/dsh-desktop-unified/src/safe-mode.ts#L72)）验证 TDD 闭环，为后续纯逻辑模块（依赖安全层、动态投影、能力白名单）铺路。

- [ ] **Step 1：安装 vitest（devDependency）**

```sh
pnpm add -D vitest@^3.2.0
```

- [ ] **Step 2：在 `package.json` 加 test 脚本**

在 `scripts` 中追加 `test` 与 `test:watch`：

```json
    "docs:preview": "vitepress preview docs",
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 3：修改 `tsconfig.json`，排除测试文件不进 `dist/`**

将 `compilerOptions` 之后的 `include` 段替换为：

```json
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
```

> 理由：`tsc` 只编译运行时代码到 `dist/`；测试文件由 vitest 自行转译，不污染产物。

- [ ] **Step 4：创建 `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

- [ ] **Step 5：写失败测试 `src/safe-mode.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { findCulprit } from './safe-mode.js'

describe('findCulprit', () => {
  it('parses an apply-time loader crash', () => {
    const log = '=== dsh web starting ===\nfailed to apply loader entry market (dsh-plugin-market)\n'
    expect(findCulprit(log)).toEqual({ kind: 'apply', entryId: 'market', packageName: 'dsh-plugin-market' })
  })

  it('parses an unresolvable bundle crash', () => {
    const log = 'cannot resolve profile bundle "dsh-plugin-market"\n'
    expect(findCulprit(log)).toEqual({ kind: 'unresolvable', packageName: 'dsh-plugin-market' })
  })

  it('returns undefined when no plugin is blamed', () => {
    expect(findCulprit('something else went wrong')).toBeUndefined()
  })
})
```

- [ ] **Step 6：运行测试验证通过**

```sh
pnpm test
```

期望：3 个测试全 PASS（`findCulprit` 既有实现即满足；此步锁定现有行为，便于后续重构回归）。

- [ ] **Step 7：验证 `just build` 仍通过（测试文件被排除）**

```sh
just build
```

期望：tsc 编译成功，`dist/` 中不出现 `safe-mode.test.js`。

- [ ] **Step 8：提交**

```sh
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts src/safe-mode.test.ts
git commit -m "test: introduce vitest with findCulprit regression tests"
```

---

## Task 2: 依赖安全层 dependency-safety.ts

**Files:**
- Modify: `d:\deepseekhar\dsh-desktop-unified\package.json`（`semver` 移入生产依赖）
- Create: `d:\deepseekhar\dsh-desktop-unified\src\dependency-safety.ts`
- Create: `d:\deepseekhar\dsh-desktop-unified\src\dependency-safety.test.ts`
- Modify: `d:\deepseekhar\dsh-desktop-unified\src\main.ts`（接入 `preflightDependencies()`）

设计原则：依赖安全层必须在插件代码执行前运行（boot 层，非普通插件）；先收敛（让插件共享 Host 依赖），收敛失败才隔离。本模块是纯逻辑：读 web profile 的 `package.json`（`dsh.profile.bundles` + `dependencies`）与 profile 的 `node_modules` fallback 目录、Host 自身 `node_modules`，构建依赖图，输出三类问题——版本冲突（可收敛→给出 `convergeTo`；不可收敛→`convergeTo: undefined`）、orphaned bundle、挂载失败（坏符号链接）。隔离动作复用既有 `safe-mode.ts` 的 `recordRecoveryAction`/托盘还原语义，故本模块只动 manifest，不动 patch 层。

- [ ] **Step 1：把 `semver` 移入生产依赖**

```sh
pnpm add semver@^7.7.1
```

> `semver` 原为 devDependency；依赖安全层在打包后的主进程运行，必须随产物分发（electron-builder 只收 `dependencies`）。

- [ ] **Step 2：写失败测试 `src/dependency-safety.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeDependencies, applyConvergence, isolateBundle } from './dependency-safety.js'

interface Dirs { profileDir: string; fallbackDir: string; hostDir: string }

function setup(): Dirs {
  const root = mkdtempSync(join(tmpdir(), 'dep-'))
  const profileDir = join(root, 'profile')
  const fallbackDir = join(root, 'fallback')
  const hostDir = join(root, 'host')
  for (const d of [profileDir, fallbackDir, hostDir]) mkdirSync(d, { recursive: true })
  return { profileDir, fallbackDir, hostDir }
}

function writePkg(dir: string, pkg: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg))
}

function manifest(profileDir: string, bundles: string[], deps: Record<string, string> = {}): void {
  writeFileSync(
    join(profileDir, 'package.json'),
    JSON.stringify({ name: 'web', dsh: { profile: { bundles } }, dependencies: deps }),
  )
}

describe('analyzeDependencies', () => {
  it('converges a conflict onto the host version when it satisfies all ranges', () => {
    const d = setup()
    manifest(d.profileDir, ['bundleA', 'bundleB'])
    writePkg(join(d.fallbackDir, 'bundleA'), { dependencies: { shared: '^1.0.0' } })
    writePkg(join(d.fallbackDir, 'bundleB'), { dependencies: { shared: '^1.1.0' } })
    writePkg(join(d.hostDir, 'shared'), { version: '1.2.0' })
    const r = analyzeDependencies({ profileDir: d.profileDir, fallbackDir: d.fallbackDir, hostModulesDir: d.hostDir, builtinBundles: [] })
    expect(r.ok).toBe(true)
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0].convergeTo).toBe('1.2.0')
  })

  it('reports an unconvergable conflict when no version satisfies every range', () => {
    const d = setup()
    manifest(d.profileDir, ['bundleA', 'bundleB'])
    writePkg(join(d.fallbackDir, 'bundleA'), { dependencies: { shared: '^1.1.0' } })
    writePkg(join(d.fallbackDir, 'bundleB'), { dependencies: { shared: '^2.0.0' } })
    const r = analyzeDependencies({ profileDir: d.profileDir, fallbackDir: d.fallbackDir, hostModulesDir: d.hostDir, builtinBundles: [] })
    expect(r.ok).toBe(false)
    expect(r.conflicts[0].convergeTo).toBeUndefined()
  })

  it('detects an orphaned bundle missing from both fallback and host', () => {
    const d = setup()
    manifest(d.profileDir, ['ghost'])
    const r = analyzeDependencies({ profileDir: d.profileDir, fallbackDir: d.fallbackDir, hostModulesDir: d.hostDir, builtinBundles: [] })
    expect(r.orphans).toEqual([{ bundle: 'ghost', reason: 'not-installed' }])
    expect(r.ok).toBe(false)
  })

  it('detects a broken mount (symlink to a missing target)', () => {
    const d = setup()
    manifest(d.profileDir, ['bundleA'])
    symlinkSync(join(d.hostDir, 'does-not-exist'), join(d.fallbackDir, 'bundleA'), 'junction')
    const r = analyzeDependencies({ profileDir: d.profileDir, fallbackDir: d.fallbackDir, hostModulesDir: d.hostDir, builtinBundles: [] })
    expect(r.mountFailures).toEqual([{ bundle: 'bundleA', link: join(d.fallbackDir, 'bundleA'), reason: 'missing-target' }])
  })
})

describe('applyConvergence', () => {
  it('writes the converged host version into the profile dependencies', () => {
    const d = setup()
    manifest(d.profileDir, ['bundleA', 'bundleB'])
    writePkg(join(d.fallbackDir, 'bundleA'), { dependencies: { shared: '^1.0.0' } })
    writePkg(join(d.fallbackDir, 'bundleB'), { dependencies: { shared: '^1.1.0' } })
    writePkg(join(d.hostDir, 'shared'), { version: '1.2.0' })
    const r = analyzeDependencies({ profileDir: d.profileDir, fallbackDir: d.fallbackDir, hostModulesDir: d.hostDir, builtinBundles: [] })
    const converged = applyConvergence(r, d.profileDir)
    expect(converged).toEqual(['shared'])
    const after = JSON.parse(readFileSync(join(d.profileDir, 'package.json'), 'utf8'))
    expect(after.dependencies.shared).toBe('1.2.0')
  })
})

describe('isolateBundle', () => {
  it('removes orphaned bundles from the manifest bundle list', () => {
    const d = setup()
    manifest(d.profileDir, ['bundleA', 'ghost'])
    writePkg(join(d.fallbackDir, 'bundleA'), { dependencies: {} })
    const r = analyzeDependencies({ profileDir: d.profileDir, fallbackDir: d.fallbackDir, hostModulesDir: d.hostDir, builtinBundles: [] })
    const removed = isolateBundle(r, d.profileDir)
    expect(removed).toEqual(['ghost'])
    const after = JSON.parse(readFileSync(join(d.profileDir, 'package.json'), 'utf8'))
    expect(after.dsh.profile.bundles).toEqual(['bundleA'])
  })
})
```

- [ ] **Step 3：运行测试验证失败（模块尚不存在）**

```sh
pnpm test -- dependency-safety
```

期望：FAIL，报 `Cannot find module './dependency-safety.js'`。

- [ ] **Step 4：实现 `src/dependency-safety.ts`**

```ts
/**
 * Dependency-safety layer: builds a dependency graph of the web profile's
 * bundles BEFORE `dsh web` executes any plugin code, detects version
 * conflicts / orphaned bundles / mount failures, and emits converge-then-
 * isolate actions. Convergence makes plugins share the Host's hoisted
 * version; only when no version satisfies every range (or a bundle is
 * orphaned / unmountable) does isolation kick in — and isolation here only
 * edits the manifest, reusing safe-mode's restore semantics for the tray.
 * @module dsh-desktop/dependency-safety
 */

import { existsSync, lstatSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'

/** One bundle's requirement on a shared package. */
export interface ConflictRange {
  bundle: string
  range: string
}

/** A version conflict across two or more bundles for one package. */
export interface VersionConflict {
  package: string
  ranges: ConflictRange[]
  hostVersion: string | undefined
  /** Version that satisfies every range (the Host version when it qualifies),
   *  or `undefined` when no single version works (=> isolate). */
  convergeTo: string | undefined
}

/** A bundle listed in the profile but resolvable in neither fallback nor Host. */
export interface OrphanedBundle {
  bundle: string
  reason: 'not-installed'
}

/** A broken mount in the fallback `node_modules` (dangling symlink). */
export interface MountFailure {
  bundle: string
  link: string
  reason: 'broken-symlink' | 'missing-target'
}

/** Full pre-flight report. `ok` is true only when everything converges. */
export interface DependencyReport {
  conflicts: VersionConflict[]
  orphans: OrphanedBundle[]
  mountFailures: MountFailure[]
  ok: boolean
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

export interface AnalyzeOptions {
  profileDir: string
  fallbackDir: string
  hostModulesDir: string
  builtinBundles: string[]
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** A bundle's own dependency closure, merged from its fallback then Host copy. */
function bundleDeps(bundle: string, opts: AnalyzeOptions): Record<string, string> | undefined {
  for (const dir of [join(opts.fallbackDir, bundle), join(opts.hostModulesDir, bundle)]) {
    const pj = join(dir, 'package.json')
    if (existsSync(pj)) {
      const pkg = readJson(pj) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
      return { ...pkg.dependencies, ...pkg.peerDependencies }
    }
  }
  return undefined
}

/**
 * Build the dependency graph and classify problems. Conflicts are only
 * reported for packages required by two or more bundles; a lone range is
 * never a conflict (the loader resolves it directly).
 */
export function analyzeDependencies(opts: AnalyzeOptions): DependencyReport {
  const manifestPath = join(opts.profileDir, 'package.json')
  const manifest = (existsSync(manifestPath) ? readJson(manifestPath) : {}) as ProfileManifest
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const conflicts: VersionConflict[] = []
  const orphans: OrphanedBundle[] = []
  const mountFailures: MountFailure[] = []
  const depMap = new Map<string, ConflictRange[]>()

  for (const bundle of bundles) {
    const link = join(opts.fallbackDir, bundle)
    if (existsSync(link)) {
      try {
        const st = lstatSync(link)
        if (st.isSymbolicLink()) {
          const target = readlinkSync(link)
          if (!existsSync(target)) mountFailures.push({ bundle, link, reason: 'missing-target' })
        }
      } catch {
        mountFailures.push({ bundle, link, reason: 'broken-symlink' })
      }
    }
    const deps = bundleDeps(bundle, opts)
    if (deps === undefined) {
      if (opts.builtinBundles.includes(bundle)) continue
      orphans.push({ bundle, reason: 'not-installed' })
      continue
    }
    for (const [pkg, range] of Object.entries(deps)) {
      if (!semver.validRange(range)) continue
      const list = depMap.get(pkg) ?? []
      list.push({ bundle, range })
      depMap.set(pkg, list)
    }
  }

  for (const [pkg, ranges] of depMap) {
    if (ranges.length < 2) continue
    const hostPj = join(opts.hostModulesDir, pkg, 'package.json')
    const hostVersion = existsSync(hostPj) ? (readJson(hostPj) as { version?: string }).version : undefined
    const candidates = [hostVersion, ...ranges.map((r) => semver.minVersion(r.range)?.version)].filter(
      (v): v is string => !!v,
    )
    const convergeTo = candidates.find((v) => ranges.every((r) => semver.satisfies(v, r.range)))
    conflicts.push({ package: pkg, ranges, hostVersion, convergeTo })
  }

  const ok =
    conflicts.every((c) => c.convergeTo !== undefined) &&
    orphans.length === 0 &&
    mountFailures.length === 0
  return { conflicts, orphans, mountFailures, ok }
}

/**
 * Converge: write each resolvable conflict's `convergeTo` into the profile
 * `dependencies`, so the loader's flat fallback picks the shared Host copy.
 * Returns the packages actually changed (empty array => nothing to do).
 */
export function applyConvergence(report: DependencyReport, profileDir: string): string[] {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = (existsSync(manifestPath) ? readJson(manifestPath) : {}) as ProfileManifest
  const converged: string[] = []
  for (const c of report.conflicts) {
    if (c.convergeTo === undefined) continue
    manifest.dependencies ??= {}
    if (manifest.dependencies[c.package] !== c.convergeTo) {
      manifest.dependencies[c.package] = c.convergeTo
      converged.push(c.package)
    }
  }
  if (converged.length > 0) writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
  return converged
}

/**
 * Isolate: drop orphaned bundles (nothing to converge — they are uninstalled)
 * from the manifest's `dsh.profile.bundles`. The `dependencies` entry is kept
 * on purpose, mirroring `safe-mode.removeBundle`, so a later reinstall can
 * re-mount without a re-add. Returns the removed bundle names.
 */
export function isolateBundle(report: DependencyReport, profileDir: string): string[] {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return []
  const manifest = readJson(manifestPath) as ProfileManifest
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const orphanNames = new Set(report.orphans.map((o) => o.bundle))
  const next = bundles.filter((b) => !orphanNames.has(b))
  if (next.length === bundles.length) return []
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: next } }
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
  return [...orphanNames]
}
```

- [ ] **Step 5：运行测试验证通过**

```sh
pnpm test -- dependency-safety
```

期望：7 个测试全 PASS。

- [ ] **Step 6：在 `src/main.ts` 接入 `preflightDependencies()`**

在 `src/main.ts` 顶部导入区追加（紧跟现有 `./safe-mode.js` 导入之后）：

```ts
import { analyzeDependencies, applyConvergence, isolateBundle, type DependencyReport } from './dependency-safety.js'
```

在 `bundledPluginDir`（[main.ts:181](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L181)）之后新增 Host `node_modules` 解析器：

```ts
/**
 * The app's own hoisted `node_modules` — where first-party `@deepseek-ai/*`
 * packages live. The dependency-safety layer reads Host versions from here to
 * converge plugin conflicts onto the shared copy.
 */
function hostModulesDir(): string {
  const require = createRequire(import.meta.url)
  const pkg = require.resolve('@deepseek-ai/dsh/package.json')
  const real = pkg.includes('app.asar') ? pkg.replace('app.asar', 'app.asar.unpacked') : pkg
  return join(dirname(real), '..', '..')
}
```

在 `presetBundledPlugins` 之后新增预检函数（收敛优先，隔离只对 orphan 生效，挂载失败尝试重连）：

```ts
/** Latest pre-flight report, consulted by the recovery ladder for isolation. */
let lastDepReport: DependencyReport | undefined

/**
 * Pre-flight dependency safety: runs BEFORE `dsh web` executes any plugin
 * code. Converges version conflicts onto the Host's hoisted version (so
 * plugins share one copy), re-links broken mounts whose target is a bundled
 * plugin, and isolates orphaned bundles that can never boot. Unconvergable
 * conflicts are left to the existing safe-mode recovery ladder (apply-time
 * crashes name the culprit there too).
 */
function preflightDependencies(): DependencyReport {
  const report = analyzeDependencies({
    profileDir: webProfileDir(),
    fallbackDir: join(dshHome(), 'profiles', 'node_modules'),
    hostModulesDir: hostModulesDir(),
    builtinBundles: WEB_PROFILE_TEMPLATE,
  })
  lastDepReport = report
  const converged = applyConvergence(report, webProfileDir())
  if (converged.length > 0) {
    appendFileSync(logFile(), `=== dependency-safety: converged ${converged.join(', ')} onto host versions ===\n`)
  }
  for (const m of report.mountFailures) {
    try {
      ensurePluginSymlink(m.link, bundledPluginDir(m.bundle))
      appendFileSync(logFile(), `=== dependency-safety: re-linked broken mount ${m.bundle} ===\n`)
    } catch {
      // not a bundled plugin; the recovery ladder will isolate it on boot failure
    }
  }
  if (report.orphans.length > 0) {
    const removed = isolateBundle(report, webProfileDir())
    for (const name of removed) {
      recordRecoveryAction(safeModeStateFile(), { type: 'remove-bundle', packageName: name })
    }
    if (removed.length > 0) {
      appendFileSync(logFile(), `=== dependency-safety: isolated orphan bundles ${removed.join(', ')} ===\n`)
    }
  }
  if (!report.ok) {
    const stuck = report.conflicts.filter((c) => c.convergeTo === undefined).map((c) => c.package)
    appendFileSync(
      logFile(),
      `=== dependency-safety: preflight issues remain — unconvergable:[${stuck.join(', ')}] ===\n`,
    )
  }
  return report
}
```

在 `boot()`（[main.ts:1151](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L1151)）的 `presetBundledPlugins()` 之后、`const tried = new Set<string>()` 之前插入一行：

```ts
  presetBundledPlugins()
  preflightDependencies()
  const tried = new Set<string>()
```

- [ ] **Step 7：类型检查**

```sh
just build
```

期望：tsc 编译成功，无错误。

- [ ] **Step 8：实跑验证收敛日志**

```sh
just dev
```

期望：应用启动到 UI。关闭应用后查看日志，确认存在 `=== dependency-safety:` 记录（至少 `preflight issues remain` 或收敛记录之一；无插件冲突时也应有预检走过——若无任何 `dependency-safety` 行，说明 `preflightDependencies` 未被调用，回查 Step 6 接入点）。日志路径：托盘菜单「打开日志」。

- [ ] **Step 9：提交**

```sh
git add package.json pnpm-lock.yaml src/dependency-safety.ts src/dependency-safety.test.ts src/main.ts
git commit -m "feat(safe-mode): add dependency-safety pre-flight (converge-then-isolate)"
```

---

## Task 3: 动态工具投影 dynamic-projection.ts

**Files:**
- Create: `d:\deepseekhar\dsh-desktop-unified\src\dynamic-projection.ts`
- Create: `d:\deepseekhar\dsh-desktop-unified\src\dynamic-projection.test.ts`

连接状态作为 Host capability：只有处于"已连接"状态的外部工具（Codex/Claude Code）的能力才被投影；在安全 turn 边界（调用方查询 `projected()` 时）注入。本模块是纯函数，便于 TDD。

- [ ] **Step 1：写失败测试 `src/dynamic-projection.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { projectTools } from './dynamic-projection.js'

describe('projectTools', () => {
  it('projects only connected tools with their capabilities', () => {
    const r = projectTools([
      { id: 'a', kind: 'codex', connected: true, capabilities: ['codex.exec', 'codex.suggest'] },
      { id: 'b', kind: 'claude-code', connected: false, capabilities: ['claude.read'] },
    ])
    expect(r).toEqual([{ id: 'a', capabilities: ['codex.exec', 'codex.suggest'], source: 'codex' }])
  })

  it('returns an empty projection when nothing is connected', () => {
    expect(projectTools([])).toEqual([])
  })

  it('projects multiple connected tools independently', () => {
    const r = projectTools([
      { id: 'a', kind: 'codex', connected: true, capabilities: ['codex.exec'] },
      { id: 'b', kind: 'claude-code', connected: true, capabilities: ['claude.read', 'claude.write'] },
    ])
    expect(r).toHaveLength(2)
    expect(r.map((t) => t.source).sort()).toEqual(['claude-code', 'codex'])
  })
})
```

- [ ] **Step 2：运行测试验证失败**

```sh
pnpm test -- dynamic-projection
```

期望：FAIL，`Cannot find module './dynamic-projection.js'`。

- [ ] **Step 3：实现 `src/dynamic-projection.ts`**

```ts
/**
 * Dynamic tool projection: maps the external-tools connection state to the
 * set of capabilities projected into the agent at a safe turn boundary. Only
 * connected tools are projected — a disconnect immediately drops its tools,
 * so the Host never advertises capabilities the user has turned off.
 * @module dsh-desktop/dynamic-projection
 */

export type ToolKind = 'codex' | 'claude-code'

/** A tool's live connection state, as held by the external-tools manager. */
export interface ToolConnection {
  id: string
  kind: ToolKind
  connected: boolean
  capabilities: string[]
}

/** One projected tool: its id, the capabilities it contributes, and its source kind. */
export interface ProjectedTool {
  id: string
  capabilities: string[]
  source: ToolKind
}

/**
 * Project connected tools' capabilities. Pure: the call site (a Host
 * capability queried at the turn boundary) supplies the live connection
 * state and receives exactly the tools that should be injected now.
 */
export function projectTools(connections: ToolConnection[]): ProjectedTool[] {
  return connections
    .filter((c) => c.connected)
    .map((c) => ({ id: c.id, capabilities: c.capabilities, source: c.kind }))
}
```

- [ ] **Step 4：运行测试验证通过**

```sh
pnpm test -- dynamic-projection
```

期望：3 个测试全 PASS。

- [ ] **Step 5：提交**

```sh
git add src/dynamic-projection.ts src/dynamic-projection.test.ts
git commit -m "feat(projection): add dynamic tool projection from connection state"
```

---

## Task 4: capability-scoped preload + IPC bridges（desktopPrefs/logs/releases）

**Files:**
- Create: `d:\deepseekhar\dsh-desktop-unified\src\bridges\capabilities.ts`
- Create: `d:\deepseekhar\dsh-desktop-unified\src\bridges\capabilities.test.ts`
- Create: `d:\deepseekhar\dsh-desktop-unified\src\ipc-handlers.ts`
- Create: `d:\deepseekhar\dsh-desktop-unified\src\preload.ts`
- Modify: `d:\deepseekhar\dsh-desktop-unified\src\main.ts`（`createWindow` 加 `webPreferences`、`whenReady` 注册 handler）

设计原则：每个 bridge 独立权限，无通用 shell/fs/URL 能力。Web 内容可以管理桌面偏好、查看日志、查询 Releases，但不获得通用 shell/fs/URL。`capabilities.ts` 是白名单：preload 与 ipc-handlers 都以它为唯一真相源，未知 bridge/method 一律拒绝。本 Task 先落地 desktopPrefs/logs/releases 三个 bridge；externalTools 在 Task 5 接入（白名单里先占位行，避免后续改动 preload 签名）。

- [ ] **Step 1：写失败测试 `src/bridges/capabilities.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { BRIDGE_CHANNELS, FORBIDDEN_CAPABILITIES, assertCapabilityAllowed } from './capabilities.js'

describe('capability allow-list', () => {
  it('exposes no generic shell/fs/url capabilities', () => {
    const all = Object.keys(BRIDGE_CHANNELS)
    for (const f of FORBIDDEN_CAPABILITIES) expect(all).not.toContain(f)
  })

  it('rejects an unknown bridge', () => {
    expect(() => assertCapabilityAllowed('shell', 'run')).toThrow()
  })

  it('rejects a known bridge with a non-whitelisted method', () => {
    expect(() => assertCapabilityAllowed('desktopPrefs', 'exec')).toThrow()
    expect(() => assertCapabilityAllowed('logs', 'writeFile')).toThrow()
  })

  it('allows whitelisted bridge methods', () => {
    expect(() => assertCapabilityAllowed('desktopPrefs', 'get')).not.toThrow()
    expect(() => assertCapabilityAllowed('logs', 'tail')).not.toThrow()
    expect(() => assertCapabilityAllowed('releases', 'list')).not.toThrow()
  })
})
```

- [ ] **Step 2：运行测试验证失败**

```sh
pnpm test -- capabilities
```

期望：FAIL，`Cannot find module './capabilities.js'`。

- [ ] **Step 3：实现 `src/bridges/capabilities.ts`**

```ts
/**
 * The single source of truth for what the Host exposes to web content. Every
 * preload binding and every ipcMain handler is generated from this map, so a
 * capability that is not listed here cannot be reached from the renderer —
 * there is no generic shell/fs/url bridge to escalate through.
 * @module dsh-desktop/bridges/capabilities
 */

export type BridgeName = 'desktopPrefs' | 'logs' | 'releases' | 'externalTools'

export const BRIDGE_CHANNELS: Record<BridgeName, readonly string[]> = {
  desktopPrefs: ['get', 'set'],
  logs: ['tail', 'reveal'],
  releases: ['list'],
  externalTools: ['list', 'add', 'remove', 'connect', 'disconnect', 'projected'],
}

/** Names that must never appear as a bridge — they would grant generic power. */
export const FORBIDDEN_CAPABILITIES = ['shell', 'exec', 'spawn', 'openUrl', 'fs', 'process'] as const

/**
 * Assert a (bridge, method) pair is on the allow-list. ipcMain handlers call
 * this before dispatching, so a renderer that somehow synthesizes an unknown
 * channel gets a hard rejection instead of a capability it should not have.
 */
export function assertCapabilityAllowed(bridge: string, method: string): void {
  const allowed = BRIDGE_CHANNELS[bridge as BridgeName]
  if (!allowed || !allowed.includes(method)) {
    throw new Error(`capability not allowed: ${bridge}.${method}`)
  }
}
```

- [ ] **Step 4：运行测试验证通过**

```sh
pnpm test -- capabilities
```

期望：4 个测试全 PASS。

- [ ] **Step 5：实现 `src/ipc-handlers.ts`**

```ts
/**
 * Main-process side of the capability-scoped bridges. Each handler is
 * generated from `BRIDGE_CHANNELS` and double-checked by
 * `assertCapabilityAllowed`, so the exposed surface is exactly the allow-list
 * — desktop preferences, a read-only log tail, read-only release listing,
 * and (Task 5) external-tools management. No shell/fs/url passthrough.
 * @module dsh-desktop/ipc-handlers
 */

import { app, ipcMain, shell } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { assertCapabilityAllowed, BRIDGE_CHANNELS, type BridgeName } from './bridges/capabilities.js'

let logPath = ''
/** Set once at boot so the logs bridge can tail/reveal without a path param. */
export function setLogPath(p: string): void {
  logPath = p
}

function prefsFile(): string {
  return join(app.getPath('userData'), 'desktop-prefs.json')
}

const RELEASES_API = 'https://api.github.com/repos/deepseekhar/dsh-desktop-unified/releases?per_page=10'

/** Per-bridge handler tables. externalTools is wired in Task 5. */
const handlers: Record<BridgeName, Record<string, (...args: unknown[]) => unknown>> = {
  desktopPrefs: {
    get: () => {
      try {
        return JSON.parse(readFileSync(prefsFile(), 'utf8'))
      } catch {
        return {}
      }
    },
    set: (prefs: unknown) => {
      writeFileSync(prefsFile(), JSON.stringify(prefs ?? {}, undefined, 2) + '\n', 'utf8')
    },
  },
  logs: {
    // Read-only tail of the single dsh.log — no arbitrary file path accepted.
    tail: (bytes: unknown) => {
      const n = Number(bytes) || 64 * 1024
      return existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(-n) : ''
    },
    reveal: () => shell.showItemInFolder(logPath),
  },
  releases: {
    // Read-only GitHub releases listing; no arbitrary URL fetch.
    list: async () => {
      try {
        const res = await fetch(RELEASES_API, { headers: { 'User-Agent': 'dsh-desktop' } })
        if (!res.ok) return []
        const data = (await res.json()) as Array<{
          tag_name: string
          name: string
          published_at: string
          html_url: string
        }>
        return data.map((r) => ({ tag: r.tag_name, name: r.name, publishedAt: r.published_at, url: r.html_url }))
      } catch {
        return []
      }
    },
  },
  externalTools: {
    list: () => [],
    add: () => {},
    remove: () => {},
    connect: () => false,
    disconnect: () => {},
    projected: () => [],
  },
}

/**
 * Register every whitelisted `bridge:method` handler. Each handler re-checks
 * the allow-list before dispatch, so the surface cannot grow accidentally.
 */
export function registerIpcHandlers(): void {
  for (const bridge of Object.keys(BRIDGE_CHANNELS) as BridgeName[]) {
    for (const method of BRIDGE_CHANNELS[bridge]) {
      const channel = `${bridge}:${method}`
      ipcMain.handle(channel, (_event, ...args) => {
        assertCapabilityAllowed(bridge, method)
        return handlers[bridge][method](...args)
      })
    }
  }
}
```

- [ ] **Step 6：实现 `src/preload.ts`**

```ts
/**
 * Renderer-exposed, capability-scoped surface. Runs in the dsh web UI's
 * renderer under `contextIsolation: true`, so the page cannot reach Node or
 * tamper with the bindings — only `window.dshDesktop` is visible, and every
 * method is one of the whitelisted `bridge:method` channels. There is no
 * shell, fs, or url entry point to escalate through.
 * @module dsh-desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import { BRIDGE_CHANNELS, type BridgeName } from './bridges/capabilities.js'

function makeBridge(bridge: BridgeName): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of BRIDGE_CHANNELS[bridge]) {
    api[method] = (...args: unknown[]) => ipcRenderer.invoke(`${bridge}:${method}`, ...args)
  }
  return api
}

contextBridge.exposeInMainWorld('dshDesktop', {
  desktopPrefs: makeBridge('desktopPrefs'),
  logs: makeBridge('logs'),
  releases: makeBridge('releases'),
  externalTools: makeBridge('externalTools'),
})
```

- [ ] **Step 7：在 `src/main.ts` 接入 preload 与 handler**

在导入区追加：

```ts
import { fileURLToPath } from 'node:url'
import { registerIpcHandlers, setLogPath } from './ipc-handlers.js'
```

在 `devIcon` 附近新增 preload 路径解析器（与 `dist/` 同目录）：

```ts
/** Compiled preload path, sibling to `dist/main.js`. Works in dev and asar. */
function preloadPath(): string {
  return fileURLToPath(new URL('./preload.js', import.meta.url))
}
```

在 `createWindow`（[main.ts:501](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L501)）的 `new BrowserWindow({...})` 中追加 `webPreferences`：

```ts
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
    ...(saved === undefined ? {} : { x: saved.x, y: saved.y }),
    minWidth: 800,
    minHeight: 600,
    title: 'DSH Desktop',
    autoHideMenuBar: true,
    icon: devIcon(),
    webPreferences: {
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: false,
    },
  })
```

在 `app.whenReady().then(async () => {...})`（[main.ts:1194](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L1194)）的 `setupAutoUpdate()` 之后、`createSplash()` 之前插入：

```ts
    setupAutoUpdate()
    setLogPath(logFile())
    registerIpcHandlers()
    createSplash()
```

- [ ] **Step 8：类型检查**

```sh
just build
```

期望：tsc 编译成功。

- [ ] **Step 9：实跑验证能力面有界**

```sh
just dev
```

期望：UI 正常加载。在开发者工具 Console 执行：

```js
Object.keys(window.dshDesktop)
```

应返回 `['desktopPrefs','logs','releases','externalTools']`，且 `window.dshDesktop.shell` 为 `undefined`（确认无通用能力）。若 UI 白屏，多半是 `sandbox: false` 之外尚需调整——回查 Step 7 的 `webPreferences`。

- [ ] **Step 10：提交**

```sh
git add src/bridges/capabilities.ts src/bridges/capabilities.test.ts src/ipc-handlers.ts src/preload.ts src/main.ts
git commit -m "feat(security): add capability-scoped preload and IPC bridges"
```

---

## Task 5: 外部编码工具中心（store + manager + bridge 接线）

**Files:**
- Create: `d:\deepseekhar\dsh-desktop-unified\src\external-tools\store.ts`
- Create: `d:\deepseekhar\dsh-desktop-unified\src\external-tools\store.test.ts`
- Create: `d:\deepseekhar\dsh-desktop-unified\src\external-tools\manager.ts`
- Modify: `d:\deepseekhar\dsh-desktop-unified\src\ipc-handlers.ts`（externalTools handler 接到真实 store/manager）

管理 Codex/Claude Code 连接：配置持久化到 `userData/external-tools.json`；`connect()` 用 `<command> --version` 做健康检查；`projected()` 经 Task 3 的 `projectTools()` 投影已连接工具。本 Task 只做后端逻辑与 bridge 接线，设置窗口在 Task 7。

- [ ] **Step 1：写失败测试 `src/external-tools/store.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

// The store reads `app.getPath('userData')` from electron; stub it to a temp
// dir so tests never touch real app data. The factory closes over `userData`
// (a live binding), and getPath is only called at runtime — after beforeEach
// sets it — so there is no temporal-dead-zone read at mock-eval time.
let userData = ''
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addTool, loadTools, removeTool } from './store.js'

beforeEach(() => {
  userData = mkdtempSync(join(tmpdir(), 'et-'))
})

describe('external-tools store', () => {
  it('adds a tool with a generated id and connected=false', () => {
    const created = addTool({ name: 'Codex', kind: 'codex', command: 'codex' })
    expect(created.id).toMatch(/^tool-\d+$/)
    expect(created.connected).toBe(false)
    expect(loadTools()).toHaveLength(1)
  })

  it('removes a tool by id', () => {
    const created = addTool({ name: 'Claude', kind: 'claude-code', command: 'claude' })
    removeTool(created.id)
    expect(loadTools()).toHaveLength(0)
  })

  it('persists across calls by writing external-tools.json', () => {
    addTool({ name: 'Codex', kind: 'codex', command: 'codex' })
    const saved = JSON.parse(readFileSync(join(userData, 'external-tools.json'), 'utf8'))
    expect(saved.tools).toHaveLength(1)
    expect(saved.tools[0].name).toBe('Codex')
  })
})
```

- [ ] **Step 2：运行测试验证失败**

```sh
pnpm test -- store
```

期望：FAIL，`Cannot find module './store.js'`。

- [ ] **Step 3：实现 `src/external-tools/store.ts`**

```ts
/**
 * Persistence for external coding-tool configs. The file lives under
 * userData so it survives upgrades; the desktop shell owns it (not dsh).
 * @module dsh-desktop/external-tools/store
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type ToolKind = 'codex' | 'claude-code'

export interface ToolConfig {
  id: string
  name: string
  kind: ToolKind
  command: string
  connected: boolean
}

interface ToolStore {
  tools: ToolConfig[]
}

function storeFile(): string {
  return join(app.getPath('userData'), 'external-tools.json')
}

export function loadTools(): ToolConfig[] {
  if (!existsSync(storeFile())) return []
  try {
    return (JSON.parse(readFileSync(storeFile(), 'utf8')) as ToolStore).tools ?? []
  } catch {
    return []
  }
}

export function saveTools(tools: ToolConfig[]): void {
  writeFileSync(storeFile(), JSON.stringify({ tools }, undefined, 2) + '\n', 'utf8')
}

export function addTool(tool: Omit<ToolConfig, 'id' | 'connected'>): ToolConfig {
  const tools = loadTools()
  const created: ToolConfig = { ...tool, id: `tool-${Date.now()}`, connected: false }
  tools.push(created)
  saveTools(tools)
  return created
}

export function removeTool(id: string): void {
  saveTools(loadTools().filter((t) => t.id !== id))
}

export function setConnected(id: string, connected: boolean): void {
  const tools = loadTools()
  const t = tools.find((x) => x.id === id)
  if (t) {
    t.connected = connected
    saveTools(tools)
  }
}
```

- [ ] **Step 4：运行测试验证通过**

```sh
pnpm test -- store
```

期望：3 个测试全 PASS。

- [ ] **Step 5：实现 `src/external-tools/manager.ts`**

```ts
/**
 * Connection manager for external coding tools: health-checks each tool on
 * connect (`<command> --version`), tracks connected state in the store, and
 * projects connected tools' capabilities via dynamic-projection — the Host
 * capability queried at the safe turn boundary.
 * @module dsh-desktop/external-tools/manager
 */

import { spawnSync } from 'node:child_process'
import { addTool, loadTools, removeTool, setConnected, type ToolConfig, type ToolKind } from './store.js'
import { projectTools, type ProjectedTool } from '../dynamic-projection.js'

const HEALTH_FLAG = '--version'

/** Per-kind capability surface a connected tool contributes. */
export function capabilitiesFor(kind: ToolKind): string[] {
  return kind === 'codex' ? ['codex.exec', 'codex.suggest'] : ['claude.read', 'claude.write']
}

/** Probe a tool by running `<command> --version`; exit 0 means reachable. */
function probe(t: ToolConfig): boolean {
  try {
    const res = spawnSync(t.command, [HEALTH_FLAG], { timeout: 5000 })
    return res.status === 0
  } catch {
    return false
  }
}

export function listTools(): ToolConfig[] {
  return loadTools()
}

export function addExternalTool(tool: Omit<ToolConfig, 'id' | 'connected'>): ToolConfig {
  return addTool(tool)
}

export function removeExternalTool(id: string): void {
  removeTool(id)
}

/** Health-check and flip the connected flag. Returns the new connected state. */
export function connect(id: string): boolean {
  const tools = loadTools()
  const t = tools.find((x) => x.id === id)
  if (!t) return false
  const ok = probe(t)
  setConnected(id, ok)
  return ok
}

export function disconnect(id: string): void {
  setConnected(id, false)
}

/** The projected tool set for the current connection state (turn boundary). */
export function projectedTools(): ProjectedTool[] {
  return projectTools(
    loadTools().map((t) => ({ id: t.id, kind: t.kind, connected: t.connected, capabilities: capabilitiesFor(t.kind) })),
  )
}
```

- [ ] **Step 6：把 `src/ipc-handlers.ts` 的 externalTools handler 接到真实 manager**

在 `src/ipc-handlers.ts` 顶部导入区追加：

```ts
import {
  addExternalTool,
  connect as connectTool,
  disconnect as disconnectTool,
  listTools,
  projectedTools,
  removeExternalTool,
  type ToolConfig,
} from './external-tools/manager.js'
```

将 `handlers` 中的 `externalTools` 表替换为真实实现：

```ts
  externalTools: {
    list: () => listTools(),
    add: (tool: unknown) => addExternalTool(tool as Omit<ToolConfig, 'id' | 'connected'>),
    remove: (id: unknown) => removeExternalTool(String(id)),
    connect: (id: unknown) => connectTool(String(id)),
    disconnect: (id: unknown) => disconnectTool(String(id)),
    projected: () => projectedTools(),
  },
```

- [ ] **Step 7：类型检查 + 全量测试**

```sh
just build && pnpm test
```

期望：tsc 编译成功；所有测试 PASS（safe-mode / dependency-safety / dynamic-projection / capabilities / store）。

- [ ] **Step 8：提交**

```sh
git add src/external-tools/store.ts src/external-tools/store.test.ts src/external-tools/manager.ts src/ipc-handlers.ts
git commit -m "feat(external-tools): add tool store, connection manager, and bridge wiring"
```

---

## Task 6: 三次连续退出失败 → 明确失败状态

**Files:**
- Modify: `d:\deepseekhar\dsh-desktop-unified\src\main.ts`（`boot()` 计数 + `createFailureWindow()` + `retryBoot()`）

设计原则：三次连续退出失败后不显示无限"启动中"，而是明确失败 + 重试 + 日志。当前 `boot()`（[main.ts:1151](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L1151)）的恢复阶梯按 attempt 递进，但 splash 会一直转。本 Task 新增"连续子进程退出"计数器：当 dsh 子进程在就绪前连续退出累计达 3 次，销毁 splash、弹出明确失败窗口（重试/查看日志/退出），停止无限恢复循环。

- [ ] **Step 1：在 `src/main.ts` 顶部状态区新增计数与失败窗口变量**

在 `let booted = false`（[main.ts:1030](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L1030)）之后追加：

```ts
/** Consecutive times the dsh child exited before readiness. 3 => explicit failure. */
let consecutiveExitFailures = 0
/** Explicit failure window shown after 3 consecutive exits, replacing the splash. */
let failureWindow: BrowserWindow | undefined
```

- [ ] **Step 2：实现 `createFailureWindow()`（放在 `destroySplash` 之后）**

```ts
/**
 * Explicit failure window, shown after three consecutive child exits. Unlike
 * the splash (which spins indefinitely while recovery dialogs stack), this
 * states the failure plainly and offers bounded actions — retry (resets the
 * counter and re-enters boot), view the log, or quit. Actions are routed via
 * `dsh-desktop:` pseudo-URLs intercepted in `will-navigate`, so the window
 * needs no preload of its own.
 */
function createFailureWindow(attempt: number): void {
  destroySplash()
  const zh = isZhLocale()
  const title = zh ? '启动失败' : 'Startup Failed'
  const msg = zh ? `DSH 已连续 ${attempt} 次启动后立即退出。` : `DSH exited immediately ${attempt} times in a row.`
  const hint = zh
    ? '可能是插件或安装损坏。可重试、查看日志或退出。'
    : 'A plugin or the install may be broken. Retry, view the log, or quit.'
  const retry = zh ? '重试' : 'Retry'
  const logs = zh ? '查看日志' : 'View log'
  const quit = zh ? '退出' : 'Quit'
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;
background:#fff;color:#333;font:14px -apple-system,"Segoe UI",sans-serif;user-select:none}
@media (prefers-color-scheme:dark){html,body{background:#1e1e1e;color:#ddd}}
.wrap{text-align:center;line-height:1.8;max-width:320px}
h1{font-size:16px;margin:0 0 8px}
p{margin:0 0 18px;opacity:.7;font-size:13px}
a{display:inline-block;margin:0 6px;padding:8px 16px;border-radius:6px;text-decoration:none;
color:#fff;background:#4d6bfe;font-size:13px}
a.log{background:#6b7280}
a.quit{background:#ef4444}
</style></head><body><div class="wrap"><h1>${title}</h1><p>${msg}<br>${hint}</p>
<a href="dsh-desktop:retry">${retry}</a><a class="log" href="dsh-desktop:logs">${logs}</a><a class="quit" href="dsh-desktop:quit">${quit}</a>
</div></body></html>`
  failureWindow = new BrowserWindow({
    width: 420,
    height: 240,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    title: 'DSH Desktop',
    icon: devIcon(),
  })
  void failureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  failureWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    const action = url.replace('dsh-desktop:', '')
    if (action === 'retry') {
      failureWindow?.destroy()
      failureWindow = undefined
      void retryBoot()
    } else if (action === 'logs') {
      shell.showItemInFolder(logFile())
    } else if (action === 'quit') {
      quitting = true
      app.quit()
    }
  })
}

/**
 * Re-enter boot after an explicit failure-retry. Resets the consecutive-exit
 * counter, recreates the splash, and runs boot again; a second failure simply
 * re-shows the failure window, so the loop stays bounded and user-driven.
 */
async function retryBoot(): Promise<void> {
  consecutiveExitFailures = 0
  createSplash()
  try {
    await boot()
  } catch (error) {
    destroySplash()
    dialog.showErrorBox(
      'DSH Desktop 启动失败',
      `${error instanceof Error ? error.message : String(error)}\n\n日志：${logFile()}`,
    )
    app.quit()
  }
}
```

- [ ] **Step 3：在 `boot()` 中接入计数与失败窗口**

将 `boot()`（[main.ts:1151](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L1151)）的 try/catch 体替换为含计数逻辑的版本。原结构：

```ts
async function boot(): Promise<void> {
  presetBundledPlugins()
  preflightDependencies()
  const tried = new Set<string>()
  let attempt = 0
  for (;;) {
    attempt++
    const port = await pickPort()
    serverPort = port
    dshChild = startDsh(port)
    try {
      await waitReady(port, dshChild)
      destroySplash()
      mainWindow = createWindow(port)
      createTray(port)
      booted = true
      if (attempt > 1) appendFileSync(logFile(), `\n=== boot succeeded after ${attempt - 1} failed attempt(s) ===\n`)
      return
    } catch (error) {
      appendFileSync(
        logFile(),
        `\n=== boot attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)} ===\n`,
      )
      if (dshChild.exitCode === null) dshChild.kill()
      if (!(await proposeRecovery(attempt, tried))) throw error
    }
  }
}
```

替换为：

```ts
async function boot(): Promise<void> {
  presetBundledPlugins()
  preflightDependencies()
  const tried = new Set<string>()
  let attempt = 0
  for (;;) {
    attempt++
    const port = await pickPort()
    serverPort = port
    dshChild = startDsh(port)
    try {
      await waitReady(port, dshChild)
      consecutiveExitFailures = 0
      destroySplash()
      mainWindow = createWindow(port)
      createTray(port)
      booted = true
      if (attempt > 1) appendFileSync(logFile(), `\n=== boot succeeded after ${attempt - 1} failed attempt(s) ===\n`)
      return
    } catch (error) {
      appendFileSync(
        logFile(),
        `\n=== boot attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)} ===\n`,
      )
      const exitedImmediately = dshChild.exitCode !== null
      if (exitedImmediately) {
        consecutiveExitFailures++
        appendFileSync(logFile(), `=== consecutive exit failures: ${consecutiveExitFailures} ===\n`)
        if (consecutiveExitFailures >= 3) {
          appendFileSync(logFile(), `=== giving up the recovery loop after ${consecutiveExitFailures} consecutive exits; showing failure window ===\n`)
          createFailureWindow(consecutiveExitFailures)
          return
        }
      }
      if (dshChild.exitCode === null) dshChild.kill()
      if (!(await proposeRecovery(attempt, tried))) throw error
    }
  }
}
```

- [ ] **Step 4：类型检查**

```sh
just build
```

期望：tsc 编译成功。

- [ ] **Step 5：实跑验证失败窗口（构造崩溃场景）**

```sh
just dev
```

验证路径：临时把某个内置 bundle 名改错（如编辑 `userData/dsh-home/profiles/web/package.json` 的 `dsh.profile.bundles` 加入一个不存在的 `broken-plugin`），让 dsh web 连续崩溃退出。启动后应看到：splash 转 → 3 次退出后弹出"启动失败"窗口（而非无限转 splash）→ 点「查看日志」能定位日志 → 点「退出」能正常退出 → 点「重试」会重建 splash 重新 boot。验证后还原该 `package.json`。

期望：连续 3 次退出后出现明确失败窗口，日志含 `=== giving up the recovery loop after 3 consecutive exits; showing failure window ===`。

- [ ] **Step 6：提交**

```sh
git add src/main.ts
git commit -m "feat(boot): show explicit failure window after 3 consecutive exits"
```

---

## Task 7: 外部工具设置窗口 + 托盘入口

**Files:**
- Modify: `d:\deepseekhar\dsh-desktop-unified\src\main.ts`（`createExternalToolsWindow()` + 托盘菜单项）

Settings → External tools 管理 Codex/Claude Code 连接。窗口复用 Task 4 的 preload（externalTools bridge），内联 HTML（沿用 splash 的内联 HTML 模式，避免新增 html 资产与打包配置），托盘菜单新增「外部工具…」入口。

- [ ] **Step 1：在 `src/main.ts` 实现 `createExternalToolsWindow()`（放在 `createTray` 之前）**

```ts
/**
 * External-tools settings window: lists configured Codex / Claude Code
 * connections and their connected state, with add / remove / connect /
 * disconnect. It reuses the capability-scoped preload (externalTools bridge),
 * so every action is one of the whitelisted channels — no shell/fs passthrough.
 */
function createExternalToolsWindow(): void {
  const zh = isZhLocale()
  const title = zh ? '外部工具' : 'External Tools'
  const name = zh ? '名称' : 'Name'
  const cmd = zh ? '命令' : 'Command'
  const kind = zh ? '类型' : 'Kind'
  const status = zh ? '状态' : 'Status'
  const actions = zh ? '操作' : 'Actions'
  const connect = zh ? '连接' : 'Connect'
  const disconnect = zh ? '断开' : 'Disconnect'
  const remove = zh ? '移除' : 'Remove'
  const add = zh ? '添加' : 'Add'
  const codex = zh ? '已连接' : 'Connected'
  const offline = zh ? '未连接' : 'Offline'
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;font:14px -apple-system,"Segoe UI",sans-serif;color:#333;background:#fff}
@media (prefers-color-scheme:dark){body{background:#1e1e1e;color:#ddd}}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th,td{border:1px solid #4443;padding:6px 8px;text-align:left;font-size:13px}
th{background:#0000000a}
button{padding:4px 10px;margin-right:4px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;font-size:12px}
@media (prefers-color-scheme:dark){button{background:#2a2a2a;color:#ddd;border-color:#555}}
.row{display:flex;gap:8px;margin-bottom:12px}
input,select{padding:5px 8px;border:1px solid #888;border-radius:4px;font-size:13px}
input[name=name]{width:120px} input[name=command]{flex:1}
</style></head><body><h2 style="font-size:16px">${title}</h2>
<div class="row"><input name="name" placeholder="${name}"/>
<select name="kind"><option value="codex">codex</option><option value="claude-code">claude-code</option></select>
<input name="command" placeholder="${cmd}"/><button id="add">${add}</button></div>
<table><thead><tr><th>${name}</th><th>${kind}</th><th>${cmd}</th><th>${status}</th><th>${actions}</th></tr></thead>
<tbody id="rows"></tbody></table>
<script>
var api = window.dshDesktop && window.dshDesktop.externalTools;
var rows = document.getElementById('rows');
var addBtn = document.getElementById('add');
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
async function render(){
  if(!api){rows.innerHTML='<tr><td colspan="5">bridge unavailable</td></tr>';return;}
  var tools = await api.list();
  var html = tools.length ? tools.map(function(t){
    var toggle = t.connected ? '${disconnect}' : '${connect}';
    var st = t.connected ? '${codex}' : '${offline}';
    return '<tr><td>'+esc(t.name)+'</td><td>'+esc(t.kind)+'</td><td>'+esc(t.command)+'</td>'
      + '<td>'+st+'</td>'
      + '<td><button data-id="'+esc(t.id)+'" data-act="toggle">'+toggle+'</button> '
      + '<button data-id="'+esc(t.id)+'" data-act="remove">${remove}</button></td></tr>';
  }).join('') : '<tr><td colspan="5" style="opacity:.6">no tools configured</td></tr>';
  rows.innerHTML = html;
}
rows.addEventListener('click', async function(e){
  var b = e.target.closest('button'); if(!b) return;
  var id = b.dataset.id;
  if(b.dataset.act==='remove') await api.remove(id);
  else if(b.dataset.act==='toggle') await (b.textContent.indexOf('${disconnect}')>=0 ? api.disconnect(id) : api.connect(id));
  render();
});
addBtn.addEventListener('click', async function(){
  var name = document.querySelector('input[name=name]').value.trim();
  var command = document.querySelector('input[name=command]').value.trim();
  var k = document.querySelector('select[name=kind]').value;
  if(!name || !command) return;
  await api.add({name:name, kind:k, command:command});
  document.querySelector('input[name=name]').value='';
  document.querySelector('input[name=command]').value='';
  render();
});
render();
</script></body></html>`
  const win = new BrowserWindow({
    width: 560,
    height: 440,
    title,
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: false },
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}
```

> 注意：内联模板字符串中的 `${codex}`/`${offline}`/`${disconnect}`/`${connect}` 是在主进程拼装时被替换为本地化文案的常量；`render()` 内的字面量对照是运行时按按钮文案判断。若文案含特殊字符需转义，此处用短中英文词，安全。

- [ ] **Step 2：在托盘菜单加入「外部工具…」入口**

在 `createTray`（[main.ts:617](file:///d:/deepseekhar/dsh-desktop-unified/src/main.ts#L617)）的 `labels` 对象追加 `tools` 项，并在菜单模板的「打开数据目录」之后插入菜单项。

`labels` 修改为：

```ts
  const labels = zh
    ? { show: '显示 DSH Desktop', update: '检查更新…', tools: '外部工具…', logs: '打开日志', data: '打开数据目录', restore: '恢复被禁用的插件并重启', quit: '退出 DSH Desktop' }
    : { show: 'Show DSH Desktop', update: 'Check for Updates…', tools: 'External Tools…', logs: 'Open log', data: 'Open data folder', restore: 'Restore disabled plugins and restart', quit: 'Quit DSH Desktop' }
```

在 `Menu.buildFromTemplate([...])` 中，于 `{ label: labels.data, click: () => void shell.openPath(dshHome()) }` 之后、`...(recovery ...)` 之前插入：

```ts
      { label: labels.tools, click: () => createExternalToolsWindow() },
```

- [ ] **Step 3：类型检查**

```sh
just build
```

期望：tsc 编译成功。

- [ ] **Step 4：实跑验证外部工具中心**

```sh
just dev
```

验证路径：托盘菜单 →「外部工具…」→ 弹出设置窗口 → 添加一条 `name=Codex, kind=codex, command=codex` → 列表出现 → 点「连接」（本机装了 `codex` 则变"已连接"，否则"未连接"，均属正常）→ 点「移除」消失 → 关窗。并在开发者工具 Console 执行 `await window.dshDesktop.externalTools.projected()`：连接时返回对应工具，断开时返回 `[]`（验证动态投影与连接状态联动）。

期望：窗口可用、增删连通正常、`projected()` 随连接状态变化。

- [ ] **Step 5：提交**

```sh
git add src/main.ts
git commit -m "feat(external-tools): add settings window and tray entry"
```

---

## 自检章节

按 `writing-plans` 规范，以全新视角逐条复核本计划与 spec 的对齐。

### 1. Spec 覆盖

逐项核对五项 flaqai 特性：

- **依赖安全层（dependency-safety.ts，插件执行前构建依赖图，检测版本冲突/orphaned Bundle/挂载失败，先收敛再隔离）** → Task 2 完整覆盖：`analyzeDependencies` 构建依赖图并产出三类问题；`applyConvergence` 收敛（共享 Host 依赖）；`isolateBundle` 隔离 orphan；`preflightDependencies` 在 `boot()` 内、`startDsh()` 之前调用（boot 层，非普通插件）。收敛失败（`convergeTo === undefined`）时仅记日志，隔离留给既有 safe-mode 阶梯（apply-time 崩溃归因）——与"先收敛再隔离"一致。✅
- **动态工具投影（dynamic-projection.ts，连接状态作为 Host capability，安全 turn 边界注入）** → Task 3 实现 `projectTools(connectionState)`；Task 5 `projectedTools()` 经 store + manager 对接，Task 7 `window.dshDesktop.externalTools.projected()` 即 turn 边界查询点。✅
- **capability-scoped IPC（每个 bridge 独立权限，无通用 shell/fs/URL，preload 重构）** → Task 4 `capabilities.ts` 白名单 + `assertCapabilityAllowed` 双重校验 + `preload.ts` 经 `contextBridge` 暴露四 bridge；`FORBIDDEN_CAPABILITIES` 含 `shell/exec/spawn/openUrl/fs/process`，测试断言无此 bridge。✅
- **三次连续退出失败 → 明确失败状态（不无限等待，明确失败+重试+日志）** → Task 6 `consecutiveExitFailures` 计数 + `createFailureWindow`（重试/查看日志/退出）+ `retryBoot`，`boot()` 在 ≥3 时 `return` 停止恢复循环。✅
- **外部编码工具中心（Settings → External tools 管理 Codex/Claude Code 连接）** → Task 5 store/manager + Task 7 设置窗口与托盘入口。✅

### 2. 占位符扫描

通读全文，确认无 `TBD`/`TODO`/`implement later`/`fill in details`/"add appropriate error handling" 等空泛措辞；每个含代码的 Step 都给出了完整可粘贴代码，每个验证 Step 都给出了具体命令与期望输出。externalTools handler 在 Task 4 先以最小返回值占位、Task 5 替换为真实 manager 调用——占位行是可运行的（返回 `[]`/`false`），非"待实现"文字。✅

### 3. 类型一致性

跨 Task 复核命名：

- `DependencyReport` / `VersionConflict` / `OrphanedBundle` / `MountFailure` / `AnalyzeOptions`：Task 2 定义，`main.ts` 仅导入 `DependencyReport` 类型与 `analyzeDependencies`/`applyConvergence`/`isolateBundle`，签名一致。✅
- `ToolConnection` / `ProjectedTool` / `ToolKind`：Task 3 定义；Task 5 `manager.ts` 导入 `projectTools` + `ProjectedTool`，`capabilitiesFor(kind: ToolKind)` 与 store 的 `ToolKind` 一致；`projectedTools()` 返回 `ProjectedTool[]`。✅
- `BridgeName` / `BRIDGE_CHANNELS`：Task 4 定义；`preload.ts` 与 `ipc-handlers.ts` 均以 `BridgeName` 索引，`externalTools` 在白名单与方法表两侧一致（list/add/remove/connect/disconnect/projected）。✅
- `ToolConfig` / `addTool` / `removeTool` / `setConnected` / `loadTools` / `saveTools`：Task 5 store 定义；manager 导入并复用，`addExternalTool/removeExternalTool` 薄封装，签名一致。✅
- `preloadPath()`：Task 4 定义，Task 7 设置窗口复用同一函数，路径一致。✅
- `consecutiveExitFailures` / `failureWindow` / `createFailureWindow` / `retryBoot`：Task 6 内部一致；`retryBoot` 调 `boot()`、`createSplash()`，`createFailureWindow` 调 `destroySplash()`/`retryBoot()`/`shell.showItemInFolder(logFile())`，均为既有或同 Task 定义符号。✅

### 4. 与项目约束的兼容性复核

- **ESM/NodeNext**：所有 `.ts` 互导用 `.js` 扩展名（`./safe-mode.js`、`./dependency-safety.js`、`./bridges/capabilities.js`、`./ipc-handlers.js`、`./external-tools/manager.js`、`./external-tools/store.js`、`./dynamic-projection.js`）。✅
- **hoisted + asarUnpack**：新增 `src/external-tools/` 子目录编译进 `dist/external-tools/`，属 `dist/**`，electron-builder 已收 `dist/**`；`semver` 移入 `dependencies` 后随 `node_modules/**` 且 `asarUnpack`。✅
- **测试文件不进产物**：`tsconfig.json` `exclude` 已排除 `src/**/*.test.ts`；`vitest.config.ts` 单独 include。✅
- **既有恢复语义不破坏**：`preflightDependencies` 的隔离对 orphan 调 `recordRecoveryAction({type:'remove-bundle'})`，与 `safe-mode.removeBundle` 同语义，托盘「恢复被禁用的插件」(`restoreAll`) 可逆序还原。✅
- **preload 在 asar 中可读**：`preloadPath()` 经 `fileURLToPath(new URL('./preload.js', import.meta.url))`，打包后指向 `app.asar/dist/preload.js`，Electron 可从 asar 读取 preload（`sandbox: false`）。✅

### 5. 验证可执行性

所有纯逻辑 Task（1/2/3/4/5）以 `pnpm test` 提供 PASS/FAIL 闭环；Electron 耦合改动（Task 2 Step 8、Task 4 Step 9、Task 6 Step 5、Task 7 Step 4）以 `just build` + `just dev` + 日志/控制台断言验证，命令均与 `justfile`/`package.json` 现有脚本对齐。✅

---

**完成标志：** 七个 Task 全部勾选、`just build` 通过、`pnpm test` 全绿、`just dev` 实跑确认依赖预检日志、失败窗口、外部工具中心与动态投影均按预期行为，即 Phase 3 融合完成。
