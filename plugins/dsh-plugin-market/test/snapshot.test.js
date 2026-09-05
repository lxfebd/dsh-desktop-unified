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

test('restore merges disabled lists instead of clobbering post-snapshot changes', () => {
  const home = freshHome()
  const disabledDir = join(home, 'storages', 'dsh-plugin-market')
  mkdirSync(disabledDir, { recursive: true })
  // 快照时禁用了 a；快照之后用户又禁用了 b（启用 a）
  const snap = snapshotProfileState({ dshHome: home, profile: 'web' })
  snap.disabled = ['a']
  writeFileSync(join(disabledDir, 'disabled.json'), JSON.stringify(['b'], null, 2), 'utf8')

  restoreFromSnapshot(home, 'web', snap)
  const disabled = JSON.parse(readFileSync(join(disabledDir, 'disabled.json'), 'utf8'))
  assert.deepEqual(disabled, ['a', 'b'], 'must keep both the snapshot and the current disables')
  rmSync(home, { recursive: true, force: true })
})