import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { snapshotProfileState, listSnapshots, restoreFromSnapshot } from '../lib/snapshot.js'

function freshHome() {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-snap-'))
  mkdirSync(join(dir, 'profiles', 'web'), { recursive: true })
  writeFileSync(
    join(dir, 'profiles', 'web', 'package.json'),
    JSON.stringify({ dsh: { profile: { bundles: ['a'] } }, dependencies: {} }, null, 2),
  )
  return dir
}

test('snapshot captures bundles and restore rewrites them', () => {
  const home = freshHome()
  const snap = snapshotProfileState({ dshHome: home, profile: 'web' })
  writeFileSync(
    join(home, 'profiles', 'web', 'package.json'),
    JSON.stringify({ dsh: { profile: { bundles: ['a', 'evil'] } }, dependencies: {} }, null, 2),
  )
  restoreFromSnapshot(home, 'web', snap)
  const pkg = JSON.parse(readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dsh.profile.bundles, ['a'])
  rmSync(home, { recursive: true, force: true })
})

test('snapshot file round-trips through the snapshots dir', () => {
  const home = freshHome()
  const snap = snapshotProfileState({ dshHome: home, profile: 'web' })
  const list = listSnapshots(home, 'web')
  assert.ok(list.length >= 1)
  rmSync(home, { recursive: true, force: true })
})