// tests/session-notifier.test.ts — 会话完成检测逻辑单测（无 Electron 依赖）。
// 注入 now() 时钟 + 真实 setTimeout 驱动轮询；文件 mtime 用同一声明周期的
// fake 时刻（epoch 基准偏移），保证 lastWriteMs 与 now() 在同一刻度上比较。
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSessionNotifier, scanLatestSession } from '../src/session-notifier.js'

const EPOCH = 1_700_000_000_000

function freshHome() {
  const dir = `${tmpdir()}/dsh-notify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  mkdirSync(join(dir, 'sessions', 'cwd-a', 'session-1'), { recursive: true })
  mkdirSync(join(dir, 'sessions', 'cwd-a', 'session-2'), { recursive: true })
  return dir
}

function touch(home: string, sessionId: string, fakeMs: number) {
  const f = join(home, 'sessions', 'cwd-a', sessionId, 'session.jsonl.zstd')
  writeFileSync(f, '')
  utimesSync(f, new Date(fakeMs), new Date(fakeMs))
}

test('scanLatestSession finds newest write', () => {
  const home = freshHome()
  assert.equal(scanLatestSession(home), undefined)
  touch(home, 'session-1', EPOCH)
  assert.equal(scanLatestSession(home)?.sessionId, 'session-1')
  touch(home, 'session-2', EPOCH + 1000)
  const s = scanLatestSession(home)
  assert.equal(s?.sessionId, 'session-2')
  assert.equal(s?.lastWriteMs, EPOCH + 1000)
  assert.equal(scanLatestSession(join(home, 'nope')), undefined)
})

test('notifier fires once after quiet window, then once for a new session', async () => {
  const home = freshHome()
  let clock = EPOCH
  const fired: string[] = []
  const advance = async (ms: number) => {
    await sleep(Math.min(ms, 20))
    clock += ms
  }
  const n = createSessionNotifier({ dshHome: home, quietMs: 100, pollMs: 10, now: () => clock })
  n.onDone = (s) => fired.push(s.sessionId)
  touch(home, 'session-1', EPOCH) // 基线前已有陈旧会话

  n.start()
  // 基线 tick 之后，session-1 出现新活跃（时间推进）
  await advance(30)
  clock = EPOCH + 500
  touch(home, 'session-1', clock)

  // 等待越过 quiet 窗口（推进注入时钟）
  await advance(300)
  await waitUntil(() => fired.length >= 1, 1500)
  assert.deepEqual(fired, ['session-1'])

  // 同一个会话继续静默：不应再通知
  await advance(500)
  assert.equal(fired.length, 1, 'same session must not re-notify')

  // 新会话出现新活跃 → 再次通知
  clock = EPOCH + 2000
  touch(home, 'session-2', clock)
  await advance(300)
  await waitUntil(() => fired.length >= 2, 1500)
  assert.deepEqual(fired, ['session-1', 'session-2'])
  n.stop()
})

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitUntil(pred: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (!pred()) {
    if (Date.now() > deadline) throw new Error('timeout waiting for condition')
    await sleep(10)
  }
}