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
  const dst = profileDir(home, profile)
  if (existsSync(dst)) return
  mkdirSync(dst, { recursive: true })
  for (const f of ['package.json', 'cordis.patch.yml']) {
    const s = join(src, f)
    if (existsSync(s)) writeFileSync(join(dst, f), readFileSync(s, 'utf8'), 'utf8')
  }
}
