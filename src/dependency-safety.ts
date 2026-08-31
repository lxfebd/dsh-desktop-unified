/**
 * Dependency-safety layer: builds a dependency graph of the web profile's
 * bundles BEFORE `dsh web` executes any plugin code, detects version
 * conflicts / orphaned bundles / mount failures, and emits converge-then-
 * isolate actions. Convergence makes plugins share the Host's hoisted
 * version; only when no version satisfies every range (or a bundle is
 * orphaned / unmountable) does isolation kick in — and isolation here only
 * edits the manifest, reusing safe-mode's restore semantics for the tray.
 * @module dsh-desktop/dependency-safety
 */

import { existsSync, lstatSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import semver from 'semver'

/** One bundle's requirement on a shared package. */
export interface ConflictRange {
  bundle: string
  range: string
}

/** A version conflict across two or more bundles for one package. */
export interface VersionConflict {
  package: string
  ranges: ConflictRange[]
  hostVersion: string | undefined
  /** Version that satisfies every range (the Host version when it qualifies),
   *  or `undefined` when no single version works (=> isolate). */
  convergeTo: string | undefined
}

/** A bundle listed in the profile but resolvable in neither fallback nor Host. */
export interface OrphanedBundle {
  bundle: string
  reason: 'not-installed'
}

/** A broken mount in the fallback `node_modules` (dangling symlink). */
export interface MountFailure {
  bundle: string
  link: string
  reason: 'broken-symlink' | 'missing-target'
}

/** Full pre-flight report. `ok` is true only when everything converges. */
export interface DependencyReport {
  conflicts: VersionConflict[]
  orphans: OrphanedBundle[]
  mountFailures: MountFailure[]
  ok: boolean
}

interface ProfileManifest {
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

export interface AnalyzeOptions {
  profileDir: string
  fallbackDir: string
  hostModulesDir: string
  builtinBundles: string[]
}

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** A bundle's own dependency closure, merged from its fallback then Host copy. */
function bundleDeps(bundle: string, opts: AnalyzeOptions): Record<string, string> | undefined {
  for (const dir of [join(opts.fallbackDir, bundle), join(opts.hostModulesDir, bundle)]) {
    const pj = join(dir, 'package.json')
    if (existsSync(pj)) {
      const pkg = readJson(pj) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
      return { ...pkg.dependencies, ...pkg.peerDependencies }
    }
  }
  return undefined
}

/**
 * Build the dependency graph and classify problems. Conflicts are only
 * reported for packages required by two or more bundles; a lone range is
 * never a conflict (the loader resolves it directly).
 */
export function analyzeDependencies(opts: AnalyzeOptions): DependencyReport {
  const manifestPath = join(opts.profileDir, 'package.json')
  const manifest = (existsSync(manifestPath) ? readJson(manifestPath) : {}) as ProfileManifest
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const conflicts: VersionConflict[] = []
  const orphans: OrphanedBundle[] = []
  const mountFailures: MountFailure[] = []
  const depMap = new Map<string, ConflictRange[]>()

  for (const bundle of bundles) {
    const link = join(opts.fallbackDir, bundle)
    try {
      // lstat does not follow the link target, so a broken junction/symlink
      // (target missing) is still seen as a real link here — unlike existsSync,
      // which follows and reports false for it.
      const st = lstatSync(link)
      if (st.isSymbolicLink()) {
        const target = readlinkSync(link)
        if (!existsSync(target)) mountFailures.push({ bundle, link, reason: 'missing-target' })
      }
    } catch {
      // lstat failed: distinguish a genuinely absent bundle (handled as an
      // orphan below) from an unreadable link that still occupies the path.
      if (existsSync(link)) mountFailures.push({ bundle, link, reason: 'broken-symlink' })
    }
    const deps = bundleDeps(bundle, opts)
    if (deps === undefined) {
      if (opts.builtinBundles.includes(bundle)) continue
      orphans.push({ bundle, reason: 'not-installed' })
      continue
    }
    for (const [pkg, range] of Object.entries(deps)) {
      if (!semver.validRange(range)) continue
      const list = depMap.get(pkg) ?? []
      list.push({ bundle, range })
      depMap.set(pkg, list)
    }
  }

  for (const [pkg, ranges] of depMap) {
    if (ranges.length < 2) continue
    const hostPj = join(opts.hostModulesDir, pkg, 'package.json')
    const hostVersion = existsSync(hostPj) ? (readJson(hostPj) as { version?: string }).version : undefined
    const candidates = [hostVersion, ...ranges.map((r) => semver.minVersion(r.range)?.version)].filter(
      (v): v is string => !!v,
    )
    const convergeTo = candidates.find((v) => ranges.every((r) => semver.satisfies(v, r.range)))
    conflicts.push({ package: pkg, ranges, hostVersion, convergeTo })
  }

  const ok =
    conflicts.every((c) => c.convergeTo !== undefined) &&
    orphans.length === 0 &&
    mountFailures.length === 0
  return { conflicts, orphans, mountFailures, ok }
}

/**
 * Converge: write each resolvable conflict's `convergeTo` into the profile
 * `dependencies`, so the loader's flat fallback picks the shared Host copy.
 * Returns the packages actually changed (empty array => nothing to do).
 */
export function applyConvergence(report: DependencyReport, profileDir: string): string[] {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = (existsSync(manifestPath) ? readJson(manifestPath) : {}) as ProfileManifest
  const converged: string[] = []
  for (const c of report.conflicts) {
    if (c.convergeTo === undefined) continue
    manifest.dependencies ??= {}
    if (manifest.dependencies[c.package] !== c.convergeTo) {
      manifest.dependencies[c.package] = c.convergeTo
      converged.push(c.package)
    }
  }
  if (converged.length > 0) writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
  return converged
}

/**
 * Isolate: drop orphaned bundles (nothing to converge — they are uninstalled)
 * from the manifest's `dsh.profile.bundles`. The `dependencies` entry is kept
 * on purpose, mirroring `safe-mode.removeBundle`, so a later reinstall can
 * re-mount without a re-add. Returns the removed bundle names.
 */
export function isolateBundle(report: DependencyReport, profileDir: string): string[] {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return []
  const manifest = readJson(manifestPath) as ProfileManifest
  const bundles = manifest.dsh?.profile?.bundles ?? []
  const orphanNames = new Set(report.orphans.map((o) => o.bundle))
  const next = bundles.filter((b) => !orphanNames.has(b))
  if (next.length === bundles.length) return []
  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: next } }
  writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n', 'utf8')
  return [...orphanNames]
}
