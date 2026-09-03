import { describe, it, expect } from 'vitest'
import { migratePresetDepSpecs, presetDepSpec, type PresetPlugin } from '../src/preset-deps.js'

const PLUGINS: PresetPlugin[] = [
  { name: 'dshmarket', dir: 'J:\\app\\node_modules\\dshmarket', version: '1.10.1' },
  { name: 'dsh-shell-control', dir: 'J:\\app\\node_modules\\dsh-shell-control', version: '0.1.0' },
  { name: 'dsh-terminal', dir: 'J:\\app\\node_modules\\dsh-terminal', version: '0.1.0' },
]

/** dirHasManifest backed by an explicit set of live directories. */
const live = (...dirs: string[]) => new Set(dirs)
const hasManifest = (dirs: Set<string>) => (dir: string) => dirs.has(dir)

describe('presetDepSpec', () => {
  it('writes a link: spec with forward slashes on win32-style paths', () => {
    expect(presetDepSpec(PLUGINS[1])).toBe('link:J:/app/node_modules/dsh-shell-control')
  })
})

describe('migratePresetDepSpecs', () => {
  it('migrates legacy registry ranges of preset names to local links', () => {
    const deps: Record<string, string> = {
      'dshmarket': '^1.10.1',
      'dsh-shell-control': '^0.1.0',
      'dsh-terminal': '^0.1.0',
    }
    const changed = migratePresetDepSpecs(deps, PLUGINS, hasManifest(live()))
    expect(changed).toEqual(['dshmarket', 'dsh-shell-control', 'dsh-terminal'])
    expect(deps['dsh-shell-control']).toBe('link:J:/app/node_modules/dsh-shell-control')
    expect(deps.dshmarket).toBe('link:J:/app/node_modules/dshmarket')
  })

  it('treats bare versions and dist-tags as registry ranges too', () => {
    const deps: Record<string, string> = { 'dsh-terminal': '0.1.0', 'dshmarket': 'latest' }
    const changed = migratePresetDepSpecs(deps, PLUGINS, hasManifest(live()))
    expect(changed).toEqual(['dshmarket', 'dsh-terminal'])
  })

  it('never rewrites non-preset dependencies (market installs stay untouched)', () => {
    const deps: Record<string, string> = {
      'dsh-shell-control': '^0.1.0',
      'dsh-theme': '^1.0.1',
      'some-git-plugin': 'github:someone/dsh-thing',
    }
    const changed = migratePresetDepSpecs(deps, PLUGINS, hasManifest(live()))
    expect(changed).toEqual(['dsh-shell-control'])
    expect(deps['dsh-theme']).toBe('^1.0.1')
    expect(deps['some-git-plugin']).toBe('github:someone/dsh-thing')
  })

  it('keeps healthy link: specs untouched', () => {
    const deps: Record<string, string> = { 'dshmarket': 'link:J:/app/node_modules/dshmarket' }
    const changed = migratePresetDepSpecs(deps, PLUGINS, hasManifest(live('J:/app/node_modules/dshmarket')))
    expect(changed).toEqual([])
    expect(deps.dshmarket).toBe('link:J:/app/node_modules/dshmarket')
  })

  it('re-points a link: whose target no longer exists (app moved)', () => {
    const deps: Record<string, string> = { 'dshmarket': 'link:D:/old/place/node_modules/dshmarket' }
    const changed = migratePresetDepSpecs(deps, PLUGINS, hasManifest(live('J:/app/node_modules/dshmarket')))
    expect(changed).toEqual(['dshmarket'])
    expect(deps.dshmarket).toBe('link:J:/app/node_modules/dshmarket')
  })

  it('leaves registry-style local protocols (npm:) alone', () => {
    const deps: Record<string, string> = { 'dshmarket': 'npm:dshmarket-alt@^1.0.0' }
    const changed = migratePresetDepSpecs(deps, PLUGINS, hasManifest(live()))
    expect(changed).toEqual([])
  })

  it('is a no-op without a dependencies map', () => {
    expect(migratePresetDepSpecs(undefined, PLUGINS, hasManifest(live()))).toEqual([])
  })

  it('is idempotent: a migrated manifest reports no changes on the next pass', () => {
    const deps: Record<string, string> = { 'dsh-shell-control': '^0.1.0' }
    const exists = hasManifest(live('J:/app/node_modules/dsh-shell-control'))
    migratePresetDepSpecs(deps, PLUGINS, exists)
    expect(migratePresetDepSpecs(deps, PLUGINS, exists)).toEqual([])
  })
})
