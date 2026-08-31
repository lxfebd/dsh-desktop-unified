import { describe, it, expect } from 'vitest'
import { findCulprit } from '../src/safe-mode.js'

describe('findCulprit', () => {
  it('attributes an apply-time loader entry failure to the entry id and package', () => {
    const log = [
      '=== dsh web starting ===',
      '[stderr] DSH entry failed: failed to apply loader entry plugins/dsh-market (dsh-plugin-market)',
    ].join('\n')
    const culprit = findCulprit(log)
    expect(culprit).toEqual({
      kind: 'apply',
      entryId: 'plugins/dsh-market',
      packageName: 'dsh-plugin-market',
    })
  })

  it('attributes a cannot-resolve-profile-bundle failure to the bundle package', () => {
    const log = [
      '=== dsh web starting ===',
      '[stderr] cannot resolve profile bundle "dsh-plugin-broken"',
    ].join('\n')
    expect(findCulprit(log)).toEqual({
      kind: 'unresolvable',
      packageName: 'dsh-plugin-broken',
    })
  })

  it('attributes a declares-no-dsh-bundle failure to the bundle package (Dimension 3)', () => {
    const log = [
      '=== dsh web starting ===',
      '[stderr] profile bundle "dsh-plugin-decor" declares no dsh.bundle',
    ].join('\n')
    expect(findCulprit(log)).toEqual({
      kind: 'unresolvable',
      packageName: 'dsh-plugin-decor',
    })
  })

  it('attributes a plugin-failed-to-load summary to the single package (Dimension 4)', () => {
    const log = [
      '=== dsh web starting ===',
      '[stderr] plugin(s) failed to load: dsh-plugin-crashy',
    ].join('\n')
    expect(findCulprit(log)).toEqual({
      kind: 'unresolvable',
      packageName: 'dsh-plugin-crashy',
    })
  })

  it('takes the last bare package line after the Failed-to-load-plugins title (Dimension 5)', () => {
    const log = [
      '=== dsh web starting ===',
      '[stderr] Failed to load plugins',
      '[stderr] dsh-plugin-one',
      '[stderr] dsh-plugin-two',
    ].join('\n')
    const culprit = findCulprit(log)
    expect(culprit?.kind).toBe('unresolvable')
    expect(culprit && 'packageName' in culprit && culprit.packageName).toBe('dsh-plugin-two')
  })

  it('attributes a duplicate loader entry id failure (Dimension 6)', () => {
    const log = [
      '=== dsh web starting ===',
      '[stderr] duplicate loader entry id: "dsh-market"',
    ].join('\n')
    const culprit = findCulprit(log)
    expect(culprit?.kind).toBe('unresolvable')
    expect(culprit && 'packageName' in culprit && culprit.packageName).toBe('dsh-market')
  })

  it('attributes a slot conflict to the slot name', () => {
    const log = [
      '=== dsh web starting ===',
      '[stderr] single slot "sidebar" already has a registration',
    ].join('\n')
    expect(findCulprit(log)).toEqual({ kind: 'slot-conflict', slotName: 'sidebar' })
  })

  it('returns undefined when the crash is not attributable', () => {
    expect(findCulprit('=== dsh web starting ===\n[stderr] EADDRINUSE')).toBeUndefined()
  })

  it('lets the innermost repeated cause win (last match)', () => {
    const log = [
      '=== dsh web starting ===',
      '[stderr] failed to apply loader entry plugins/outer (@scope/a-broken)',
      '[stderr]   [cause] failed to apply loader entry plugins/inner (@scope/a-broken)',
    ].join('\n')
    const culprit = findCulprit(log)
    expect(culprit?.kind).toBe('apply')
    expect(culprit && 'entryId' in culprit && culprit.entryId).toBe('plugins/inner')
  })
})