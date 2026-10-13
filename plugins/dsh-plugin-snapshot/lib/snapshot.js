// dsh-plugin-snapshot · 快照读写核心（纯文件操作，不碰 node_modules）
//
// 格式必须与宿主读取方 src/plugin-recovery-restore.ts 完全一致，否则写了也读不到：
//   目录  <dshHome>/storages/dsh-plugin-market/snapshots/<profile>/*.json
//   内容  { id, exportedAt, profile, bundles: string[], dependencies: {}, disabled: string[] }
// 读取方是 readdirSync().filter(.json).sort().reverse() 取第一个，所以文件名必须
// 定宽、字典序 == 时间序，且不含 Windows 非法字符（ISO 的冒号换成短横）。
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** 宿主读取方的目录；写侧必须落在同一个地方。 */
export function snapshotDir(dshHome, profile) {
  return join(dshHome, 'storages', 'dsh-plugin-market', 'snapshots', profile)
}

/** 保留多少份：回滚要的是"最近一次良好状态"，留太多只是占地方。 */
export const MAX_SNAPSHOTS = 20

/** 文件名即排序键：定宽 ISO（冒号/点换成短横），字典序 == 时间序。 */
export function snapshotId(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-')
}

/** 把 snapshotId 反解回毫秒；认不出来返回 NaN。 */
export function snapshotIdToTime(id) {
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(String(id ?? ''))
  if (!parts) return Number.NaN
  return Date.parse(`${parts[1]}T${parts[2]}:${parts[3]}:${parts[4]}.${parts[5]}Z`)
}

/** profile 的 package.json 里恢复流程关心的那三样。 */
export function readProfileState(profileDir) {
  const pkg = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  const bundles = Array.isArray(pkg?.dsh?.profile?.bundles)
    ? pkg.dsh.profile.bundles.filter((x) => typeof x === 'string' && x !== '')
    : []
  const dependencies = pkg?.dependencies && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)
    ? Object.fromEntries(Object.entries(pkg.dependencies).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'))
    : {}
  return { bundles, dependencies, disabled: readDisabledIds(join(profileDir, 'cordis.patch.yml')) }
}

/**
 * 补丁层里被停用的条目。壳写出来的形状是（src/safe-mode.ts disableEntry）：
 *   - id: <entryId>
 *     disabled: true
 * 只认 disabled: true；insert 块里那些 disabled: false 不算停用。
 */
export function readDisabledIds(patchPath) {
  if (!existsSync(patchPath)) return []
  const disabled = []
  let current = null
  for (const raw of readFileSync(patchPath, 'utf8').split('\n')) {
    const line = raw.replace(/\r$/, '')
    const id = /^- id:\s*(\S+)\s*$/.exec(line)
    if (id) {
      current = id[1]
      continue
    }
    if (current !== null && /^\s+disabled:\s*true\s*$/.test(line)) {
      if (!disabled.includes(current)) disabled.push(current)
      continue
    }
    if (/^- /.test(line)) current = null
  }
  return disabled
}

/** 组一份快照（字段顺序与壳的 ProfileSnapshot 一致）。 */
export function buildSnapshot({ profileDir, profile, reason, now = new Date() }) {
  const state = readProfileState(profileDir)
  return {
    id: snapshotId(now),
    exportedAt: now.toISOString(),
    profile,
    bundles: state.bundles,
    dependencies: state.dependencies,
    disabled: state.disabled,
    ...(reason ? { reason } : {}),
  }
}

/**
 * 写一份快照。同一毫秒内重复调用时把时间往后挪 1 毫秒而不是加后缀：
 * 后缀（`-1`）在字典序里排在裸名之前（'-' 比 '.' 小），会把"最新那份"的取法弄乱，
 * 所以保持 id 与文件名一一对应、顺序严格单调。
 */
export function writeSnapshot(snapshot, dir) {
  mkdirSync(dir, { recursive: true })
  const fromId = snapshotIdToTime(snapshot?.id)
  let at = Number.isFinite(fromId) ? fromId : Date.now()
  let id = Number.isFinite(fromId) ? snapshot.id : snapshotId(new Date(at))
  for (let guard = 0; guard < 5000 && existsSync(join(dir, `${id}.json`)); guard += 1) {
    at += 1
    id = snapshotId(new Date(at))
  }
  const stored = { ...snapshot, id, exportedAt: new Date(at).toISOString() }
  const file = `${id}.json`
  const path = join(dir, file)
  writeFileSync(path, JSON.stringify(stored, null, 2), 'utf8')
  return { path, file, id }
}

function snapshotFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
}

/** 列出快照（新的在前）。读不出内容的文件跳过而不是整体失败。 */
export function listSnapshots(dir, { limit = 10 } = {}) {
  const files = snapshotFiles(dir)
  const out = []
  for (const file of files.slice(-Math.max(1, limit)).reverse()) {
    try {
      const snap = JSON.parse(readFileSync(join(dir, file), 'utf8'))
      out.push({
        file,
        id: typeof snap?.id === 'string' ? snap.id : file.replace(/\.json$/, ''),
        exportedAt: typeof snap?.exportedAt === 'string' ? snap.exportedAt : null,
        profile: typeof snap?.profile === 'string' ? snap.profile : null,
        reason: typeof snap?.reason === 'string' ? snap.reason : null,
        bundles: Array.isArray(snap?.bundles) ? snap.bundles.length : 0,
        dependencies: snap?.dependencies && typeof snap.dependencies === 'object' ? Object.keys(snap.dependencies).length : 0,
        disabled: Array.isArray(snap?.disabled) ? snap.disabled.length : 0,
      })
    } catch {
      // 坏快照不影响其它快照可用
    }
  }
  return out
}

/** 与壳的 latestSnapshot 同一取法：最新那份完整内容。 */
export function latestSnapshot(dir) {
  const files = snapshotFiles(dir)
  if (files.length === 0) return undefined
  try {
    return JSON.parse(readFileSync(join(dir, files[files.length - 1]), 'utf8'))
  } catch {
    return undefined
  }
}

/** 只留最近 keep 份。 */
export function pruneSnapshots(dir, keep = MAX_SNAPSHOTS) {
  const files = snapshotFiles(dir)
  const excess = files.slice(0, Math.max(0, files.length - keep))
  for (const file of excess) {
    try {
      rmSync(join(dir, file))
    } catch {
      // 删不掉就留着，下次再试；快照多几份不影响正确性
    }
  }
  return excess.length
}

/** 按 id 取一份（id 允许带或不带 .json 后缀；历史遗留的带后缀文件名也认）。 */
export function findSnapshot(dir, id) {
  const wanted = String(id || '').trim()
  if (wanted === '') return undefined
  const base = wanted.replace(/\.json$/, '')
  const matches = snapshotFiles(dir).filter((file) => file === `${base}.json` || file.startsWith(`${base}-`))
  if (matches.length === 0) return undefined
  const file = matches[matches.length - 1]
  try {
    return { file, snapshot: JSON.parse(readFileSync(join(dir, file), 'utf8')) }
  } catch {
    return undefined
  }
}

/** bundles 差集：restore 前后到底会动什么。 */
export function diffBundles(from, to) {
  const a = new Set(Array.isArray(from) ? from : [])
  const b = new Set(Array.isArray(to) ? to : [])
  return {
    added: [...b].filter((x) => !a.has(x)),
    removed: [...a].filter((x) => !b.has(x)),
  }
}

/**
 * 把快照的 bundles 写回 profile 的 package.json——与壳的 restoreSnapshot 同一行为：
 * 只改 dsh.profile.bundles，不动 dependencies（改依赖得走 pnpm，那是市场的事）。
 */
export function restoreBundles(profileDir, snapshot) {
  const bundles = Array.isArray(snapshot?.bundles) ? snapshot.bundles.filter((x) => typeof x === 'string') : []
  const pkgFile = join(profileDir, 'package.json')
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  const before = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : []
  if (!pkg.dsh) pkg.dsh = {}
  if (!pkg.dsh.profile) pkg.dsh.profile = {}
  pkg.dsh.profile.bundles = bundles
  writeFileSync(pkgFile, JSON.stringify(pkg, null, 2), 'utf8')
  return { before, after: bundles, diff: diffBundles(before, bundles) }
}
