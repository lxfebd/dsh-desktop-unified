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
