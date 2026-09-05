// tests/github-releases.test.ts — GitHub Releases 拉取模块纯逻辑单测。
import { describe, expect, it } from 'vitest'
import { normalizeVersion, isNewerRemote, fetchLatestRelease, pickInstallerAsset } from '../src/github-releases.js'

describe('normalizeVersion', () => {
  it('strips a leading v', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3')
    expect(normalizeVersion('1.2.3')).toBe('1.2.3')
    expect(normalizeVersion('V0.1.2-rc.1.202609041312')).toBe('0.1.2-rc.1.202609041312')
  })
})

describe('isNewerRemote', () => {
  it('compares semver with prereleases', () => {
    expect(isNewerRemote('0.2.0', '0.1.2-rc.1.202609041312')).toBe(true)
    expect(isNewerRemote('0.1.2-rc.2', '0.1.2-rc.1.202609041312')).toBe(true)
    expect(isNewerRemote('0.1.2-rc.1.202609041312', '0.1.2-rc.1.202609041312')).toBe(false)
    expect(isNewerRemote('0.1.1', '0.1.2')).toBe(false)
  })
  it('falls back to lexicographic when a version is invalid', () => {
    expect(isNewerRemote('weird-tag', '0.1.2')).toBe(true)
    expect(isNewerRemote('0.1.2', 'weird-tag')).toBe(false)
  })
})

describe('fetchLatestRelease', () => {
  it('parses a release and its assets', async () => {
    const fake = async (url: string) => {
      expect(url).toContain('/repos/acme/dsh-desktop/releases/latest')
      return new Response(
        JSON.stringify({
          tag_name: 'v0.2.0',
          name: 'v0.2.0',
          published_at: '2026-09-01T00:00:00Z',
          body: '## What’s new\n- stuff',
          assets: [
            { name: 'DeepSeek-Harness-0.2.0-win-x64-setup.exe', browser_download_url: 'https://x/win.exe', size: 100 },
            { name: 'DeepSeek-Harness-0.2.0-mac-arm64.dmg', browser_download_url: 'https://x/mac.dmg', size: 200 },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    const rel = await fetchLatestRelease({ repo: 'acme/dsh-desktop', fetchImpl: fake as typeof fetch })
    expect(rel.version).toBe('0.2.0')
    expect(rel.tag).toBe('v0.2.0')
    expect(rel.assets.length).toBe(2)
    expect(rel.notes).toContain('stuff')
  })

  it('throws on non-OK responses', async () => {
    const fake = async () => new Response('{}', { status: 404 })
    await expect(fetchLatestRelease({ repo: 'x/y', fetchImpl: fake as typeof fetch })).rejects.toThrow(/404/)
  })

  it('throws when the tag_name is missing', async () => {
    const fake = async () => new Response(JSON.stringify({ name: 'x' }), { status: 200 })
    await expect(fetchLatestRelease({ repo: 'x/y', fetchImpl: fake as typeof fetch })).rejects.toThrow(/tag_name/)
  })
})

describe('pickInstallerAsset', () => {
  const rel = {
    tag: 'v0.2.0', version: '0.2.0', name: 'v0.2.0', publishedAt: '', notes: '',
    assets: [
      { name: 'DeepSeek-Harness-0.2.0-win-x64-setup.exe', url: 'https://x/win.exe', size: 1 },
      { name: 'DeepSeek-Harness-0.2.0-mac-arm64.dmg', url: 'https://x/mac.dmg', size: 2 },
      { name: 'DeepSeek-Harness-0.2.0-mac-arm64.zip', url: 'https://x/mac.zip', size: 3 },
      { name: 'SHA256SUMS', url: 'https://x/sha', size: 4 },
    ],
  }
  it('picks setup.exe on Windows', () => {
    expect(pickInstallerAsset(rel as never, 'win32')?.name).toBe('DeepSeek-Harness-0.2.0-win-x64-setup.exe')
  })
  it('picks dmg first on macOS, zip as fallback', () => {
    expect(pickInstallerAsset(rel as never, 'darwin')?.name).toBe('DeepSeek-Harness-0.2.0-mac-arm64.dmg')
    const noDmg = { ...rel, assets: rel.assets.filter((a) => !a.name.endsWith('.dmg')) }
    expect(pickInstallerAsset(noDmg as never, 'darwin')?.name).toBe('DeepSeek-Harness-0.2.0-mac-arm64.zip')
  })
  it('returns undefined when nothing matches', () => {
    expect(pickInstallerAsset({ ...rel, assets: [] } as never, 'win32')).toBeUndefined()
  })
})