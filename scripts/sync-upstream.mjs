/**
 * Sync-upstream entry for CI and `just sync`: polls npm for the latest
 * `@deepseek-ai/dsh`, and when it moved (or --force is passed) bumps the
 * dependency and computes the next desktop version. CI also passes --force
 * to rebuild the SAME upstream version when the repo itself changed since
 * the last release tag, or when a tag was left without a release by a
 * failed build.
 *
 * Desktop version scheme — a standalone 1.x line since 1.4.0:
 * `nextVersion()` bumps the current desktop version by one patch
 * (1.4.0 → 1.4.1 → …). Strictly increasing and valid semver is guaranteed
 * by `semver.inc`; the upstream version is tracked in `dsh.upstreamVersion`,
 * no longer encoded in the desktop number. The pre-1.4.0 scheme
 * (upstream prerelease + UTC timestamp, e.g. 0.1.2-rc.1.202609041312) is
 * history; `nextVersion` still renders a legacy prerelease-versioned tree
 * back onto the stable path if it ever reappears.
 *
 * Writes `changed`, `version`, and `upstream_version` to $GITHUB_OUTPUT when
 * present, and prints them otherwise. The lockfile refresh and the git
 * commit/tag are the caller's job. Always exits 0; `changed` carries the
 * verdict.
 *
 * Usage: node scripts/sync-upstream.mjs [--force]
 * @module dsh-desktop/scripts/sync-upstream
 */

import { execFile, execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, appendFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import semver from 'semver'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_PATH = join(ROOT, 'package.json')
const UPSTREAM = '@deepseek-ai/dsh'
const SCOPE = '@deepseek-ai'
const UPSTREAM_REPO = 'deepseek-ai/deepseek-harness'
const execFileAsync = promisify(execFile)

/**
 * Latest published upstream version, straight from the npm registry.
 *
 * Reads ALL dist-tags and takes the highest semver among them: upstream
 * publishes each rc to `next` first and only moves it to `latest` later (or
 * never), so `npm view version` — which reads `latest` only — misses fresh
 * rc releases for days (rc.7 and rc.8 both went undetected this way).
 */
function upstreamLatest() {
  const tags = JSON.parse(
    execFileSync('npm', ['view', UPSTREAM, 'dist-tags', '--json'], { encoding: 'utf8' }),
  )
  const best = Object.values(tags)
    .filter((v) => semver.valid(v))
    .sort(semver.rcompare)[0]
  if (!best) throw new Error(`no valid version in dist-tags of ${UPSTREAM}: ${JSON.stringify(tags)}`)
  return best
}

/**
 * Probe the upstream GitHub repo for prerelease tags that npm does not carry.
 *
 * npm's dist-tags mirror only the versions upstream has pushed to the npm
 * registry; a tag like `dsh-v0.1.2-alpha.1` can exist on GitHub long before a
 * matching tarball lands on npm (the harness project vendors its own tarballs
 * during testing). A dist-tag-only check would silently skip those releases.
 *
 * This probes raw git refs instead of the GitHub REST API (which rate-limits
 * anonymous callers hard in CI). `git ls-remote` needs no credentials and
 * answers with one round-trip.
 *
 * The result is reported — `github_newer` / `github_versions` — but never
 * adopted automatically: adopting a npm-less version means vendoring the whole
 * `@deepseek-ai/*` tree as `file:` dependencies, a deliberate heavier move
 * that the human operator should approve first. `changed` stays npm-driven.
 *
 * Fails open: any probe error (no git, no network, repo private) degrades to
 * a no-op and the caller proceeds with the npm-only verdict, so CI keeps the
 * exact existing behaviour when GitHub is unreachable.
 * @param {string} pinned - the version currently pinned in package.json
 * @returns {Promise<{newer: boolean, versions: string[]}>}
 */
async function probeGithubPrerelease(pinned) {
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', '--tags', `https://github.com/${UPSTREAM_REPO}.git`], {
      encoding: 'utf8',
      timeout: 20_000,
    })
    const versions = []
    for (const line of stdout.split('\n')) {
      // tag refs look like: <sha>\trefs/tags/<name>  or ...^{}
      const ref = line.split('\t')[1]
      if (!ref || !ref.startsWith('refs/tags/dsh-v')) continue
      if (ref.endsWith('^{}')) continue // dereferenced annotate-tag duplicate
      const candidate = ref.slice('refs/tags/dsh-v'.length)
      if (semver.valid(candidate)) versions.push(candidate)
    }
    const best = versions.sort(semver.rcompare)[0]
    const newer = Boolean(best) && semver.gt(best, pinned)
    return { newer, versions: versions.sort(semver.rcompare) }
  } catch (error) {
    console.log(`github prerelease probe unavailable (${error?.message ?? error}); falling back to npm dist-tags only`)
    return { newer: false, versions: [] }
  }
}

/**
 * Fixed-width UTC minute stamp (YYYYMMDDHHMM). Kept for tooling that still
 * uses it; desktop versions no longer embed a timestamp (see `nextVersion`).
 */
function buildStamp() {
  const now = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return (
    `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}` +
    `${p(now.getUTCHours())}${p(now.getUTCMinutes())}`
  )
}

/**
 * Compute the next desktop version for a new upstream release.
 *
 * Two independent version lines coexist in this repo:
 * - `package.json` version IS the desktop version. Since 1.4.0 it is a
 *   standalone semver line (1.4.0 → 1.4.1 → …), no longer tied to the
 *   upstream version. Bumping it is always a monotonic +1 on the patch.
 * - `dsh.upstreamVersion` tracks @deepseek-ai/dsh. CI's bump is metadata
 *   (verb/version in the commit message and release notes) — the dependency
 *   itself is adjusted by sync-upstream.mjs when upstream moves.
 *
 * The old scheme (upstream prerelease + UTC timestamp as an extra prerelease
 * segment, e.g. 0.1.2-rc.1.202609041312) is kept for history only: the
 * desktop line left it behind, and resurrecting it would fork the version
 * space away from the monotonic 1.x line.
 *
 * @param {string} current - current desktop version (package.json `version`)
 * @param {string} upstream - the upstream version being adopted (display only)
 * @returns {string} the next desktop version, strictly greater than `current`
 */
function nextVersion(current, upstream) {
  void upstream // upstream version no longer drives the desktop number
  const parsed = semver.parse(current)
  if (!parsed) throw new Error(`current desktop version ${current} is not valid semver`)
  if (parsed.prerelease.length > 0) {
    // Safety net for legacy 0.x-rc.y.timestamp style versions still sitting
    // in package.json: strip the trailing timestamp segments and take the
    // stable core, so a rebase onto the 1.x line lands at 0.1.2.
    const stable = `${parsed.major}.${parsed.minor}.${parsed.patch}`
    return semver.inc(stable, 'patch')
  }
  return semver.inc(current, 'patch')
}

/**
 * Detect @deepseek-ai/* packages that are referenced ONLY as peerDependencies
 * across the installed harness tree, never as a real `dependencies` entry.
 *
 * electron-builder's production collector reads only `dependencies` and
 * `optionalDependencies` (app-builder-lib `nodeModulesCollector.isProdDependency`),
 * so a runtime-required package declared solely as a peer would be dropped on
 * packaging. Returning them lets the caller pin each one explicitly.
 *
 * @param {string} upstreamVersion - version to pin dsh-* peers to
 * @returns {Record<string, string>} package name -> semver range
 */
function detectPeerOnlyRuntimeDeps(upstreamVersion) {
  const scopeDir = join(ROOT, 'node_modules', SCOPE)
  let names = []
  try {
    names = readdirSync(scopeDir).filter((n) => !n.startsWith('.'))
  } catch {
    return {} // node_modules absent (e.g. no install yet) — nothing to detect
  }

  const metas = new Map()
  const depsReferenced = new Set()
  const peerReferenced = new Set()
  for (const name of names) {
    const fullName = `${SCOPE}/${name}`
    let pkgJson
    try {
      pkgJson = JSON.parse(readFileSync(join(scopeDir, name, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    metas.set(fullName, pkgJson)
    for (const dep of Object.keys(pkgJson.dependencies || {})) {
      if (dep.startsWith(`${SCOPE}/`)) depsReferenced.add(dep)
    }
    for (const peer of Object.keys(pkgJson.peerDependencies || {})) {
      if (peer.startsWith(`${SCOPE}/`)) peerReferenced.add(peer)
    }
  }

  const result = {}
  for (const fullName of peerReferenced) {
    if (depsReferenced.has(fullName)) continue
    const pkgJson = metas.get(fullName)
    if (!pkgJson) continue // referenced but not installed — cannot pin
    // dsh-* peers track the upstream release; other peers (e.g. cordis-*)
    // keep their own installed version under a ^ range.
    const version = fullName.startsWith(`${SCOPE}/dsh`) ? upstreamVersion : pkgJson.version
    result[fullName] = `^${version}`
  }
  return result
}

/**
 * Merge detected peer-only runtime deps into `deps`, adding new ones and
 * bumping versions of existing entries. Entries are never removed: a peer that
 * later becomes a real dependency elsewhere stays pinned (harmless — the package
 * is still installed) rather than risk a stale reference after a rename.
 * @param {Record<string, string>} deps - package.json `dependencies` to mutate
 * @param {string} upstreamVersion - version to pin dsh-* peers to
 */
function syncPeerOnlyRuntimeDeps(deps, upstreamVersion) {
  const peerOnly = detectPeerOnlyRuntimeDeps(upstreamVersion)
  const added = []
  const updated = []
  for (const [name, range] of Object.entries(peerOnly)) {
    if (deps[name] == null) {
      added.push(name)
    } else if (deps[name] !== range) {
      updated.push(`${name}: ${deps[name]} -> ${range}`)
    }
    deps[name] = range
  }
  if (added.length) console.log(`peer-only runtime deps added: ${added.join(', ')}`)
  if (updated.length) console.log(`peer-only runtime deps updated: ${updated.join('; ')}`)
}

async function main() {
  const force = process.argv.includes('--force')
  const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
  const latest = upstreamLatest()
  const pinned = pkg.dependencies[UPSTREAM]
  const upstreamChanged = pinned !== latest
  const changed = force || upstreamChanged

  if (!changed) {
    console.log(`upstream unchanged at ${latest}; nothing to do`)
  } else {
    const version = nextVersion(pkg.version, latest)
    const currentUpstream = pkg.dsh?.upstreamVersion ?? pinned
    pkg.dependencies[UPSTREAM] = latest
    pkg.version = version
    // dsh.upstreamVersion is the authoritative upstream marker; the package
    // version itself is the standalone desktop line (since 1.4.0).
    pkg.dsh = { ...pkg.dsh, upstream: UPSTREAM, upstreamVersion: latest }
    // Re-pin the @deepseek-ai/* peer-only runtime deps for the new upstream
    // version: electron-builder's production collector ignores peerDependencies,
    // so these must be listed as real dependencies to survive packaging.
    syncPeerOnlyRuntimeDeps(pkg.dependencies, latest)
    writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`)
    console.log(`upstream ${currentUpstream} -> ${latest}; desktop version -> ${version}`)
  }

  // Probe GitHub for npm-less prerelease tags. This is a reporting channel
  // only — it never changes `changed`/`legacy` — so a GitHub-only tag higher
  // than the npm `latest` is surfaced to the operator without being adopted.
  const { newer, versions } = await probeGithubPrerelease(pinned)

  // `changed` = a build is wanted (upstream moved, or --force from a
  // repo-change / orphan-tag / manual rebuild); `upstream_changed` = the
  // upstream dependency itself moved, which CI uses to word the commit.
  // `github_newer` / `github_versions` report a GitHub prerelease tag that npm
  // does not carry (e.g. dsh-v0.1.2-alpha.1) — the operator can then decide
  // whether to vendor it deliberately.
  const outputs = {
    changed: String(changed),
    upstream_changed: String(upstreamChanged),
    version: pkg.version,
    upstream_version: latest,
    github_newer: String(newer),
    github_versions: versions.join(','),
  }
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') + '\n',
    )
  } else {
    console.log(outputs)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main()
}

export { nextVersion, buildStamp, probeGithubPrerelease }
