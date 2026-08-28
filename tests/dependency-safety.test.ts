import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { analyzeDependencies, applyConvergence, isolateBundle } from '../src/dependency-safety.js'

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
