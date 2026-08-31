#!/usr/bin/env node
/**
 * Runtime-dependency load gate.
 *
 * Walks only the packages the shell actually ships (package.json
 * `dependencies`) and probes each one's main entry in a subprocess. A pinned
 * dependency whose entry refuses to load on this platform/arch (bad publish,
 * a native addon built for the wrong target, a missing peer) would make an
 * installer "succeed but be unusable" — this catches it before
 * electron-builder ships it.
 *
 * The probe is scoped to `dependencies` (not the whole node_modules walk) so
 * dev/transitive prebuilds for other platforms (node-pty `prebuilds/`,
 * electron's multi-arch extract-zip, rollup native accelerators) never create
 * false failures. Exit 1 lists every package whose entry failed to load.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const deps = Object.keys(pkg.dependencies ?? {})
const modules = deps
  .map((id) => {
    try {
      return require.resolve(id)
    } catch {
      return undefined
    }
  })
  .filter((entry) => entry !== undefined)

const mismatches = []
let probed = 0
for (const entry of modules) {
  // Skip local `file:` workspace plugins under plugins/ (shell-control, market,
  // preset-transfer): they are type-checked and smoke-tested elsewhere, and
  // probing their bundled dist here adds no platform signal. Everything under
  // node_modules is a real published dependency and gets probed.
  if (entry.startsWith(join(ROOT, 'plugins'))) continue
  probed++
  const probe = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(entry)})`], { stdio: 'ignore' })
  if (probe.error !== undefined || probe.status !== 0) mismatches.push(entry)
}

console.log(
  `platform=${process.platform} arch=${process.arch} deps=${deps.length} probed=${probed} failed_to_load=${mismatches.length}`,
)
if (mismatches.length > 0) {
  console.error('RUNTIME LOAD FAILURES:\n' + mismatches.join('\n'))
  process.exit(1)
}