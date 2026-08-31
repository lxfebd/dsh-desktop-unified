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
