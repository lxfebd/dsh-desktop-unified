import { describe, expect, it } from 'vitest'
import { nextVersion } from '../scripts/sync-upstream.mjs'

/**
 * Desktop version scheme since 1.4.0: `nextVersion` bumps the current desktop
 * line by one patch and never consults the upstream version. The old
 * upstream+timestamp scheme (0.1.2-rc.1.202609041312) is history but must
 * still render onto the stable path if a legacy version ever reappears.
 */
describe('nextVersion on the standalone desktop line', () => {
  it('bumps the patch of a stable desktop version', () => {
    expect(nextVersion('1.4.0', '0.1.2-rc.1')).toBe('1.4.1')
  })

  it('continues the monotonic line regardless of the middle version', () => {
    expect(nextVersion('1.4.9', '0.1.2-rc.1')).toBe('1.4.10')
  })

  it('rolls over minor at the next release', () => {
    expect(nextVersion('1.4.10', '0.1.2-rc.1')).toBe('1.4.11')
  })

  it('ignores the upstream version entirely', () => {
    expect(nextVersion('1.4.0', '9.9.9')).toBe('1.4.1')
    expect(nextVersion('1.4.0', '0.0.1-alpha')).toBe('1.4.1')
  })

  it('renders a legacy prerelease-versioned tree back onto the stable path', () => {
    // 0.1.2-rc.1.202609041312 → stable core 0.1.2 → 0.1.3, strictly greater
    // and valid semver (electron-updater requirement), no infinite loop.
    expect(nextVersion('0.1.2-rc.1.202609041312', '0.1.2-rc.1')).toBe('0.1.3')
  })

  it('rejects a malformed current version', () => {
    expect(() => nextVersion('not-a-version', '0.1.2-rc.1')).toThrow(/not valid semver/)
  })
})