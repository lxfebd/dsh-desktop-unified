// dsh-terminal · host 面集成测试：真实 http server + 真 shell 子进程。
// 验证 SSE 流、stdin 写入、kill 闭环。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import * as plugin from '../lib/index.js'

function startServer() {
  const server = createServer()
  const handlers = new Map()
  const ctx = {
    webServer: {
      register: (r) => { handlers.set(r.path, r.handler); return () => handlers.delete(r.path) },
    },
    effect: (fn) => fn(),
    logger: { info: () => {} },
  }
  plugin.apply(ctx)
  server.on('request', (req, res) => {
    const h = handlers.get(req.url.split('?')[0])
    if (h) h(req, res)
    else { res.writeHead(404); res.end() }
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function sseFrames(buf) {
  return buf.split('\n\n').filter((f) => f.startsWith('event:'))
}

test('terminal: SSE stream + input round-trip + kill', async () => {
  const { server, port } = await startServer()
  const res = await fetch(`http://127.0.0.1:${port}/api/terminal/stream`)
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8')
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''

  async function waitFor(marker, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (buf.includes(marker)) return
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
    }
    assert.ok(buf.includes(marker), `marker ${JSON.stringify(marker)} not found in stream:\n${buf}`)
  }

  try {
    await waitFor('event: state', 5000)

    const MARK = 'dsh-term-ok-' + Date.now()
    await fetch(`http://127.0.0.1:${port}/api/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `echo ${MARK}\n` }),
    })
    await waitFor(MARK, 15000)

    const killRes = await fetch(`http://127.0.0.1:${port}/api/terminal/kill`, { method: 'POST' })
    assert.equal((await killRes.json()).ok, true)
    await waitFor('event: exit', 10000)
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
    server.close()
  }
})

test('terminal: replay ring survives a late reconnect', async () => {
  const { server, port } = await startServer()
  const r1 = await fetch(`http://127.0.0.1:${port}/api/terminal/stream`)
  const reader = r1.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const MARK = 'dsh-term-replay' + Date.now()
  try {
    const deadline = Date.now() + 15000
    await fetch(`http://127.0.0.1:${port}/api/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `echo ${MARK}\n` }),
    })
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      if (buf.includes(MARK)) break
    }
    assert.ok(buf.includes(MARK), 'output not seen on first connection')
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
  const r2 = await fetch(`http://127.0.0.1:${port}/api/terminal/stream`)
  const reader2 = r2.body.getReader()
  const decoder2 = new TextDecoder()
  let replay = ''
  const deadline = Date.now() + 5000
  while (Date.now() < deadline && !replay.includes(MARK)) {
    const { value, done } = await reader2.read()
    if (done) break
    replay += decoder2.decode(value, { stream: true })
  }
  assert.ok(replay.includes(MARK), 'replay ring should contain the earlier output')
  try { await reader2.cancel() } catch { /* already closed */ }
  await fetch(`http://127.0.0.1:${port}/api/terminal/kill`, { method: 'POST' })
  await new Promise((resolve) => setTimeout(resolve, 500))
  server.close()
})
