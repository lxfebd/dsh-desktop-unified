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