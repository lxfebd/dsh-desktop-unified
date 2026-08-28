/**
 * Bundled Harness version lookup and About copy. Packaged builds keep
 * `node_modules` inside the app bundle, and asar is a readable flat FS, so the
 * package manifest is read the same way unpacked or packed.
 * @module dsh-desktop/version-info
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Subset of a package manifest this module depends on. */
interface PackageMetadata {
  version?: unknown
  dependencies?: Record<string, unknown>
}

/** Reads and parses a package manifest, or undefined if unreadable. */
function readPackageMetadata(path: string): PackageMetadata | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageMetadata
  } catch {
    return undefined
  }
}

/** Narrows an unknown manifest field to a usable version string. */
function validVersion(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Resolves the bundled Harness version: the installed package manifest first,
 * falling back to the version range declared by the app itself.
 */
export function bundledHarnessVersion(appPath: string): string | undefined {
  const installedMetadata = readPackageMetadata(
    join(appPath, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'),
  )
  const installedVersion = validVersion(installedMetadata?.version)
  if (installedVersion) return installedVersion
  const appMetadata = readPackageMetadata(join(appPath, 'package.json'))
  return validVersion(appMetadata?.dependencies?.['@deepseek-ai/dsh'])
}

/** Builds the About dialog detail showing both shell and Harness versions. */
export function aboutDetail(
  desktopVersion: string,
  harnessVersion: string | undefined,
  locale: 'en' | 'zh',
): string {
  const harness = harnessVersion ?? (locale === 'zh' ? '未知' : 'Unknown')
  if (locale === 'zh') {
    return `DSH Desktop 版本：${desktopVersion}\n内置 Harness 版本：${harness}\n\nHarness 随 DSH Desktop 更新。`
  }
  return `DSH Desktop version: ${desktopVersion}\nBundled Harness version: ${harness}\n\nHarness is updated with DSH Desktop.`
}
