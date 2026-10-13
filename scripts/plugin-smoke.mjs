#!/usr/bin/env node
/**
 * 插件运行时冒烟：在临时 DSH_HOME 里起一个真的 `dsh web`，把仓库里的插件挂进
 * 这个一次性 profile，然后要求它们的路由真的答出 JSON、快照文件真的落盘。
 *
 * 为什么要有它：vitest 里的 apply() 测试用的是假 ctx，假 ctx 只能证明"逻辑对"，
 * 证明不了 inject 的服务在真实主机里存在、路由注册表认这条路、插件在真实组合顺序里
 * 能起来。ci-smoke.mjs 已经证明裸 `dsh web` 能起，这里在它的基础上多挂两个插件。
 *
 * 不联网、不碰真实 profile：profile 的 node_modules 用 junction 指向仓库已有的
 * 依赖树（junction 不需要管理员权限，仓库自己的测试也用它），link: 依赖同样 junction。
 *
 * 用法：node scripts/plugin-smoke.mjs [插件目录名 ...]
 *   默认挂 plugins/dsh-plugin-snapshot 与 plugins/dsh-market-doctor。
 */
import { spawn } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const REPO = join(import.meta.dirname, '..')
const PORT = Number(process.env.DSH_SMOKE_PORT ?? 3999)
const READY_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 20_000

/** 要挂进一次性 profile 的插件（仓库 plugins/ 下的目录名，或绝对路径的探针插件）。 */
const pluginArgs = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['dsh-plugin-snapshot', 'dsh-market-doctor']
/** 解析成 { name, dir }：包名取自它自己的 package.json，避免目录名与包名不一致。 */
const plugins = pluginArgs.map((arg) => {
  const dir = /^[A-Za-z]:[\\/]|[\\/]/.test(arg) ? arg : join(REPO, 'plugins', arg)
  const name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
  if (!name) throw new Error(`${dir} 的 package.json 里没有 name`)
  return { name, dir }
})
const pluginNames = plugins.map((p) => p.name)

/** 每个插件声明要探的路由与判定"活着"的条件。 */
const PROBES = [
  { plugin: 'dsh-plugin-snapshot', path: '/plugin-snapshot/list', check: (body) => body.ok === true && Array.isArray(body.snapshots) },
  { plugin: 'dsh-market-doctor', path: '/market-doctor/report', check: (body) => body.ok === true && Array.isArray(body.findings) },
]

/**
 * 诊断用的额外探测（DSH_SMOKE_EXTRA_PROBES="/a,/b"）：只看状态码，非 404 就算"这条路存在"。
 * 用来对照别的插件在同一个一次性 profile 里到底有没有被组合出来。
 */
for (const path of String(process.env.DSH_SMOKE_EXTRA_PROBES ?? '').split(',').map((x) => x.trim()).filter(Boolean)) {
  PROBES.push({ plugin: '(extra)', path, check: () => true, extra: true })
}

const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-smoke-'))
const profileDir = join(home, 'profiles', 'web')
const modulesDir = join(profileDir, 'node_modules')

function link(name, target) {
  const path = join(modulesDir, name)
  mkdirSync(join(path, '..'), { recursive: true })
  // 已经存在就先摘掉这个链接（只摘链接本身，不碰目标），保证重复运行幂等
  try {
    if (lstatSync(path).isSymbolicLink() || lstatSync(path).isJunction()) unlinkSync(path)
  } catch {
    // 不存在就什么都不做
  }
  symlinkSync(target, path, 'junction')
}

/** 把仓库已有的依赖树 junction 进这个 profile，避免任何联网安装。 */
function projectRepoModules() {
  const repoModules = join(REPO, 'node_modules')
  if (!existsSync(repoModules)) throw new Error(`仓库里没有 node_modules：${repoModules}，先跑 pnpm install`)
  let count = 0
  for (const entry of readdirSync(repoModules)) {
    if (entry === '.bin' || entry.startsWith('.')) continue
    const source = join(repoModules, entry)
    if (entry.startsWith('@')) {
      mkdirSync(join(modulesDir, entry), { recursive: true })
      for (const scoped of readdirSync(source)) {
        link(join(entry, scoped), join(source, scoped))
        count += 1
      }
      continue
    }
    link(entry, source)
    count += 1
  }
  return count
}

/** 写一份最小 profile 清单：官方 web 模板 + 要验的插件。 */
function seedProfile() {
  mkdirSync(profileDir, { recursive: true })
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', ...pluginNames]
  const dependencies = {}
  for (const { name, dir } of plugins) {
    if (name.startsWith('@deepseek-ai/')) {
      const manifest = JSON.parse(readFileSync(join(REPO, 'node_modules', name, 'package.json'), 'utf8'))
      dependencies[name] = manifest.version
    } else {
      dependencies[name] = `link:${dir.replace(/\\/g, '/')}`
    }
  }
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({ name: 'web', private: true, dependencies, dsh: { profile: { bundles } } }, null, 2) + '\n')
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n')
  for (const { name, dir } of plugins) link(name, dir)
}

const bin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
const child = spawn(process.execPath, [bin, 'web', '--no-open', '--port', String(PORT)], {
  env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})

/** 主机自己的输出，失败时它就是唯一的诊断材料。 */
let hostLog = ''
child.stdout.on('data', (chunk) => { hostLog += chunk.toString('utf8') })
child.stderr.on('data', (chunk) => { hostLog += chunk.toString('utf8') })

let readyCookie
async function probeReady() {
  if (readyCookie) {
    try {
      return (await fetch(`http://127.0.0.1:${PORT}/`, { headers: { cookie: readyCookie } })).ok
    } catch {
      return false
    }
  }
  const claimed = /dsh web:\s+(\S+)/.exec(hostLog)
  try {
    const res = await fetch(claimed?.[1] ?? `http://127.0.0.1:${PORT}/`, { redirect: 'manual' })
    if (res.status !== 303) return res.ok
    const cookie = res.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) return false
    readyCookie = cookie
    return (await fetch(`http://127.0.0.1:${PORT}/`, { headers: { cookie } })).ok
  } catch {
    return false
  }
}

async function waitReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let stable = 0
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dsh 在就绪前退出（code ${child.exitCode}）\n${hostLog.slice(-4000)}`)
    stable = (await probeReady()) ? stable + 1 : 0
    if (stable >= 3) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`${READY_TIMEOUT_MS / 1000}s 内没有就绪\n${hostLog.slice(-4000)}`)
}

/** 与 src/plugin-recovery-restore.ts 同一取法：证明写侧落在真实读取方会看的地方。 */
function hostReaderLatest(dshHome, profile) {
  const dir = join(dshHome, 'storages', 'dsh-plugin-market', 'snapshots', profile)
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse()
    if (files.length === 0) return undefined
    return JSON.parse(readFileSync(join(dir, files[0]), 'utf8'))
  } catch {
    return undefined
  }
}

const results = []
try {
  const projected = projectRepoModules()
  seedProfile()
  console.log(`smoke: 临时 home ${home}，profile 挂入 ${pluginNames.join(' / ')}（junction 投影 ${projected} 个依赖）`)
  await waitReady()
  console.log(`smoke: dsh web 就绪于 127.0.0.1:${PORT}`)

  // 探针文件：探针插件在 apply() 里写到它自己旁边的 applied.txt，比路由更直接——
  // 它不依赖任何服务是否可用，也不依赖环境变量能不能传进子进程。
  for (const { name, dir } of plugins) {
    if (dir.startsWith(REPO)) continue
    const marker = (file) => {
      const path = join(dir, file)
      return existsSync(path) ? readFileSync(path, 'utf8').trim() : ''
    }
    const applied = marker('applied.txt')
    const imported = marker('imported.txt')
    results.push({
      plugin: name,
      path: 'apply() 探针',
      status: applied !== '' ? 'applied' : imported !== '' ? 'imported-but-not-applied' : 'not-imported',
      passed: applied !== '',
      summary: applied !== '' ? applied : imported !== '' ? '包被 import 了，但 apply 没被调用' : '包根本没被 import',
    })
  }

  for (const probe of PROBES) {
    const controller = AbortSignal.timeout(PROBE_TIMEOUT_MS)
    let status
    let body
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}${probe.path}`, { headers: { cookie: readyCookie, accept: 'application/json' }, signal: controller })
      status = res.status
      body = await res.json().catch(() => null)
    } catch (error) {
      status = 'fetch-failed'
      body = { error: error instanceof Error ? error.message : String(error) }
    }
    const passed = probe.extra ? status !== 404 : status === 200 && probe.check(body ?? {})
    results.push({ plugin: probe.plugin, path: probe.path, status, passed, summary: summarize(probe.plugin, body) })
  }

  // 快照落盘：真实读取方能不能读到这份 bundles
  const snapshot = hostReaderLatest(home, 'web')
  results.push({
    plugin: 'dsh-plugin-snapshot',
    path: 'storages/dsh-plugin-market/snapshots/web',
    status: snapshot ? 'written' : 'missing',
    passed: Boolean(snapshot) && Array.isArray(snapshot.bundles) && snapshot.bundles.length > 0,
    summary: snapshot ? `bundles=${snapshot.bundles.length} id=${snapshot.id}` : '没有任何快照',
  })
} catch (error) {
  results.push({ plugin: '(harness)', path: '-', status: 'error', passed: false, summary: error instanceof Error ? error.message : String(error) })
} finally {
  child.kill()
}

function summarize(plugin, body) {
  if (!body || typeof body !== 'object') return '无响应体'
  if (plugin === 'dsh-market-doctor') {
    const top = (body.findings ?? []).slice(0, 3).map((f) => `${f.severity}/${f.code}`).join(', ')
    return `profile=${body.profile} 结论 ${body.findings?.length ?? 0} 条（${top}）`
  }
  return `profile=${body.profile} 快照 ${body.snapshots?.length ?? 0} 份 来源=${body.resolvedFrom ?? '?'}`
}

console.log('\n=== 结果 ===')
for (const r of results) console.log(`${r.passed ? 'PASS' : 'FAIL'}  ${r.plugin}  ${r.path}  [${r.status}]  ${r.summary}`)
const noisy = hostLog.split('\n').filter((line) => /probe|error|cannot|warn|fail/i.test(line))
if (noisy.length > 0) {
  console.log('\n=== 主机输出里的相关行 ===')
  console.log(noisy.slice(0, 40).join('\n'))
}
const failed = results.filter((r) => !r.passed && r.plugin !== '(extra)')
if (failed.length > 0) {
  console.log('\n=== 主机输出尾部 ===')
  console.log(hostLog.slice(-6000))
  process.exitCode = 1
}
