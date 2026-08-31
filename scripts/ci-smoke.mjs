#!/usr/bin/env node
/**
 * CI smoke test: boot `dsh web` straight from the installed dependency tree
 * and require three consecutive HTTP 200s — the same readiness rule the
 * desktop shell applies. Catches a pinned upstream whose web entry no longer
 * boots (bad publish, missing peer-only dep) before installers ship.
 *
 * dsh 0.1.2-alpha serves every request a minimal 401 except the root path
 * carrying its launch token; that token request answers 303 + Set-Cookie and
 * redirects to clean `/`. Node's fetch carries no cookie jar, so the smoke
 * mints the cookie from the token exchange once, then probes `/` with it
 * (mirrors src/main.ts probeReady).
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const PORT = 3999
const READY_TIMEOUT_MS = 90_000

const require = createRequire(import.meta.url)
const bin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
const home = mkdtempSync(join(tmpdir(), 'dsh-smoke-'))

const child = spawn(process.execPath, [bin, 'web', '--no-open', '--port', String(PORT)], {
  env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
/** Newest authenticated Web URL parsed off stdout (`dsh web: <url>`). */
let authUrl
/** Rolling stdout tail scanned for the URL line. */
let stdoutBuf = ''
child.stdout.on('data', (chunk) => {
  process.stdout.write(chunk)
  stdoutBuf += chunk.toString('utf8')
  const claimed = /dsh web:\s+(\S+)/.exec(stdoutBuf)
  if (claimed) {
    authUrl = claimed[1]
  }
  // 保留最后一个换行符之后的未完成行，防止跨 chunk 的 URL 行被截断
  const lastNl = stdoutBuf.lastIndexOf('\n')
  if (lastNl !== -1) stdoutBuf = stdoutBuf.slice(lastNl + 1)
})
child.stderr.on('data', (chunk) => process.stderr.write(chunk))

/** Minted session cookie from the token exchange. */
let readyCookie

function rootUrl() {
  return authUrl ?? `http://127.0.0.1:${PORT}/`
}

async function probeReady() {
  if (readyCookie) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`, { headers: { cookie: readyCookie } })
      return res.ok
    } catch {
      return false
    }
  }
  try {
    const res = await fetch(rootUrl(), { redirect: 'manual' })
    if (res.status !== 303) return res.ok
    const cookie = res.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) return false
    readyCookie = cookie
    const index = await fetch(`http://127.0.0.1:${PORT}/`, { headers: { cookie } })
    return index.ok
  } catch {
    return false
  }
}

async function ready() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let stableAnswers = 0
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dsh exited with code ${child.exitCode} before becoming ready`)
    }
    stableAnswers = (await probeReady()) ? stableAnswers + 1 : 0
    if (stableAnswers >= 3) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`dsh did not answer on port ${PORT} within ${READY_TIMEOUT_MS / 1000}s`)
}

try {
  await ready()
  console.log(`smoke: dsh web ready on 127.0.0.1:${PORT}${authUrl ? ` (authenticated: ${authUrl})` : ''}`)
} catch (error) {
  console.error(`smoke: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  child.kill()
}
