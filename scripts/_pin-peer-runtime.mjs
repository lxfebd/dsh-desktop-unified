// Mirror of scripts/sync-upstream.mjs detectPeerOnlyRuntimeDeps + syncPeerOnlyRuntimeDeps,
// because Windows cannot spawn bare `npm` from node (ENOENT), which blocks sync-upstream.mjs.
// Add @deepseek-ai/* packages that are used only as peerDependencies into package.json
// `dependencies` so electron-builder's production collector keeps them (it reads only
// dependencies/optionalDependencies, never peers).
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PKG_PATH = join(ROOT, 'package.json')
const SCOPE = '@deepseek-ai'
const pkg = JSON.parse(readFileSync(PKG_PATH, 'utf8'))
const upstreamVersion = pkg.dsh?.upstreamVersion
if (!upstreamVersion) throw new Error('no dsh.upstreamVersion in package.json')

const scopeDir = join(ROOT, 'node_modules', SCOPE)
let names = []
try {
  names = readdirSync(scopeDir).filter((n) => !n.startsWith('.'))
} catch {
  console.log('node_modules/@deepseek-ai absent; nothing to detect')
  process.exit(0)
}
const metas = new Map()
const depsReferenced = new Set()
const peerReferenced = new Set()
for (const name of names) {
  const fullName = `${SCOPE}/${name}`
  let meta
  try {
    meta = JSON.parse(readFileSync(join(scopeDir, name, 'package.json'), 'utf8'))
  } catch {
    continue
  }
  metas.set(fullName, meta)
  for (const dep of Object.keys(meta.dependencies || {})) if (dep.startsWith(`${SCOPE}/`)) depsReferenced.add(dep)
  for (const peer of Object.keys(meta.peerDependencies || {})) if (peer.startsWith(`${SCOPE}/`)) peerReferenced.add(peer)
}
const added = []
const updated = []
for (const fullName of peerReferenced) {
  if (depsReferenced.has(fullName)) continue
  const meta = metas.get(fullName)
  if (!meta) continue
  const version = fullName.startsWith(`${SCOPE}/dsh`) ? upstreamVersion : meta.version
  const range = `^${version}`
  if (pkg.dependencies[fullName] == null) added.push(fullName)
  else if (pkg.dependencies[fullName] !== range) updated.push(`${fullName}: ${pkg.dependencies[fullName]} -> ${range}`)
  pkg.dependencies[fullName] = range
}
if (added.length) console.log(`peer-only runtime deps added: ${added.join(', ')}`)
if (updated.length) console.log(`peer-only runtime deps updated: ${updated.join('; ')}`)
if (!added.length && !updated.length) console.log('no peer-only runtime deps to pin (already aligned)')
writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`)