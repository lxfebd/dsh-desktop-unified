# 弥合竞品差距实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 2026-08-30《竞品差距分析》列出的 P0/P1/P2 差距逐一弥合，将本壳的稳定性/安全优势保持，并补上生态扩展层（插件保护闭环、0.1.2-alpha、多 profile、会话终端、CI 校验门、主题与通知等）。

**Architecture:** 全部改动沿四条既有主线展开：(A) `dsh-plugin-market` 插件内做插件保护中心（快照/回滚闭环，复用已有 `backupProfile/restoreProfile/diagnoseProfile` + `proposeRecovery` 阶梯）；(B) 升级 `@deepseek-ai/dsh` 0.1.1-rc.2 → 0.1.2-alpha 并启用 `dsh-desktop-preset-transfer`；(C) CI 加测试门与平台架构校验；(D) 桌面层新增多 profile（web-desktop）与会话内终端；(E) 生态增强：主题内置、余额/通知、自动压缩。评估项（macOS 签名、Tauri 体积、手机远程）单独列为评估任务，不占主链。

**Tech Stack:** Electron 43 / TypeScript ESM(NodeNext) / pnpm 11.22 / vitest / dsh 0.1.2-alpha / fflate / semver。

**环境双模式约定（重要）**

* 真实环境（有 node\_modules）：`pnpm test` / `pnpm build` / `pnpm exec tsx node dist/main.js`；Node 24。

* 沙箱（无 node\_modules）：用 `& 'C:\Program Files\nodejs\node.exe'` 做 `--check` 语法验证；用 `_verify-*.mjs` 纯 JS 逻辑验证；vitest/tsc 由真实环境负责。

* 提交：真实环境 git；沙箱无 git 时跳过提交步骤并在完成后提示。

***

## 子系统拆分（Scope Check）

本计划覆盖 5 个相对独立的子系统。每个子系统可独立产出可测软件，建议按 Phase 顺序执行：

| Phase | 子系统                            | 对应差距                      |
| ----- | ------------------------------ | ------------------------- |
| P1    | 插件保护中心（market.js 内）            | P0：装前快照/失败自动回滚闭环          |
| P2    | dsh 0.1.2-alpha 升级 + preset 启用 | P0：升级主线 + .dshpreset 可用   |
| P3    | CI 测试门 + 平台架构校验                | P1：CI 质量门                 |
| P4    | 多 profile 档案隔离                 | P1：web-desktop 独立 profile |
| P5    | 会话内终端                          | P1：项目目录持久 shell           |
| P6    | 主题内置 + 余额/通知 + 自动压缩            | P2：生态增强                   |
| P7    | 评估项（签名/体积/手机远程）                | P2：外部依赖/调研                |

***

# Phase 1：插件保护中心（装前快照 + 失败自动回滚）

## 目标与背景

EAC 的 plugin-guard 提供「安装前快照 → 启动失败自动体检 → 回滚最后良好状态」闭环。我们已有：

* `market.js:1700 backupProfile(profile)` — 导出现有 bundles/dependencies/disabled/patchDisabled 到 JSON

* `market.js:1720 restoreProfile(profile, backup)` — 回写 bundles/dependencies/disabled/patchDisabled

* `market.js:1751 diagnoseProfile(profile)` — bundle 栈冲突/缺失体检

* `main.ts:1678 proposeRecovery(attempt, tried)` — 4 级阶梯（silent retry → disable entry → remove bundle → full safe mode）

* `safe-mode.ts findCulprit` — 7 类故障归因

缺口：**安装前没有自动快照**，且 proposeRecovery 的「remove bundle」是直接删 bundle 而非回滚到装前状态。本 Phase 补齐闭环。

## 文件结构

* `plugins/dsh-plugin-market/lib/market.js` — 新增快照管理与安装钩子（Modify）

* `plugins/dsh-plugin-market/lib/market.js` — 导出 `snapshotBeforeMutation`（Modify）

* `plugins/dsh-plugin-market/lib/index.js` — 路由接线 `POST /api/market/snapshot`（Modify）

* `src/main.ts` — 启动失败时检测最近快照并联动 proposeRecovery（Modify）

* `plugins/dsh-plugin-market/test/snapshot.test.js` — 纯逻辑测试（Create；node:test 风格，可离线跑）

* `docs/HANDOVER.md` — 记录新能力（Modify，最末更新）

***

### Task 1.1: 快照落盘模块

**Files:**

* Modify: `plugins/dsh-plugin-market/lib/market.js`（在 `P1：备份与恢复` 区块内追加）

* Test: `plugins/dsh-plugin-market/test/snapshot.test.js`（Create）

* [x] **Step 1: 写失败测试**

```js
// plugins/dsh-plugin-market/test/snapshot.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { snapshotProfileState, listSnapshots, restoreFromSnapshot } from '../lib/snapshot.js'

function freshHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-snap-'))
  mkdirSync(join(dir, 'profiles', 'web'), { recursive: true })
  writeFileSync(
    join(dir, 'profiles', 'web', 'package.json'),
    JSON.stringify({ dsh: { profile: { bundles: ['a'] } }, dependencies: {} }, null, 2),
  )
  return dir
}

test('snapshot captures bundles and restore rewrites them', () => {
  const home = freshHome()
  const snap = snapshotProfileState({ dshHome: home, profile: 'web' })
  writeFileSync(
    join(home, 'profiles', 'web', 'package.json'),
    JSON.stringify({ dsh: { profile: { bundles: ['a', 'evil'] } }, dependencies: {} }, null, 2),
  )
  restoreFromSnapshot(home, 'web', snap)
  const pkg = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dsh.profile.bundles, ['a'])
  rmSync(home, { recursive: true, force: true })
})

test('snapshot file round-trips through the snapshots dir', () => {
  const home = freshHome()
  const snap = snapshotProfileState({ dshHome: home, profile: 'web' })
  const list = listSnapshots(home, 'web')
  assert.ok(list.length >= 1)
  rmSync(home, { recursive: true, force: true })
})
```

* [x] **Step 2: 运行测试确认失败**

Run（真实环境）: `cd plugins/dsh-plugin-market && node --test test/snapshot.test.js`
Expected: FAIL — `Cannot find module '../lib/snapshot.js'`

* [x] **Step 3: 创建** **`plugins/dsh-plugin-market/lib/snapshot.js`**

```js
// plugins/dsh-plugin-market/lib/snapshot.js
// 插件保护中心：装前快照 / 最近快照列表 / 回滚。纯 node:fs，无 Electron 依赖，可离线单测。
import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const MAX_SNAPSHOTS = 8

export function snapshotDir(dshHome, profile) {
  return join(dshHome, 'storages', 'dsh-plugin-market', 'snapshots', profile)
}

export function snapshotProfileState({ dshHome, profile }) {
  const profileDir = join(dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  let pkg = {}
  try { pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) } catch { pkg = {} }
  const disabledFile = join(dshHome, 'storages', 'dsh-plugin-market', 'disabled.json')
  let disabled = []
  try { disabled = JSON.parse(readFileSync(disabledFile, 'utf8')) } catch { disabled = [] }
  const snapshot = {
    id: randomUUID(),
    exportedAt: new Date().toISOString(),
    profile,
    bundles: (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [],
    dependencies: pkg.dependencies || {},
    disabled,
  }
  const dir = snapshotDir(dshHome, profile)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${snapshot.exportedAt.replace(/[:.]/g, '-')}.json`), JSON.stringify(snapshot, null, 2), 'utf8')
  pruneSnapshots(dshHome, profile)
  return snapshot
}

export function listSnapshots(dshHome, profile) {
  const dir = snapshotDir(dshHome, profile)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .reverse()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')))
}

export function restoreFromSnapshot(dshHome, profile, snapshot) {
  const profileDir = join(dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  let pkg = {}
  try { pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) } catch { pkg = {} }
  if (!pkg.dsh) pkg.dsh = {}
  if (!pkg.dsh.profile) pkg.dsh.profile = {}
  pkg.dsh.profile.bundles = snapshot.bundles || []
  pkg.dependencies = { ...(pkg.dependencies || {}), ...(snapshot.dependencies || {}) }
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2), 'utf8')
  const disabledFile = join(dshHome, 'storages', 'dsh-plugin-market', 'disabled.json')
  mkdirSync(join(dshHome, 'storages', 'dsh-plugin-market'), { recursive: true })
  writeFileSync(disabledFile, JSON.stringify(snapshot.disabled || [], null, 2), 'utf8')
  return { ok: true, bundles: snapshot.bundles || [] }
}

function pruneSnapshots(dshHome, profile) {
  const dir = snapshotDir(dshHome, profile)
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  while (files.length > MAX_SNAPSHOTS) {
    rmSync(join(dir, files.shift()), { force: true })
  }
}
```

> snapshot.js 自包含（不再复用 market.js 的 readJson，避免循环依赖），纯 node:fs 可离线单测。

* [x] **Step 4: 运行测试确认通过**

Run: `cd plugins/dsh-plugin-market && node --test test/snapshot.test.js`
Expected: PASS（2 个用例）

* [x] **Step 5: 沙箱语法验证 + 提交**

沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check plugins/dsh-plugin-market/lib/snapshot.js`
Expected: 无输出（语法 OK）

真实环境 Commit（若 git 可用）:

```bash
git add plugins/dsh-plugin-market/lib/snapshot.js plugins/dsh-plugin-market/test/snapshot.test.js
git commit -m "feat(market): plugin install snapshot/restore primitives"
```

***

### Task 1.2: 安装前自动快照 + 路由

**Files:**

* Modify: `plugins/dsh-plugin-market/lib/index.js`（在 market 路由区新增快照路由）

* Modify: `plugins/dsh-plugin-market/lib/market.js`（`runDshPlugin` 在 install/upgrade 前调用 `snapshotProfileState`）

* [x] **Step 1: 在 index.js 注册快照路由**

`lib/index.js` 中 import 区新增：

```js
import { snapshotProfileState } from './snapshot.js'
```

在既有 `/api/market/backup` 路由（`index.js:489`）之后同位追加（注意：这里的 `route`/`sendJson`/`disposers`/`ctx.webServer` 均为该文件 apply 作用域内既有工具，风格与 backup 一致，不新建 router）：

```js
    // GET /api/market/snapshot → 触发装前快照（返回本次快照元信息），供 UI/守卫生成快照
    disposers.push(ctx.webServer.register(route('/api/market/snapshot', safe((req, res) => {
      const snap = snapshotProfileState({ dshHome: RUNTIME.dshHome, profile: 'web' })
      return sendJson(res, 200, { ok: true, id: snap.id, exportedAt: snap.exportedAt, bundles: snap.bundles })
    }))))
```

> RUNTIME 由 `lib/market.js` 导出（`market.js:21`）；若 index.js 未直接可见，改为 `import { RUNTIME } from './market.js'`。

* [x] **Step 2: 在 market.js 的 install 路径插入快照**

`market.js` 内 import 区新增：

```js
import { snapshotProfileState } from './snapshot.js'
```

在 `runDshPlugin`（`market.js:164`）的 `install` / `upgrade` 分支执行 pnpm 操作之前插入：

```js
if (action === 'install' || action === 'upgrade') {
  snapshotProfileState({ dshHome: RUNTIME.dshHome, profile: profile || 'web' })
}
```

* [x] **Step 3: 验证单测仍绿 + 真实环境冒烟**

沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check plugins/dsh-plugin-market/lib/index.js`（无输出=OK）
沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check plugins/dsh-plugin-market/lib/market.js`（无输出=OK）
真实 Run: `cd plugins/dsh-plugin-market && node --test test/snapshot.test.js` → PASS

* [x] **Step 4: 提交**

```bash
git add plugins/dsh-plugin-market/lib/index.js plugins/dsh-plugin-market/lib/market.js
git commit -m "feat(market): auto snapshot before plugin install/upgrade"
```

***

### Task 1.3: 启动失败自动回滚到最近快照

**Files:**

* Create: `src/plugin-recovery-restore.ts`（宿主侧快照读取/回滚，纯 fs 无 Electron 依赖）

* Modify: `src/main.ts`（`proposeRecovery` 增加「回滚到最近快照」阶梯——排在 remove bundle 之前）

* Test: `src/safe-mode.ts` 不动

* Test: `tests/plugin-recovery-restore.test.ts`（Create，vitest，不触 fs——用临时目录注入）

> 为什么用宿主侧副本而不直接 import market.js：tsconfig include 只收 `src/**/*.ts` 且不开 allowJs，从主进程 import 插件包的 .js 会编译失败；且 proposeRecovery 需要同步 fs 风格（8-29 决策），宿主侧副本是最低耦合方案。

* [x] **Step 1: 创建宿主侧还原模块 + 失败测试**

Create: `tests/plugin-recovery-restore.test.ts`

```ts
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { latestSnapshot, restoreSnapshot, type ProfileSnapshot } from '../src/plugin-recovery-restore.js'

const snap: ProfileSnapshot = {
  id: 's1', exportedAt: '2026-08-31T00:00:00.000Z', profile: 'web',
  bundles: ['a'], dependencies: {}, disabled: [],
}

describe('plugin-recovery-restore', () => {
  it('latestSnapshot returns undefined when no snapshots exist', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-snap-'))
    expect(latestSnapshot(home, 'web')).toBeUndefined()
    rmSync(home, { recursive: true, force: true })
  })

  it('latestSnapshot picks the newest snapshot file', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-snap-'))
    const dir = join(home, 'storages', 'dsh-plugin-market', 'snapshots', 'web')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, '2026-08-30T00-00-00.json'), JSON.stringify(snap), 'utf8')
    const newer = { ...snap, id: 's2', exportedAt: '2026-08-31T00-00-00.json' }
    writeFileSync(join(dir, '2026-08-31T00-00-00.json'), JSON.stringify(newer), 'utf8')
    expect(latestSnapshot(home, 'web')?.id).toBe('s2')
    rmSync(home, { recursive: true, force: true })
  })

  it('restoreSnapshot rewrites profile bundles', () => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-snap-'))
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['a', 'evil'] } } }), 'utf8')
    restoreSnapshot(home, 'web', snap)
    const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
    expect(pkg.dsh.profile.bundles).toEqual(['a'])
    rmSync(home, { recursive: true, force: true })
  })
})
```

* [x] **Step 2: 运行测试确认失败**

真实 Run: `pnpm exec vitest run tests/plugin-recovery-restore.test.ts`
Expected: FAIL — `Cannot find module '../src/plugin-recovery-restore.js'`

* [x] **Step 3: 创建** **`src/plugin-recovery-restore.ts`**

```ts
// 与 dsh-plugin-market 快照格式兼容的宿主侧读取/回滚（无 Electron 依赖）。
// 调用方为 proposeRecovery 与托盘「回滚到上次良好状态」。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export interface ProfileSnapshot {
  id: string
  exportedAt: string
  profile: string
  bundles: string[]
  dependencies: Record<string, string>
  disabled: string[]
}

export function latestSnapshot(dshHome: string, profile: string): ProfileSnapshot | undefined {
  const dir = join(dshHome, 'storages', 'dsh-plugin-market', 'snapshots', profile)
  let files: string[]
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse()
  } catch {
    return undefined
  }
  if (files.length === 0) return undefined
  return JSON.parse(readFileSync(join(dir, files[0]), 'utf8')) as ProfileSnapshot
}

export function restoreSnapshot(dshHome: string, profile: string, snapshot: ProfileSnapshot): string {
  const profileDir = join(dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  if (!pkg.dsh) pkg.dsh = {}
  if (!pkg.dsh.profile) pkg.dsh.profile = {}
  pkg.dsh.profile.bundles = snapshot.bundles
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2), 'utf8')
  return `restored bundles=${snapshot.bundles.length}`
}
```

* [x] **Step 4: 运行测试确认通过**

真实 Run: `pnpm exec vitest run tests/plugin-recovery-restore.test.ts`
Expected: PASS（3 个用例）

* [x] **Step 5: 改 proposeRecovery 接入回滚阶梯**

在 `src/main.ts` 的 `proposeRecovery`（`main.ts:1678`）中、`culprit.kind === 'unresolvable'` 分支之前插入新 rung：

先补齐 import（main.ts:14 的 node:fs 行无需加 `readdirSync`；只需在 npm 导入块后新增本地导入）：

```ts
import { latestSnapshot, restoreSnapshot } from './plugin-recovery-restore.js'
```

新增 rung 代码：

```ts
  if (!tried.has('snapshot') && culprit !== undefined && attempt >= 2) {
    tried.add('snapshot')
    const snapshot = latestSnapshot(dshHome(), 'web')
    if (snapshot !== undefined) {
      const approved = await confirmRecovery({
        title: '启动失败',
        message: '检测到插件安装前的备份快照，是否回滚到最后一次良好状态？',
        detail: '回滚将把 profile 的插件 bundles 恢复到最近一次安装操作之前的状态。',
        confirm: '回滚并重试',
      })
      if (!approved) return false
      const hint = restoreSnapshot(dshHome(), 'web', snapshot)
      appendFileSync(logFile(), `\n=== safe mode: rolled back to snapshot ${snapshot.id} (${hint}) ===\n`)
      recordRecoveryAction(safeModeStateFile(), { type: 'snapshot-restore', id: snapshot.id })
      return true
    }
  }
```

* [x] **Step 6: 沙箱语法验证 + 真实类型检查**

沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check src/plugin-recovery-restore.ts`（TS 语法基本检查）
真实 Run: `pnpm build && pnpm exec vitest run tests/plugin-recovery-restore.test.ts`
Expected: 无类型错误；测试 PASS

* [x] **Step 7: 提交**

```bash
git add src/main.ts src/plugin-recovery-restore.ts tests/plugin-recovery-restore.test.ts
git commit -m "feat(safe-mode): roll back to latest plugin snapshot before remove-bundle"
```

***

### Task 1.4: 托盘「回滚到上次良好状态」手动入口

**Files:**

* Modify: `src/main.ts`（`createTray` 菜单加一项；`restorePluginsAndRelaunch` 旁新增 restorer）

* [x] **Step 1: 加菜单项**

在 `createTray`（`main.ts:1199`）上下文菜单追加：

```ts
{ label: isZhLocale() ? '回滚到上次良好状态' : 'Restore last good state', click: () => void restoreLastGoodAndRelaunch() },
```

* [x] **Step 2: 实现** **`restoreLastGoodAndRelaunch`**

在 `restorePluginsAndRelaunch`（`main.ts:1761`）旁新增：

```ts
async function restoreLastGoodAndRelaunch(): Promise<void> {
  const snap = latestSnapshot(dshHome(), 'web')
  if (!snap) {
    await dialog.showMessageBox({ type: 'info', message: isZhLocale() ? '没有可用的备份快照。' : 'No snapshot available.' })
    return
  }
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: isZhLocale() ? '回滚快照' : 'Restore snapshot',
    message: isZhLocale() ? `回滚到 ${snap.exportedAt} 的状态？` : `Restore to ${snap.exportedAt}?`,
    buttons: [isZhLocale() ? '回滚并重启' : 'Restore & Relaunch', isZhLocale() ? '取消' : 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response !== 0) return
  restoreSnapshot(dshHome(), 'web', snap)
  appendFileSync(logFile(), `\n=== safe mode: manual snapshot restore ${snap.id} from tray ===\n`)
  quitting = true
  tray?.destroy()
  if (dshChild && dshChild.exitCode === null) dshChild.kill()
  app.relaunch()
  app.exit(0)
}
```

* [x] **Step 3: 沙箱语法验证 + 真实类型检查**

沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check src/main.ts`
真实 Run: `pnpm build`
Expected: 无错误

* [x] **Step 4: 提交**

```bash
git add src/main.ts
git commit -m "feat(tray): manual restore-last-good-snapshot entry"
```

***

# Phase 2：dsh 0.1.2-alpha 升级 + 启用 preset-transfer

## 目标与背景

当前锁定 `@deepseek-ai/dsh@0.1.1-rc.2`；npm dist-tags 显示 `alpha: 0.1.2-alpha.2`（已核实存在）。0.1.2-alpha 引入 `connection.fetch` 注册表与 `agentPresets` 服务，是 `dsh-desktop-preset-transfer` 插件的运行前提（该插件 8-30 已移植待启用）。本 Phase：升级依赖、验证新 API、把插件加入 PRESET\_PLUGINS、端到端验证 .dshpreset 导入导出。

## 文件结构

* `package.json` — dsh 及各 @deepseek-ai/\* 依赖升到 0.1.2-alpha 对应版（Modify）

* `scripts/sync-upstream.mjs` — 若升级脚本需要适配 alpha（Modify，谨慎——AGENTS.md 约束：除非确实需要）

* `src/main.ts` — PRESET\_PLUGINS 加 `dsh-desktop-preset-transfer`（Modify）

* `pnpm-lock.yaml` — 真实环境 `pnpm install` 生成（Modify，真实环境）

* `docs/HANDOVER.md` — 记录升级（Modify）

***

### Task 2.1: 提升 package.json 上游版本

* [x] **Step 1: 把 dsh 主依赖指向 alpha**

`package.json`:

```json
"@deepseek-ai/dsh": "0.1.2-alpha.2",
"dsh": { "upstream": "@deepseek-ai/dsh", "upstreamVersion": "0.1.2-alpha.2" }
```

* [x] *Step 2: 全量对齐其他 @deepseek-ai/* 到同代 rc/alpha\*

用脚本核对 npm 实际版本（沙箱 PowerShell）：

```powershell
$k = (Get-Content package.json -Raw | ConvertFrom-Json).dependencies.PSObject.Properties.Name | Where-Object { $_ -like '@deepseek-ai/*' -and $_ -ne '@deepseek-ai/dsh' }
foreach ($p in $k) {
  try { $v = (Invoke-RestMethod -Uri ('https://registry.npmjs.org/' + ($p -replace '/', '%2F')) -TimeoutSec 15).'dist-tags'.alpha; Write-Host "$p -> $v" } catch { Write-Host "$p -> (alpha missing)" }
}
```

对每个 `alpha` 存在的包，把 package.json 中版本改为 `^<alpha版本>`；alpha 缺失的保留 rc 版本并在 HANDOVER 记录。

* [x] **Step 3: 真实环境刷新锁文件并构建**

真实 Run: `pnpm install && pnpm build && pnpm test`
Expected: 全绿

* [x] **Step 4: 冒烟启动 + 提交**

真实 Run: `node dist/main.js`（用全新 userData 临时目录）→ 窗口弹出、dsh web 在随机/3080 端口 200、无安全模式触发。

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(dsh): upgrade @deepseek-ai/dsh to 0.1.2-alpha.2"
```

***

### Task 2.2: 验证 0.1.2-alpha 新 API 可用（connection + agentPresets）

**Files:**

* Create: `scripts/verify-alpha-api.mjs`（临时验证脚本，验证后保留）

* [x] **Step 1: 写验证脚本**

```js
// scripts/verify-alpha-api.mjs
// 0.1.2-alpha 升级后验证：connection.fetch 注册表 + agentPresets 服务可解析。
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const pin = pkg.dsh?.upstreamVersion ?? ''
const checks = {
  pinAtLeastAlpha: /^0\.1\.2-alpha/.test(pin),
  hasAgentPresetsDep: Object.keys(pkg.dependencies).some((k) => k.includes('dsh-agent-presets')),
  hasClientConnection: Object.keys(pkg.dependencies).some((k) => k.includes('dsh-client-connection')),
  presetsOnNpm: false,
}
const r = spawnSync(process.execPath, ['-e', `
  fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh-agent-presets')
    .then((res) => res.json())
    .then((j) => console.log(JSON.stringify(j['dist-tags'])))
    .catch(() => process.exit(1))
`], { encoding: 'utf8', timeout: 30000 })
if (r.status === 0) checks.presetsOnNpm = true

console.log(JSON.stringify(checks, null, 2))
if (!checks.pinAtLeastAlpha) { console.error('FAIL: dsh not on 0.1.2-alpha'); process.exit(1) }
console.log('OK if all keys true (注: peer-only 依赖由 sync-upstream detectPeerOnlyRuntimeDeps 提升)')
```

* [x] **Step 2: 真实环境运行**

真实 Run: `node scripts/verify-alpha-api.mjs`
Expected: `pinAtLeastAlpha: true`；若 `hasAgentPresetsDep/hasClientConnection` 为 false，则交给 Task 2.3 的 peer-only 提升处理（正常现象）。

* [x] **Step 3: 提交**

```bash
git add scripts/verify-alpha-api.mjs
git commit -m "chore(scripts): verify 0.1.2-alpha API readiness"
```

***

### Task 2.3: 启用 preset-transfer 插件

* [x] **Step 1: PRESET\_PLUGINS 加入插件**

`src/main.ts`（`main.ts:242`）:

```ts
const PRESET_PLUGINS = ['dshmarket', 'dsh-plugin-market', 'dsh-plugin-version-manager', 'dsh-shell-control', 'dsh-desktop-preset-transfer']
```

同时删除先前「deliberately NOT presetted yet」的注释段落（注释保留一句历史说明即可：`// dsh-desktop-preset-transfer 自 0.1.2-alpha 启用（依赖 connection 注入）`）。

* [x] **Step 2: 验证 preset-transfer 的 peer 依赖解析**

真实 Run: `pnpm install`（确保 `@deepseek-ai/dsh-agent-presets` 与 `fflate` 在 hoisted node\_modules 可解析）
真实 Run: `pnpm build && pnpm test`

* [x] **Step 3: 端到端验证 .dshpreset 导出**

真实环境、全新 userData 下启动后，用 PowerShell 调 API：

```powershell
$id = 'default'   # 走 agentPresets.resolve 的可用 preset id（以实际 profile 为准）
$r = Invoke-WebRequest -Uri "http://127.0.0.1:3080/api/agent-preset.export?agentPreset=$id" -UseBasicParsing
$r.StatusCode   # 期望 200；若 preset 为 built-in 则 403（属预期，见插件语义）
```

* [x] **Step 4: 提交**

```bash
git add src/main.ts
git commit -m "feat(preset): enable dsh-desktop-preset-transfer on 0.1.2-alpha"
```

***

### Task 2.4: 更新 sync-upstream 对 alpha 的支持（按需）

* [x] **Step 1: 评估脚本行为**

真实 Run: `node scripts/sync-upstream.mjs --dry-run`
检查：`upstreamLatest()`（`sync-upstream.mjs:52`）能否在 dist-tags 包含 alpha 时选出正确目标；`nextVersion`（`:129`）对 `0.1.2-alpha.2` 的 stamp 生成是否符合 `0.1.2-alpha.2.<build>` 格式。

* [x] **Step 2: 若格式不对则在** **`nextVersion`** **适配 alpha**

以实际运行输出为准修正；改动必须小且保持「dsh 走官方、不自动采用 GitHub-only prerelease」语义不变。

* [x] **Step 3: 提交**

```bash
git add scripts/sync-upstream.mjs
git commit -m "fix(sync): support alpha dist-tags in upstream detection"
```

***

# Phase 3：CI 测试门 + 平台架构校验

## 目标与背景

dataelement 有 `npm test`+`typecheck` 质量门与平台架构校验（防止「看似打包成功实则缺 native 依赖」的假产物）。我们 CI 只有 `pnpm run build` + smoke。本 Phase：为 sync-and-release 的 build job 增加 vitest 测试门，并新增架构校验脚本。

## 文件结构

* `.github/workflows/sync-and-release.yml` — build job 加 `pnpm test` + 架构校验（Modify）

* `scripts/check-platform-arch.mjs` — 平台/架构 native 依赖校验（Create）

* `scripts/ci-smoke.mjs` — 保持不变（已存在）

***

### Task 3.1: 平台架构校验脚本

* [x] **Step 1: 创建** **`scripts/check-platform-arch.mjs`**

```js
// scripts/check-platform-arch.mjs
// 校验当前平台/架构与原生依赖（node_modules 中 .node 模块）匹配，
// 防止在错误的 runner 上产出「成功但不可用」的安装包。
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NM = join(ROOT, 'node_modules')
const expected = `${process.platform}-${process.arch}`
let nativeCount = 0
let mismatch = []

function walk(dir) {
  let entries = []
  try { entries = readdirSync(dir) } catch { return }
  for (const name of entries) {
    if (name === '.bin' || name === '.pnpm' || name === '@types') continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) { if (name !== 'node_modules') walk(full) }
    else if (name.endsWith('.node')) { nativeCount++; try { spawnSync(process.execPath, ['-e', `require(${JSON.stringify(full)})`], { stdio: 'ignore' }); } catch { mismatch.push(full) } }
  }
}
walk(NM)
console.log(`platform=${process.platform} arch=${process.arch} expected=${expected} native_modules=${nativeCount} failed_to_load=${mismatch.length}`)
if (mismatch.length > 0) { console.error('NATIVE MISMATCH:\n' + mismatch.join('\n')); process.exit(1) }
```

> **实现偏差（自审修正）**：朴素实现（对 node\_modules 中每个 `.node` 独立 `require`）在本机立即误报 15 个非宿主平台的预编译包（node-pty `prebuilds/`、`@electron-internal/extract-zip` 多架构二进制、rollup native 加速器），会让 CI 门误伤。已将探测范围收敛到 **package.json** **`dependencies`** **的包入口**（对齐应用实际加载面），跳过后 `rollup`、`electron` 等 dev/传递依赖与本地 `plugins/` 工作区插件。实测 `deps=39 probed=37 failed_to_load=0` exit 0。验证：真实 linux runner `node scripts/check-platform-arch.mjs` 预期 `failed_to_load=0`、exit 0。已覆盖（32 个 dsh 运行时依赖 + 工具链均在 win32/x64 下可加载）。

* [x] **Step 2: 冒烟运行**

真实（linux runner）Run: `node scripts/check-platform-arch.mjs`
Expected: `failed_to_load=0`、exit 0

* [x] **Step 3: 提交**

```bash
git add scripts/check-platform-arch.mjs
git commit -m "feat(ci): platform/arch native-module validation script"
```

***

### Task 3.2: CI 加测试门 + 架构校验 step

**Files:**

* Modify: `.github/workflows/sync-and-release.yml`

* [x] **Step 1: build job 在** **`pnpm run build`** **后加测试**

在 `- run: pnpm run build` 之后插入：

```yaml
      - run: pnpm test

      - name: Validate platform native modules
        run: node scripts/check-platform-arch.mjs
```

* [x] **Step 2: 验证 YAML 结构**

沙箱便签：steps 使用 `- run:` 列表项并列，缩进 6 空格（参考第 129-134 行既有 `- run:` 对齐方式）。真实读档核查：
（编辑器打开 `.github/workflows/sync-and-release.yml`，确认新增两行缩进与其前后 `- run` 行一致。）

* [x] **Step 3: 提交**

```bash
git add .github/workflows/sync-and-release.yml
git commit -m "ci: gate build on vitest and native-module check"
```

***

# Phase 4：多 profile 档案隔离（web-desktop）

## 目标与背景

anywhere-labs / EAC 都提供「桌面 profile 与 CLI 隔离、互不干扰」；我们当前固定 `web` profile。本 Phase：实现 `web-desktop` 独立 profile，与默认 `web` profile 并存，可通过启动参数或托盘切换。**边界**：会话/API Key 共享（沿用同一 DSH\_HOME），插件树/pnpm/patch 层隔离。

## 文件结构

* `src/profiles.ts` — profile 清单/激活/切换工具（Create）

* `src/main.ts` — `webProfileDir()` 改为按激活 profile 解析；托盘加切换菜单（Modify）

* `src/plugin-recovery-restore.ts` — 快照按 profile 隔离（Modify，可选）

* `scripts/sync-upstream.mjs` — 不涉及（不动）

***

### Task 4.1: profile 基元

* [x] **Step 1: 创建** **`src/profiles.ts`**

```ts
// src/profiles.ts — 桌面 profile 抽象：独立插件树/补丁/设置，共享会话与凭据。
import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PROFILES = ['web', 'web-desktop'] as const
export type ProfileName = (typeof PROFILES)[number]

const PROFILE_STATE_FILE = () => join(app.getPath('userData'), 'active-profile.json')

export function activeProfile(): ProfileName {
  const override = process.env.DSH_DESKTOP_PROFILE
  if (override && (PROFILES as readonly string[]).includes(override)) return override as ProfileName
  try {
    const raw = JSON.parse(readFileSync(PROFILE_STATE_FILE(), 'utf8')) as { profile?: string }
    if (raw.profile && (PROFILES as readonly string[]).includes(raw.profile)) return raw.profile as ProfileName
  } catch { /* first run */ }
  return 'web'
}

export function setActiveProfile(profile: ProfileName): void {
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(PROFILE_STATE_FILE(), JSON.stringify({ profile }, null, 2), 'utf8')
}

export function profileDir(dshHome: string, profile: ProfileName): string {
  return join(dshHome, 'profiles', profile)
}

/** 首次使用 web-desktop 时，克隆 web 的 package.json + cordis.patch.yml（不含 node_modules 与 sessions）。 */
export function ensureProfileSeed(profile: ProfileName): void {
  if (profile === 'web') return
  const home = join(app.getPath('userData'), 'dsh-home')
  const src = profileDir(home, 'web')
  const dst = profileDir(home, 'web-desktop')
  if (existsSync(dst)) return
  mkdirSync(dst, { recursive: true })
  for (const f of ['package.json', 'cordis.patch.yml']) {
    const s = join(src, f)
    if (existsSync(s)) writeFileSync(join(dst, f), readFileSync(s, 'utf8'), 'utf8')
  }
}
```

* [x] **Step 2: 沙箱语法验证**

沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check src/profiles.ts`（TS 语法基本检查）

* [x] **Step 3: 提交**

```bash
git add src/profiles.ts
git commit -m "feat(profiles): profile primitives for web-desktop isolation"
```

***

### Task 4.2: main.ts 接线（启动用 activeProfile + 托盘切换）

**Files:**

* Modify: `src/main.ts`

* [x] **Step 1: webProfileDir 跟随激活 profile**

将 `webProfileDir()`（`main.ts:102`）改为：

```ts
function webProfileDir(): string {
  return join(dshHome(), 'profiles', activeProfile())
}
```

并在 `boot()`（`main.ts:1777`）开头插入 `ensureProfileSeed(activeProfile())`。

* [x] **Step 2: 托盘加 profile 切换**

在 `createTray` 菜单追加子菜单：

```ts
{
  label: isZhLocale() ? '档案' : 'Profile',
  submenu: PROFILES.map((p) => ({
    label: p,
    type: 'radio' as const,
    checked: p === activeProfile(),
    click: () => {
      if (p === activeProfile()) return
      setActiveProfile(p)
      quitting = true
      tray?.destroy()
      if (dshChild && dshChild.exitCode === null) dshChild.kill()
      app.relaunch()
      app.exit(0)
    },
  })),
},
```

* [x] **Step 3: 沙箱验证 + 真实构建**

沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check src/main.ts`
真实 Run: `pnpm build && pnpm test`

* [x] **Step 4: 提交**

```bash
git add src/main.ts
git commit -m "feat(profiles): boot active profile + tray switcher"
```

> **实现偏差（已落地** **`1d220b7`）**：
>
> 1. `startDsh` 改用 `dsh --profile <name>` 而非 `dsh web`——`dsh web` 是 `--profile web` 的硬编码别名（bin.js:94），自定义 profile 只能走 `--profile`。
> 2. preset marker 改为按 profile 隔离（`.bundled-plugins-preset-<name>`），两个 profile 各自首次 preset。
> 3. 插件面同步 profile 化：market.js `RUNTIME.profile` 读 `DSH_DESKTOP_PROFILE`（由 main.ts 子进程 env 注入），index.js 全部 8 处硬编码 `'web'` 改为 `PROFILE_DEFAULT`；main.ts 的 `latestSnapshot`/`restoreSnapshot` 全部改 `activeProfile()`。
> 4. `dsh --profile web-desktop` 首次运行前由 `ensureProfileSeed` 克隆 web 的 package.json + cordis.patch.yml（会话/凭据共享同一 DSH\_HOME，插件树隔离）。

***

# Phase 5：会话内终端

## 目标与背景

EAC/anywhere-labs 提供项目目录内持久终端（SSE 流式、断线重连）。我们已有 shell-control（127.0.0.1:3177+/api/shell/\*，`src/shell-control.ts`）与 `@deepseek-ai/dsh-shell` 依赖。本 Phase：新建 `plugins/dsh-terminal` 插件，host 面复用 shell-control 或独立 loopback 服务，client 面注入侧边栏终端面板（同源代理）。

## 文件结构

* `plugins/dsh-terminal/package.json` — 插件清单（Create）

* `plugins/dsh-terminal/cordis.patch.yml` — host 注入 webserver（Create）

* `plugins/dsh-terminal/lib/index.js` — `/api/terminal/exec`（Create）

* `plugins/dsh-terminal/lib/client.js` — 侧边栏终端 UI（Create）

* `package.json` — 根依赖加 `dsh-terminal: file:plugins/dsh-terminal`（Modify）

***

### Task 5.1: host 面 exec 路由

* [x] **Step 1: 创建插件骨架**

`plugins/dsh-terminal/package.json`:

```json
{
  "name": "dsh-terminal",
  "description": "DSH Desktop 会话内终端：项目目录持久 shell，SSE 流式输出。",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "lib/index.js",
  "exports": { ".": { "default": "./lib/index.js" } },
  "files": ["lib", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "license": "MIT"
}
```

`plugins/dsh-terminal/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-terminal
      name: dsh-terminal
      inject: [webServer, tools]
```

* [x] **Step 2: 写 host exec（SSE）**

`plugins/dsh-terminal/lib/index.js`:

```js
// dsh-terminal · host 面
// 注册 /api/terminal/exec：在本机项目目录起持久 shell 子进程，SSE 推流 stderr/stdout。
import { spawn } from 'node:child_process'

export const name = 'dsh-terminal'
export const inject = ['webServer']

const WRITES_BLOCKED = new WeakSet()

export function apply(ctx) {
  const webServer = ctx.webServer
  if (!webServer?.router) return
  webServer.router.get('/api/terminal/exec', async (ctxReq) => {
    const url = new URL(ctxReq.url)
    const cwd = url.searchParams.get('cwd') || process.env.DSH_HOME || process.cwd()
    const req = ctxReq.req
    const res = ctxReq.res

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write('event: ready\ndata: {}\n\n')

    let shellBin = process.platform === 'win32' ? 'powershell.exe' : 'bash'
    let args = process.platform === 'win32' ? ['-NoProfile', '-Command', '-'] : ['-c', 'exec bash']
    const child = spawn(shellBin, args, { cwd, env: process.env })
    child.stdout?.on('data', (d) => res.write(`event: out\ndata: ${JSON.stringify(d.toString())}\n\n`))
    child.stderr?.on('data', (d) => res.write(`event: err\ndata: ${JSON.stringify(d.toString())}\n\n`))
    child.on('close', (code) => { res.write(`event: exit\ndata: ${JSON.stringify({ code })}\n\n`); res.end() })

    req.on('data', (chunk) => { if (!WRITES_BLOCKED.has(child)) child.stdin?.write(chunk) })
    req.on('close', () => { try { child.kill() } catch {} })
    return
  })
}
```

> 说明：约定 `[stdout]`/`[stderr]` 走 SSE `out`/`err` 事件；浏览器端 fetch streaming reader 消费。注入 tools 声明保留（未来可让 AI 发起终端命令），本任务只实现 exec。

* [x] **Step 3: 沙箱语法验证**

沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check plugins/dsh-terminal/lib/index.js`

* [x] **Step 4: 提交**

```bash
git add plugins/dsh-terminal/package.json plugins/dsh-terminal/cordis.patch.yml plugins/dsh-terminal/lib/index.js
git commit -m "feat(terminal): host SSE exec for session terminal"
```

***

### Task 5.2: client 侧边栏终端面板

**Files:**

* Create: `plugins/dsh-terminal/lib/client.js`

* Modify: `package.json`（根依赖加 `dsh-terminal: file:`）

> 参照现有 client 范式（`plugins/dsh-plugin-version-manager/lib/client.js`）：`window.__ModuleLoader__.load({ id, factory })`，工厂里 `require('react')` / `require('@deepseek-ai/dsh-client-ui-primitives')`，UI 经 `ctx.slots.inject('sidebar.footer.action', ...)` 注入。终端面板用 SSE 消费 `/api/terminal/exec`，命令输入走同一流（服务端 child.stdin）。

* [x] **Step 1: 创建 client 面板**

Create: `plugins/dsh-terminal/lib/client.js`

```js
// dsh-terminal · client 面（纯 JS，无 JSX，对齐 version-manager 的 client 范式）
window.__ModuleLoader__.load({
  id: "dsh-terminal",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var React = require("react");
    var { useState, useEffect, useRef } = React;
    var { Button } = require("@deepseek-ai/dsh-client-ui-primitives");

    var NS = "terminal";
    var zh = { open: "终端", placeholder: "输入命令，Enter 执行；Ctrl+C 中断", running: "运行中", exit: "已退出" };
    var en = Object.assign({}, zh, { open: "Terminal", placeholder: "Type a command; Enter to run, Ctrl+C to interrupt", running: "running", exit: "exited" });

    function TerminalPanel(props) {
      var t = props.t;
      var [lines, setLines] = useState([]);
      var [cmd, setCmd] = useState("");
      var [phase, setPhase] = useState("idle");
      var ref = useRef(null);

      function run() {
        if (!cmd.trim() || phase === "running") return;
        var cwd = props.cwd || "";
        setLines([]);
        setPhase("running");
        var es = new EventSource("/api/terminal/exec?cwd=" + encodeURIComponent(cwd));
        es.addEventListener("out", (e) => setLines((l) => [...l, e.data]));
        es.addEventListener("err", (e) => setLines((l) => [...l, "[err] " + e.data]));
        es.addEventListener("exit", (e) => { setPhase("idle"); es.close(); });
        ref.current = es;
      }
      function interrupt() { ref.current && ref.current.close(); setPhase("idle"); }
      useEffect(() => () => { ref.current && ref.current.close(); }, []);

      return React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } },
        React.createElement("pre", { style: { height: 240, overflow: "auto", background: "var(--dsw-color-surface-2, #111)", color: "#eee", padding: 8, whiteSpace: "pre-wrap" } },
          lines.join("\n") || (phase === "running" ? t(NS + ".running") : t(NS + ".exit"))),
        React.createElement("div", { style: { display: "flex", gap: 8 } },
          React.createElement("input", {
            value: cmd, onChange: (e) => setCmd(e.target.value), onKeyDown: (e) => e.key === "Enter" && run(),
            placeholder: t(NS + ".placeholder"), style: { flex: 1 },
          }),
          React.createElement(Button, { onClick: phase === "running" ? interrupt : run }, phase === "running" ? "Ctrl+C" : "Run")))
    }

    return {
      apply(ctx) {
        ctx.slots.inject("sidebar.footer.action", (props) =>
          ctx.slots.register(() => React.createElement(TerminalPanel, { cwd: props.workspacePath, t: props.t })))
      },
      dispose() {}
    };
  }
})
```

> 说明：`sidebar.footer.action` slot 与 `props.workspacePath`/`props.t` 以 version-manager client 实际注入点为准（执行时对照其 client.js 尾部 apply 段）；若 slot 名不同，改用与 version-manager 相同的注册方式。输入行通过同源 fetch 复用同一 SSE 流（服务端已把 req data 转发到 child.stdin），此处 EventSource 只读输出；命令行的双向通道由 host `/api/terminal/exec` 的 req 流承担——本面板先以「运行固定命令 → 展示输出」最小闭环落地，双向输入由 host 侧预留的 req 流支持，UI 在后续迭代补 `fetch POST` 写 stdin。

* [x] **Step 2: 接线 package.json**

根 `package.json` dependencies 加：

```json
"dsh-terminal": "file:plugins/dsh-terminal"
```

真实 Run: `pnpm install`

* [x] **Step 3: 逻辑验证**

沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check plugins/dsh-terminal/lib/client.js`
真实 Run: `pnpm build && pnpm test`

* [x] **Step 4: 提交**

```bash
git add plugins/dsh-terminal/lib/client.js package.json
git commit -m "feat(terminal): sidebar terminal panel (client)"
```

> **实现偏差（已落地** **`cb531de`）**：
>
> 1. host 面不用 `webServer.router.get`（该 API 不存在），按 version-manager 范式走 `ctx.webServer.register(route(path, handler))` + `ctx.effect`  disposer。
> 2. 终端是**单实例持久交互 shell**（懒启动）：`GET /api/terminal/stream` SSE 广播 out/err/exit（含 128 帧重放环，重连不丢尾部）、`POST /api/terminal/input` 写 stdin、`POST /api/terminal/kill` 重置。win32 用 `powershell -NoLogo -NoProfile`，posix 用 `bash -i`。
> 3. client 面不用 EventSource 发命令（GET 只读），命令行走 `POST /api/terminal/input`；SSE 用 EventSource（自动重连 + retry:2000）。不依赖 `workspacePath` slot prop（sidebar 只传 `{ wide, t }`），shell 在 dsh 进程 cwd 启动、终端内可 `cd`。
> 4. 未用 `StateDot`（其 props API 无法在根 node\_modules 验证），改纯 CSS 状态点。
> 5. 新增 `plugins/dsh-terminal/test/terminal.test.js`（node:test 集成测试：真实 http server + 真 shell，验证 SSE 回环/重放/kill，2 用例全绿）。根依赖 `dsh-terminal: file:plugins/dsh-terminal` + PRESET\_PLUGINS 追加。

***

# Phase 6：主题内置 + 余额/通知 + 自动压缩

## 目标与背景

P2 生态增强：市场已有 `themeCatalog`/`switchTheme`（`market.js:1308`），缺「随安装包内置几款皮肤」；EAC 有余额小部件与任务完成通知；自动压缩 `/compact` 是 EAC 高频功能。本 Phase 三项独立小任务，各可独立合入。

***

### Task 6.1: 内置 2 款 BSD 皮肤 + 皮肤面板注记

* [x] **Step 1: 确认皮肤来源与许可**

真实 Run: 检查 `themeCatalog`（`market.js:1308`）返回结构，确认皮肤为 browser-only client 插件。
候选来源（社区仓库，BSD-3-Clause）：[dsh-web-ui](https://github.com/zhu1090093659/dsh-web-ui)（EAC 引用的来源）。**务必核对 getPluginReadme 与 license 字段后再合入。**

* [x] **Step 2: 在市场 README/UI 注明皮肤版权署名**

在 `plugins/dsh-plugin-market` 的 UI 文案（`lib/index.js` 注入的 tab 或 market README）加一行许可说明，例如：

```json
{ "id": "theme-xp", "name": "XP 风格", "license": "BSD-3-Clause", "credit": "dsh-web-ui" }
```

（实际 skin 清单以 themeCatalog 为准；任务结果 = 皮肤在设置页可一键切换 + 版权署名可见。）

* [x] **Step 3: 提交**

```bash
git add plugins/dsh-plugin-market
git commit -m "feat(market): bundled theme attribution panel"
```

> **实现偏差（已落地** **`5e88f16`**）\*\*：
>
> 1. 候选来源 dsh-web-ui 是 GitHub 仓库而非 npm 包，无法随安装包预置；真实 npm 调研改为 **`dsh-theme`（npm, Apache-2.0, 30 款主题包, 零依赖）**，加入 `OFFICIAL_CATALOG`（`category='主题与外观'`, `builtin: true`）。`themeCatalog()` 重写：把 OFFICIAL\_CATALOG 的主题条目映射成与社区条目同构对象（`community: false, builtin: true`）后无条件并入面板，不依赖社区目录拉取；仍保留「注入 `@deepseek-ai/dsh-client-ui-theme` 才是真主题」过滤。
> 2. 版权署名以 i18n 键 `themeCredit`（zh/en 双语）注入主题面板底部注脚，紧邻 `themeHint`；无独立 README 文件（面板注记即可见）。
> 3. 顺带修复 market.js 主题链 7 处遗留硬编码 `'web'` → `RUNTIME.profile`（PATCH\_FILE、themeCatalog 的 readInstalled/theme 检查、ensureBundleable profileDir、setThemeBundleDisabled/readThemeBundleDisabled patchFile），与 Phase 4 profile 化对齐。

***

### Task 6.2: 会话完成系统通知

**Files:**

* Create: `src/session-notifier.ts`

* Modify: `src/main.ts`（勾住 dsh 子进程输出中的会话完成信号）

* [x] **Step 1: 创建 notifier**

```ts
// src/session-notifier.ts — agent 任务完成时弹系统通知，点击回到主窗口。
import { Notification, type BrowserWindow } from 'electron'

export function notifySessionDone(win: BrowserWindow | undefined, title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body })
  n.on('click', () => { if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus() } })
  n.show()
}
```

* [x] **Step 2: 接线 main.ts**

在 `startDsh`（`main.ts:568`）子进程 stdout/stderr 的 chunk 处理处，检测会话完成标志（上游会输出如 `[complete]` / `session finished` 之类标记；以 0.1.2-alpha 实际日志关键字为准）并调用 `notifySessionDone`。检测规则集中为一个函数 `isSessionDoneChunk(chunk: string): boolean`（写入 `session-notifier.ts` 一并导出）。

* [x] **Step 3: 沙箱验证 + 提交**

沙箱 Run: `& 'C:\Program Files\nodejs\node.exe' --check src/session-notifier.ts`
真实 Run: `pnpm build`

```bash
git add src/session-notifier.ts src/main.ts
git commit -m "feat(notification): system notification on session completion"
```

> **实现偏差（已落地** **`5e88f16`**）\*\*：
>
> 1. 上游 dsh 0.1.2-alpha 无 stdout 完成标记（对上游产物 grep 实测无 `[complete]`/`session finished` 等），放弃 chunk 关键字方案；改为复用「会话文件 mtime 活跃窗口」探测（与 market.js `isAgentRunning` 同款逻辑）：轮询 `$DSH_HOME/sessions/**/session-*/session.*` 的 mtime，最近活跃后进入静默窗口即判为完成。探测集中为 `scanLatestSession()` + `createSessionNotifier()`（基线快照抑制启动误报 + `lastNotifiedId` 同一会话只通知一次）。
> 2. main.ts 接线改为启动即建轮询器（`startSessionNotifier()`，boot 成功后启动、`will-quit` 停止），通知点击聚焦主窗口；不挂在子进程 chunk 回调上。
> 3. 新增 `tests/session-notifier.test.ts`（注入时钟 + 真实 setTimeout 驱动轮询，2 用例：scanLatestSession 取最新写入；静默窗口后触发一次且新会话再触发）全绿。
> 4. 期间发现并修复 main.ts 的 `Notification` 导入缺失（此前 SearchReplace 未真正写入），补回 electron 导入后 tsc 全绿。

***

### Task 6.3: 自动压缩（/compact 预置）

* [x] **Step 1: 评估复用官方/社区方案**

官方体系有 `@deepseek-ai/dsh-compaction`（已在依赖）。EAC 的 `dsh-auto-compact` 社区插件（BSD/MIT 待核）。真实 Run 检查：

```bash
pnpm view dsh-auto-compact 2>/dev/null || echo "not on npm"
```

若在 npm，直接 `dsh plugin add dsh-auto-compact` 预置；否则不内置，记录到 HANDOVER「生态待装清单」。（**不臆造社区包名，以 npm 查询结果为准。**）

* [x] **Step 2: 若可预置，加入 PRESET\_PLUGINS**

`src/main.ts` PRESET\_PLUGINS 数组按查询结果追加；若包不存在则跳过此步骤并在 HANDOVER 记录。

* [x] **Step 3: 提交（按实际结果）**

```bash
git add src/main.ts package.json
git commit -m "feat(plugins): preset auto-compact (if npm package resolves)"
```

> **实现偏差（已落地** **`5e88f16`**）\*\*：
>
> 1. **`dsh-auto-compact`** **不在 npm（registry 404）**，不预置、不加 PRESET\_PLUGINS；已在 docs/HANDOVER.md「生态待装清单」记录。
> 2. 真实调研确认 **`@xiaobanli/dsh-compact-after-task`（npm, MIT, 0.1.1, 零依赖）** 存在且可装；作为替代加入 `OFFICIAL_CATALOG`（`category='性能优化'`, `builtin: true, bundle: true`），用户可在市场一键安装（复用 `submitOp("install")` 链路），不做默认预置以遵循「官方 npm 包不 fork、不臆造包名」原则。
> 3. 候选包也一并核过：dsh-theme-kit（MIT 0.1.2）/ dsh-theme-plugin（MIT 0.3.3）存在；dsh-theme-center（BSD, inject `[]` 非真主题）不合用；`@deepseek-ai/dsh-compaction-basic` 宿主为空不可预置。

> **补充（余额，已落地** **`0426d84`**）\*\*：
>
> P6 标题/背景宣称「余额/通知」，但原 Task 6.1–6.3 没有余额对应物。补记为独立小任务：真实 npm 调研发现 dsh 生态已有成熟的余额小部件（`dsh-api-balance` MIT 0 依赖 — host 查官方 balance + 悬浮徽章/总余额/今日 token/本月/缓存命中环形图；`dsh-balance-monitor` MIT 0 依赖 — 余额监控 + 注入设置页；`dsh-cost-meter` MIT 3 依赖 — 会话/当日费用 + 余额 + 预算框 + 峰谷计价）。按「官方不 fork、不臆造」原则不重复造轮子：把 `dsh-api-balance` + `dsh-cost-meter` 两个代表条目加入 `OFFICIAL_CATALOG`（`category='用量与账单'`, `builtin: true, bundle: true`），填充此前一直空置的 usage 分类，用户市场一键安装（走 `/api/market/op` install → `dsh plugin add` 链路，与 compact-after-task 同构）。余额数据源为 DeepSeek 官方 balance 接口 + 本地记账，密钥留在 host 侧不进前端（插件自处理）。

***

# Phase 7：评估项（不做实现，产出决策记录）

以下三项受外部资源/架构决策约束，本计划只产出评估结论并更新 HANDOVER，不进入主链：

**7.1 macOS 代码签名 + notarized**：dataelement 已做；需 Apple Developer 证书（99$/年）与 CI secrets 配置。产出：HANDOVER 记录「需预算与账号」。
**7.2 Tauri 体积优化评估**：dsh-tauri-desk（5MB）/ xtxo（8.7MB Pake）路线是架构级替换（Electron → Tauri），与现有 plugin-market/shell-control 的 Electron API 深度耦合，短期不迁移。产出：未来路线 DOD 记录。
**7.3 手机远程控制**：anywhere-labs（iOS/Android 客户端）是独立客户端工作，超出本仓库范围；我们已具备 external-tools（manager/store）基础设施，可在后续独立计划中评估服务端准备。产出：HANDOVER 记录「独立子项目」。

***

## 自审结论（覆盖对照）

| 差距               | 任务            |
| ---------------- | ------------- |
| P0 插件保护闭环        | T1.1–T1.4     |
| P0 .dshpreset 启用 | T2.1–T2.4     |
| P1 CI 测试门+架构校验   | T3.1–T3.2     |
| P1 多 profile 隔离  | T4.1–T4.2     |
| P1 会话内终端         | T5.1–T5.2     |
| P2 主题/余额/通知/自动压缩 | T6.1–T6.3     |
| P2 签名/体积/手机远程    | Phase 7（评估记录） |

