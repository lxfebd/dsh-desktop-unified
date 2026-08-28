import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, copyFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const HERE = dirname(fileURLToPath(import.meta.url))

// ---- 运行时路径 ----
function detectDshHome() {
  let dir = resolve(HERE, '..')
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, 'profiles'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return 'C:/Users/31672/dsh-home'
}

export const RUNTIME = {
  dshHome: process.env.DSH_HOME || detectDshHome(),
  nodeBin: process.execPath,
  dshBin: typeof process.argv[1] === 'string' && process.argv[1] ? process.argv[1] : '',
}

const DATA_DIR = () => join(RUNTIME.dshHome, 'storages', 'dsh-plugin-market')
const SOURCES_FILE = () => join(HERE, '..', 'sources.json')
const COMMUNITY_CACHE = () => join(DATA_DIR(), 'community-catalog.json')
const DISABLED_FILE = () => join(DATA_DIR(), 'disabled.json')
const WHITELIST_CACHE = () => join(DATA_DIR(), 'whitelist-cache.json')
const OP_TIMEOUT_MS = Number(process.env.DSH_MARKET_OP_TIMEOUT_MS) || 120000
const PNPM_TIMEOUT_MS = Number(process.env.DSH_MARKET_PNPM_TIMEOUT_MS) || 180000
const PNPM_STREAM_TIMEOUT_MS = Number(process.env.DSH_MARKET_PNPM_STREAM_TIMEOUT_MS) || 300000
const TRIAL_INSTALL_TIMEOUT_MS = Number(process.env.DSH_MARKET_TRIAL_TIMEOUT_MS) || 120000

// ---- TARGET_RE：安全白名单校验 source（防止 shell 注入）----
export const TARGET_RE = /^(@[a-z0-9-~][a-z0-9-._~]*(?:\/[a-z0-9-_.~]+)?|[a-z0-9-_.~]+|github:[a-zA-Z0-9-_.\/]+|git\+https:\/\/[^\s]+|https:\/\/[^\s]+)$/i

// ---- 内置官方目录 ----
export const OFFICIAL_CATALOG = [
  {
    id: 'dsh-base',
    name: '@deepseek-ai/dsh-base',
    source: '@deepseek-ai/dsh-base',
    desc: '核心能力包：工具注册表、会话、agent 主循环、系统提示组装、上下文压缩。web/headless 档默认已装。',
    type: 'npm', bundle: true, core: true,
  },
  {
    id: 'dsh-web-app',
    name: '@deepseek-ai/dsh-web-app',
    source: '@deepseek-ai/dsh-web-app',
    desc: 'Web 工作台前端 + 内置动态插件链路（cordis-host-runner / cordis-client-runner / ui-cordis）。web 档默认已装。',
    type: 'npm', bundle: true, core: true,
  },
  {
    id: 'dsh-headless',
    name: '@deepseek-ai/dsh-headless',
    source: '@deepseek-ai/dsh-headless',
    desc: '无界面（headless）档的核心包，用于命令行/CI 场景。',
    type: 'npm', bundle: true, core: true,
  },
  {
    id: 'dsh-tool-cordis',
    name: '@deepseek-ai/dsh-tool-cordis',
    source: '@deepseek-ai/dsh-tool-cordis',
    desc: '让 AI 在对话里自行定义/运行 Cordis 插件的模型侧工具，即"创造模式/自定义模式"的核心能力。',
    type: 'npm', bundle: false,
  },
]

// ---- 小工具 ----
function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}
function writeJson(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf8')
}

export function loadSources() {
  return readJson(SOURCES_FILE(), [])
}
export function saveSources(list) {
  writeJson(SOURCES_FILE(), list)
}

export function readInstalled(profile) {
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const pkg = readJson(join(profileDir, 'package.json'), {})
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
  const deps = Object.keys(pkg.dependencies || {})
  return { profile, bundles, deps, all: [...new Set([...bundles, ...deps])] }
}

export function resolveRepoOwners(profile) {
  const pkg = readJson(join(RUNTIME.dshHome, 'profiles', profile, 'package.json'), {})
  const out = {}
  for (const [key, val] of Object.entries(pkg.dependencies || {})) {
    if (typeof val !== 'string' || !val.includes('github.com')) continue
    const m = val.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
    if (!m) continue
    out['git+https://github.com/' + m[1] + '/' + m[2]] = key
  }
  return out
}

export function listInstalledModules(profile) {
  const dir = join(RUNTIME.dshHome, 'profiles', profile, 'node_modules')
  if (!existsSync(dir)) return []
  const skip = new Set(['.bin', '.pnpm', '.modules.yaml', '.lock'])
  const out = []
  try {
    for (const scope of readdirSync(dir)) {
      if (skip.has(scope) || scope.startsWith('.')) continue
      if (scope.startsWith('@')) {
        const scopeDir = join(dir, scope)
        if (!existsSync(scopeDir)) continue
        for (const name of readdirSync(scopeDir)) {
          if (!skip.has(name) && !name.startsWith('.')) out.push(`${scope}/${name}`)
        }
      } else {
        out.push(scope)
      }
    }
  } catch { /* profile node_modules 可能尚未生成 */ }
  return out
}

function buildEnv(mirror) {
  const env = { ...process.env }
  env.DSH_HOME = RUNTIME.dshHome
  env.PATH = dirname(RUNTIME.nodeBin) + ';' + (process.env.PATH || '')
  delete env.CODEBUDDY_SESSION_ID
  delete env.CLAUDE_SESSION_ID
  if (mirror) env.npm_config_registry = 'https://registry.npmmirror.com'
  return env
}

function runOnce(profile, action, source, mirror, cwd) {
  return new Promise((resolveResult) => {
    const wrapperScript = fileURLToPath(new URL('./run-pnpm.cjs', import.meta.url))
    const args = [wrapperScript, cwd, action, source]
    const run = spawn(RUNTIME.nodeBin, args, { cwd, env: buildEnv(mirror), windowsHide: true })
    let stdout = ''
    let stderr = ''
    run.stdout?.on('data', (d) => { stdout += d.toString() })
    run.stderr?.on('data', (d) => { stderr += d.toString() })
    const timer = setTimeout(() => { try { run.kill('SIGKILL') } catch { /* 已退出 */ } }, PNPM_TIMEOUT_MS)
    run.on('close', (code) => { clearTimeout(timer); resolveResult({ code: code ?? 1, stdout, stderr }) })
    run.on('error', (e) => { clearTimeout(timer); resolveResult({ code: 1, stdout, stderr: String(e) }) })
  })
}

export function extractBlockedPkg(output) {
  const text = String(output || '')
  const m = text.match(/(?:git-hosted package|package)\s+"((?:@[^"@\/]+\/)?[^"@\s]+)@\d/)
  if (m) return m[1]
  const h = text.match(/onlyBuiltDependencies:\s*\n?\s*-["']?\s*((?:@[^"@\/]+\/)?[^"'\s@]+)/)
  if (h) return h[1]
  return ''
}

export async function runDshPlugin(profile, action, source, mirror) {
  const cwd = join(RUNTIME.dshHome, 'profiles', profile)
  let result = await runOnce(profile, action, source, mirror, cwd)
  if (action === 'add' && result.code !== 0) {
    const pkg = extractBlockedPkg(result.stderr + '\n' + result.stdout)
    if (pkg && addOnlyBuilt(cwd, pkg)) {
      result = await runOnce(profile, action, source, mirror, cwd)
    }
  }
  return result
}

// ---- 流式安装 ----
const NDJSON_ATTR = ['--reporter=ndjson']

async function runStreamingOnce(profile, action, source, mirror, cwd, onEvent) {
  return new Promise((resolveResult) => {
    const wrapperScript = fileURLToPath(new URL('./run-pnpm.cjs', import.meta.url))
    const args = [wrapperScript, cwd, action, source, ...NDJSON_ATTR]
    const run = spawn(RUNTIME.nodeBin, args, { cwd, env: buildEnv(mirror), windowsHide: true })
    let stdout = ''
    let stderr = ''
    let buffer = ''
    const timer = setTimeout(() => { try { run.kill('SIGKILL') } catch { /* 已退出 */ } }, PNPM_STREAM_TIMEOUT_MS)

    run.stdout?.on('data', (d) => {
      const text = d.toString()
      stdout += text
      buffer += text
      let nl
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim()
        buffer = buffer.slice(nl + 1)
        if (!line) continue
        let ev = null
        try { ev = JSON.parse(line) } catch { /* 非 JSON 行，忽略 */ }
        if (ev) onEvent?.({ type: 'ndjson', ev })
      }
    })
    run.stderr?.on('data', (d) => { const text = d.toString(); stderr += text; onEvent?.({ type: 'log', text: text.replace(/\u001b\[[0-9;]*m/g, '') }) })
    run.on('close', (code) => {
      clearTimeout(timer)
      onEvent?.({ type: 'done', code: code ?? 1, ok: code === 0, stdout, stderr })
      resolveResult({ code: code ?? 1, stdout, stderr })
    })
    run.on('error', (e) => {
      clearTimeout(timer)
      onEvent?.({ type: 'log', text: String(e) })
      onEvent?.({ type: 'done', code: 1, ok: false, stdout, stderr: String(e) })
      resolveResult({ code: 1, stdout, stderr: String(e) })
    })
  })
}

function pnpmStageWeight(stage) {
  if (stage === 'resolution_started') return { stage: '依赖解析', w: 0.05 }
  if (stage === 'resolution_done') return { stage: '依赖解析完成', w: 0.2 }
  if (stage === 'importing_started') return { stage: '安装包下载', w: 0.25 }
  if (stage === 'importing_done') return { stage: '安装完成', w: 0.95 }
  if (stage === 'building_started') return { stage: '构建脚本', w: 0.95 }
  if (stage === 'building_done') return { stage: '构建完成', w: 0.99 }
  return null
}

function createProgressTracker(onEvent) {
  let totalBytes = 0
  let startedPackages = new Map()
  let fetchedPackages = 0
  let totalPackages = 0
  let stageW = 0.05
  let stageLabel = '准备中'
  let lastPct = 0

  const emit = (stageOverride) => {
    const counted = startedPackages.size
    const pkgRatio = totalPackages > 0 ? counted / totalPackages : null
    const bytesRatio = totalBytes > 0 ? (() => {
      let done = 0
      for (const [, size] of startedPackages) done += size
      return done / totalBytes
    })() : null
    const ratios = [pkgRatio, bytesRatio].filter((x) => x != null)
    const child = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : 0
    let next = stageW
    if (stageOverride === 'importing_started' || stageW >= 0.25) {
      const base = 0.25
      const span = 0.7
      next = base + child * span
    }
    const pct = Math.min(99, Math.max(1, Math.round(next * 100)))
    if (pct === lastPct) return
    lastPct = pct
    onEvent?.({
      type: 'progress',
      percent: pct,
      done: fetchedPackages,
      total: totalPackages,
      bytes: Array.from(startedPackages.values()).reduce((a, b) => a + b, 0),
      bytesTotal: totalBytes,
      stage: stageLabel,
    })
  }

  return {
    on(ev) {
      const name = ev.name || ''
      if (name === 'pnpm:stage') {
        const s = pnpmStageWeight(ev.stage)
        if (s) { stageW = s.w; stageLabel = s.stage }
        emit()
      } else if (name === 'pnpm:fetching-progress' && ev.status === 'started') {
        if (!startedPackages.has(ev.packageId)) {
          const size = Number(ev.size) || 0
          startedPackages.set(ev.packageId, size)
          totalBytes += size
          totalPackages = Math.max(totalPackages, startedPackages.size)
          emit()
        }
      } else if (name === 'pnpm:progress') {
        if (ev.status === 'fetched' || ev.status === 'imported') {
          if (!startedPackages.has(ev.packageId)) startedPackages.set(ev.packageId, 0)
          fetchedPackages += 1
          totalPackages = Math.max(totalPackages, startedPackages.size)
          emit()
        }
      }
    },
    finish() {
      onEvent?.({ type: 'progress', percent: 100, done: fetchedPackages, total: totalPackages, bytes: totalBytes, bytesTotal: totalBytes, stage: '安装完成' })
    },
  }
}

function ndjsonHuman(ev) {
  const name = ev.name || ''
  if (name === 'pnpm:stage') return '阶段：' + (ev.stage || '')
  if (name === 'pnpm:fetching-progress' && ev.status === 'started') return '下载 ' + (ev.packageId || '') + (ev.size ? ' (' + Math.round(ev.size / 1024) + ' KB)' : '')
  if (name === 'pnpm:progress' && (ev.status === 'fetched' || ev.status === 'imported' || ev.status === 'found_in_store')) {
    const pkg = (ev.packageId || '').replace(/@\d[\w.]*$/, '')
    return '完成 ' + pkg + ' · ' + (ev.status === 'imported' ? '链接' : (ev.status === 'found_in_store' ? '缓存命中' : '下载完'))
  }
  if (name === 'pnpm:summary') return '汇总：完成安装'
  if (name === 'pnpm:execution-time') return '执行完成'
  if (name === 'pnpm:ignored-scripts') return (ev.packageNames && ev.packageNames.length ? '忽略脚本：' + ev.packageNames.join(', ') : '无脚本被忽略')
  return ''
}

export async function runDshPluginStreaming(profile, action, source, mirror, onEvent) {
  const cwd = join(RUNTIME.dshHome, 'profiles', profile)
  if (action !== 'add') {
    return runStreamingOnce(profile, action, source, mirror, cwd, (e) => onEvent?.(e))
  }
  const tracker = createProgressTracker((e) => onEvent?.(e))
  const handleEvent = (e) => {
    if (e.type === 'ndjson') {
      tracker.on(e.ev)
      const human = ndjsonHuman(e.ev)
      if (human) onEvent?.({ type: 'log', text: human })
      return
    }
    if (e.type === 'log') {
      onEvent?.(e)
      const m = e.text.match(/Progress:\s*(\d+)\s*\/\s*(\d+)/i)
      if (m) {
        const done = Number(m[1])
        const total = Number(m[2])
        onEvent?.({ type: 'progress', percent: Math.round(25 + (done / total) * 70), done: done, total: total, stage: '安装包下载' })
      }
      return
    }
    if (e.type === 'done') { tracker.finish(); onEvent?.(e); return }
  }
  let result = await runStreamingOnce(profile, action, source, mirror, cwd, handleEvent)
  if (result.code !== 0) {
    const pkg = extractBlockedPkg(result.stderr + '\n' + result.stdout)
    if (pkg && addOnlyBuilt(cwd, pkg)) {
      onEvent?.({ type: 'log', text: '检测到构建脚本被拦截，自动放行 ' + pkg + ' 并重试…' })
      result = await runStreamingOnce(profile, action, source, mirror, cwd, handleEvent)
    }
  }
  return result
}

function quotePkg(p) {
  const s = String(p).trim()
  const quoted = s.startsWith('"') || s.startsWith("'")
  return /^@[^/]+\//.test(s) && !quoted ? '"' + s + '"' : s
}

export function addOnlyBuilt(cwd, pkg) {
  const file = join(cwd, 'pnpm-workspace.yaml')
  if (!existsSync(file)) return false
  const lines = readFileSync(file, 'utf8').split('\n')
  const marker = 'onlyBuiltDependencies:'
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === marker) { idx = i; break }
  }
  const entryRe = /^\s*-\s*['"]?([^'"]+)['"]?\s*$/
  if (idx !== -1) {
    const existing = new Set()
    const pkgLine = new Map()
    for (let i = idx + 1; i < lines.length; i++) {
      const m = entryRe.exec(lines[i])
      if (!m) break
      existing.add(m[1].trim())
      pkgLine.set(m[1].trim(), i)
    }
    if (existing.has(pkg)) {
      const normalized = quotePkg(pkg)
      if (normalized === pkg) return false
      lines[pkgLine.get(pkg)] = '  - ' + normalized
      writeFileSync(file, lines.join('\n'), 'utf8')
      return true
    }
    lines.splice(idx + 1, 0, '  - ' + quotePkg(pkg))
    writeFileSync(file, lines.join('\n'), 'utf8')
    return true
  }
  if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('')
  lines.push(marker)
  lines.push('  - ' + quotePkg(pkg))
  writeFileSync(file, lines.join('\n'), 'utf8')
  return true
}

// ---- 社区源（awesome-dsh-plugin.com，1837+ 精选插件）----
const AWESOME_PLUGINS_URL = 'https://awesome-dsh-plugin.com/plugins.json'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000

/** 英文分类 → 中文映射（awesome-dsh-plugin.com 分类体系） */
const CATEGORY_ZH = {
  ui: '界面增强', usage: '用量与账单', theme: '主题与外观', model: '模型与提供商',
  identity: '身份与通讯', session: '会话与消息', memory: '长期记忆', tools: '工具与开发',
  browser: '浏览器', vision: '视觉', voice: '语音', docs: '文档',
  skill: '技能', workflow: '工作流', git: 'Git', notify: '通知',
  dev: '开发工具', security: '安全', remote: '远程', market: '插件市场', fun: '娱乐',
}

/** 从安装命令中提取插件源名 */
function extractInstallSource(installCmd) {
  if (!installCmd) return null
  const m = /add\s+(\S+)/.exec(installCmd)
  return m ? m[1].trim() : installCmd.trim()
}

/** 获取当前语言的描述文本 */
function pickDesc(desc) {
  if (!desc) return ''
  if (typeof desc === 'string') return desc
  if (typeof desc === 'object') {
    if (desc.zh) return desc.zh
    if (desc.en) return desc.en
    return ''
  }
  return String(desc)
}

export async function communityCatalog(force) {
  const cacheFile = COMMUNITY_CACHE()
  if (!force) {
    const cached = readJson(cacheFile, null)
    if (cached && typeof cached.at === 'number' && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached
    }
  }
  const items = await fetchPluginsJson()
  const snapshot = { at: Date.now(), items }
  try { writeJson(cacheFile, snapshot) } catch { /* 缓存写失败不致命 */ }
  return snapshot
}

async function fetchPluginsJson() {
  try {
    const res = await fetch(AWESOME_PLUGINS_URL, {
      headers: { 'User-Agent': 'dsh-plugin-market' },
      signal: AbortSignal.timeout(60000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const raw = (data && Array.isArray(data.plugins)) ? data.plugins : (Array.isArray(data) ? data : [])
    if (!raw.length) return []
    return raw.map((p, i) => ({
      id: 'registry-' + (p.npm || p.name || i),
      name: p.name || '',
      url: p.url || '',
      page: p.page || '',
      category: CATEGORY_ZH[p.category] || p.category || '插件',
      source: extractInstallSource(p.install) || p.name || '',
      desc: pickDesc(p.description),
      npm: p.npm || null,
      stars: p.stars || 0,
      downloads: p.downloads || 0,
      install: p.install || '',
      added: p.added || '',
      owner: p.owner || '',
      deprecated: !!p.deprecated,
      replacement: p.replacement || null,
      community: true,
      type: p.npm ? 'npm' : 'git',
    }))
  } catch { return [] }
}

// ---- 侧边栏 Tab 插件目录 ----
const TAB_PLUGINS_FILE = () => join(HERE, '..', 'tab-plugins.json')

export function loadTabPlugins() {
  return readJson(TAB_PLUGINS_FILE(), [])
}

// ============================================================
// 新能力：来源白名单（awesome-dsh-plugin.com 精选目录）
// ============================================================
const ORIGIN_CHECK = process.env.DSH_MARKET_ORIGIN || ''

/** 白名单直接复用社区目录（同一份 plugins.json），避免重复请求 */
async function fetchWhitelist() {
  const snap = await communityCatalog(false)
  return snap.items || []
}

export async function loadWhitelist(force) {
  const cacheFile = WHITELIST_CACHE()
  if (!force) {
    const cached = readJson(cacheFile, null)
    if (cached && typeof cached.at === 'number' && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached
    }
  }
  const items = await fetchWhitelist()
  const snapshot = { at: Date.now(), items }
  try { writeJson(cacheFile, snapshot) } catch { /* 缓存写失败不致命 */ }
  return snapshot
}

export function isSourceWhitelisted(source, whitelist) {
  if (!Array.isArray(whitelist) || !whitelist.length) return false
  const norm = (x) => String(x || '')
    .replace(/^git\+/, '')
    .replace(/^github:/i, '')
    .replace(/\.git$/, '')
    .replace(/\/+$/, '')
    .toLowerCase()
  const s = norm(source)
  if (!s) return false
  for (const entry of whitelist) {
    // 匹配 url（github 仓库链接）、name、npm 字段、install 命令、source
    const candidates = [
      entry.url, entry.name, entry.npm, entry.source,
      // install 命令里的 source：dsh plugin --profile web add github:owner/repo
      /add\s+(\S+)/.exec(entry.install || '')?.[1],
    ]
    for (const c of candidates) {
      if (!c) continue
      const n = norm(c)
      if (!n) continue
      if (s === n) return true
      // 仓库短名匹配：owner/repo 或 repo 短名
      const sRepo = s.split('/').pop()
      const nRepo = n.split('/').pop()
      if (sRepo && nRepo && sRepo === nRepo) return true
    }
  }
  return false
}

// ============================================================
// 新能力：FIFO 操作队列
// ============================================================
const ops = []
let runningOp = null
let opIdCounter = 0

function findDupOp(kind, profile, target) {
  return ops.find((o) => o.kind === kind && o.profile === profile && o.target === target && (o.status === 'pending' || o.status === 'checking'))
}

export function getOps() {
  return ops.map((o) => ({
    id: o.id,
    kind: o.kind,
    profile: o.profile,
    target: o.target,
    status: o.status,
    output: o.output,
    startedAt: o.startedAt,
    exitCode: o.exitCode,
  }))
}

export function killOp(opId) {
  const op = ops.find((o) => o.id === opId)
  if (!op) return { ok: false, error: '操作不存在' }
  if (op.status === 'running') {
    if (op.process && typeof op.process.kill === 'function') {
      try { op.process.kill('SIGKILL') } catch { /* 已退出 */ }
    }
    op.status = 'killed'
    op.exitCode = -1
    op.output = (op.output || '') + '\n操作已被用户终止'
    advanceQueue()
    return { ok: true }
  }
  if (op.status === 'pending') {
    op.status = 'killed'
    op.exitCode = -1
    op.output = '操作已被取消'
    advanceQueue()
    return { ok: true }
  }
  return { ok: false, error: '操作状态不可终止' }
}

function advanceQueue() {
  if (runningOp) return
  const next = ops.find((o) => o.status === 'pending' || o.status === 'checking')
  if (!next) return
  runningOp = next
  processOp(next)
}

async function processOp(op) {
  op.status = 'running'
  op.startedAt = Date.now()
  op.timer = setTimeout(() => {
    if (op.status === 'running') {
      op.status = 'timeout'
      op.exitCode = -1
      op.output = (op.output || '') + '\n操作超时（' + (OP_TIMEOUT_MS / 1000) + 's）'
      if (op.process && typeof op.process.kill === 'function') {
        try { op.process.kill('SIGKILL') } catch { /* 已退出 */ }
      }
      runningOp = null
      advanceQueue()
    }
  }, OP_TIMEOUT_MS)

  try {
    if (op.kind === 'add') {
      await runInstallOp(op)
    } else if (op.kind === 'remove') {
      await runUninstallOp(op)
    } else if (op.kind === 'update') {
      await runUpdateOp(op)
    }
  } catch (e) {
    if (op.status !== 'killed' && op.status !== 'timeout') {
      op.status = 'failed'
      op.exitCode = 1
      op.output = (op.output || '') + '\n' + String(e)
    }
  } finally {
    clearTimeout(op.timer)
    op.timer = null
    op.process = null
    if (op.status === 'running') {
      op.status = 'done'
      op.exitCode = 0
    }
    runningOp = null
    advanceQueue()
  }
}

function isNetworkError(text) {
  return /ETIMEDOUT|EAI_AGAIN|ECONNRESET|ECONNREFUSED|ENOTFOUND|EPIPE|network.*(?:timeout|unreachable|refused)/i.test(text)
}

async function runInstallOp(op) {
  const { profile, target, mirror, skipCheck, onEvent } = op
  const cwd = join(RUNTIME.dshHome, 'profiles', profile)

  // 同源校验
  if (ORIGIN_CHECK && op.origin && op.origin !== ORIGIN_CHECK) {
    op.status = 'refused'
    op.exitCode = 1
    op.output = '同源校验失败：Origin ' + op.origin + ' !== ' + ORIGIN_CHECK
    return
  }

  // TARGET_RE 白名单校验
  if (!TARGET_RE.test(target)) {
    op.status = 'refused'
    op.exitCode = 1
    op.output = '来源格式不合法，被 TARGET_RE 拦截：' + target
    return
  }

  // 来源白名单校验 + 试装验证  
  // 策略：白名单收录的源直接安装，白名单外的要求 skipCheck，不做试装
  // （试装验证需要完整 web profile 环境，临时目录不可靠）
  if (!skipCheck) {
    const whitelistSnap = await loadWhitelist(false)
    if (whitelistSnap.items && whitelistSnap.items.length > 0) {
      if (!isSourceWhitelisted(target, whitelistSnap.items)) {
        op.status = 'refused'
        op.exitCode = 1
        op.output = '来源不在 awesome-dsh-plugin.com 白名单中。如需跳过安全检查，请勾选"跳过安全检查"'
        return
      }
    }
  }

  // 安装前快照（失败回滚锚点）
  const snapshotFile = snapshotProfile(profile)

  // 执行真实安装，流式进度
  const logs = []
  const handleEvent = (e) => {
    if (e.type === 'log') {
      const txt = String(e.text || '').replace(/\u001b\[[0-9;]*m/g, '').trim()
      if (txt) logs.push(txt)
      op.output = (op.output || '') + txt + '\n'
    }
    if (e.type === 'progress' && onEvent) onEvent(e)
    if (e.type === 'done') {
      op.exitCode = e.code ?? 1
      if (e.code === 0) op.status = 'done'
      else op.status = 'failed'
    }
  }

  let result
  if (onEvent) {
    result = await runDshPluginStreaming(profile, 'add', target, mirror, handleEvent)
  } else {
    result = await runDshPlugin(profile, 'add', target, mirror)
    op.exitCode = result.code
    op.output = (op.output || '') + (result.stdout || '') + (result.stderr || '')
    op.status = result.code === 0 ? 'done' : 'failed'
  }

  // 网络错误自动重试
  if (op.status === 'failed' && op.exitCode !== 0 && !op._retried) {
    const errText = (result.stderr || '') + '\n' + (result.stdout || '')
    if (isNetworkError(errText)) {
      op._retried = true
      op.output = (op.output || '') + '\n检测到网络错误，2 秒后自动重试…\n'
      op.status = 'pending'
      runningOp = null
      await new Promise((r) => setTimeout(r, 2000))
      if (op.status === 'killed') return
      op.status = 'running'
      op.startedAt = Date.now()
      return runInstallOp(op)
    }
  }

  // 失败时回滚
  if (op.status === 'failed' && snapshotFile) {
    rollbackProfile(profile, target, snapshotFile)
    op.output = (op.output || '') + '\n安装失败，已自动回滚。\n'
  }

  // 成功后热挂载
  if (op.status === 'done') {
    try { hotMount(profile, target) } catch { /* 安静回退 */ }
  }
}

async function runUninstallOp(op) {
  const { profile, target } = op
  const result = await runDshPlugin(profile, 'remove', target)
  op.exitCode = result.code
  op.output = (result.stdout || '') + (result.stderr || '')
  op.status = result.code === 0 ? 'done' : 'failed'
}

async function runUpdateOp(op) {
  const { profile, target, mirror } = op
  const cwd = join(RUNTIME.dshHome, 'profiles', profile)
  const snapshotFile = snapshotProfile(profile)

  let result = await runOnce(profile, 'update', target, mirror, cwd)
  if (result.code !== 0) {
    const pkg = extractBlockedPkg(result.stderr + '\n' + result.stdout)
    if (pkg && addOnlyBuilt(cwd, pkg)) {
      result = await runOnce(profile, 'update', target, mirror, cwd)
    }
  }

  if (result.code !== 0 && !result._retried) {
    const errText = (result.stderr || '') + '\n' + (result.stdout || '')
    if (isNetworkError(errText)) {
      result._retried = true
      op.output = (op.output || '') + '\n检测到网络错误，2 秒后自动重试…\n'
      await new Promise((r) => setTimeout(r, 2000))
      result = await runOnce(profile, 'update', target, mirror, cwd)
    }
  }

  op.exitCode = result.code
  op.output = (result.stdout || '') + (result.stderr || '')
  op.status = result.code === 0 ? 'done' : 'failed'

  if (op.status === 'failed' && snapshotFile) {
    rollbackProfile(profile, target, snapshotFile)
    op.output = (op.output || '') + '\n更新失败，已自动回滚。\n'
  }
}

export function enqueueOp(kind, profile, target, opts) {
  if (!TARGET_RE.test(target)) {
    return { ok: false, error: '来源格式不合法，被 TARGET_RE 拦截' }
  }

  // P2：agent 运行中拒绝变更（install/uninstall/update/disable/enable）
  // 防止热替换 node_modules 时正在运行的 agent 因模块消失而崩溃
  const ag = isAgentRunning(profile)
  if (ag.running) {
    return {
      ok: false,
      error: '检测到 agent 正在运行（会话 ' + ag.sessionId + '，状态 ' + ag.status + '）'
        + '。请先停止 agent 或等待其完成，再执行插件变更操作，避免运行中模块热替换导致崩溃。',
      agentRunning: true,
      sessionId: ag.sessionId,
    }
  }

  const dup = findDupOp(kind, profile, target)
  if (dup) {
    return { ok: false, error: '已存在相同的操作（id=' + dup.id + '），请等待完成' }
  }

  opIdCounter += 1
  const op = {
    id: 'op-' + opIdCounter + '-' + Date.now(),
    kind,
    profile,
    target,
    status: 'pending',
    output: '',
    startedAt: 0,
    exitCode: null,
    timer: null,
    process: null,
    mirror: !!(opts?.mirror),
    skipCheck: !!(opts?.skipCheck),
    origin: opts?.origin || '',
    onEvent: opts?.onEvent || null,
    _retried: false,
  }
  ops.push(op)
  advanceQueue()
  return { ok: true, id: op.id }
}

// ============================================================
// 新能力：试装验证（trial boot）
// ============================================================
async function trialBoot(profile, source, mirror) {
  const trialDir = join(RUNTIME.dshHome, '.trial-' + Date.now() + '-' + randomUUID().slice(0, 8))
  const logLines = []
  const log = (msg) => { logLines.push(msg) }

  try {
    mkdirSync(trialDir, { recursive: true })

    // 创建 web profile 模板（继承真实 profile 的 workspace 配置，保证 pnpm 行为一致）
    const trialProfileDir = join(trialDir, 'profiles', 'web')
    mkdirSync(trialProfileDir, { recursive: true })

    const trialPkg = {
      name: 'dsh-trial',
      private: true,
      type: 'module',
      dependencies: {},
      dsh: { profile: { bundles: [] } },
    }
    writeJson(join(trialProfileDir, 'package.json'), trialPkg)

    // 继承真实 profile 的 pnpm-workspace.yaml（allowBuilds / minimumReleaseAgeExclude 等决策）
    // 与真实 profile 的依赖（让被验证插件能解析 peer / 运行时依赖），缺失时用最小模板。
    const realProfileDir = join(RUNTIME.dshHome, 'profiles', profile)
    const realYaml = join(realProfileDir, 'pnpm-workspace.yaml')
    const trialYaml = join(trialProfileDir, 'pnpm-workspace.yaml')
    let yamlInherited = false
    try {
      if (existsSync(realYaml)) {
        copyFileSync(realYaml, trialYaml)
        yamlInherited = true
      }
    } catch { /* 使用兜底 */ }
    if (!yamlInherited) {
      writeFileSync(trialYaml, 'packages:\n  - \'**\'\n\nautoInstallPeers: false\nnodeLinker: hoisted\n', 'utf8')
    }
    try {
      const realPkg = readJson(join(realProfileDir, 'package.json'), {})
      if (realPkg && realPkg.dependencies && typeof realPkg.dependencies === 'object') {
        trialPkg.dependencies = { ...realPkg.dependencies }
        trialPkg.dsh.profile.bundles = (realPkg.dsh && realPkg.dsh.profile && realPkg.dsh.profile.bundles) || []
        writeJson(join(trialProfileDir, 'package.json'), trialPkg)
      }
    } catch { /* 继承依赖失败不致命 */ }

    log('试装目录：' + trialDir)

    // 执行 dsh plugin add
    const env = buildEnv(mirror)
    env.DSH_HOME = trialDir

    const result = await new Promise((resolveResult) => {
      const wrapperScript = fileURLToPath(new URL('./run-pnpm.cjs', import.meta.url))
      const args = [wrapperScript, trialProfileDir, 'add', source]
      const run = spawn(RUNTIME.nodeBin, args, { cwd: trialProfileDir, env, windowsHide: true })
      let stdout = ''
      let stderr = ''
      run.stdout?.on('data', (d) => { stdout += d.toString() })
      run.stderr?.on('data', (d) => { stderr += d.toString() })
      const timer = setTimeout(() => { try { run.kill('SIGKILL') } catch { /* 已退出 */ } }, TRIAL_INSTALL_TIMEOUT_MS)
      run.on('close', (code) => { clearTimeout(timer); resolveResult({ code: code ?? 1, stdout, stderr }) })
      run.on('error', (e) => { clearTimeout(timer); resolveResult({ code: 1, stdout, stderr: String(e) }) })
    })

    if (result.code !== 0) {
      log('试装安装失败（code=' + result.code + '）')
      const tailLines = (result.stderr || result.stdout || '').split('\n').filter(Boolean).slice(-10)
      for (const line of tailLines) log(line)
      return { ok: false, log: logLines.join('\n') }
    }

    log('试装安装成功，启动验证…')

    // 启动 dsh --profile web --port 0 等待就绪
    const bootResult = await new Promise((resolveResult) => {
      const args = [RUNTIME.dshBin, '--profile', 'web', '--port', '0']
      const run = spawn(RUNTIME.nodeBin, args, { cwd: trialDir, env, windowsHide: true })
      const bootTimer = setTimeout(() => {
        try { run.kill('SIGKILL') } catch { /* 已退出 */ }
        resolveResult({ ok: false, log: '启动超时（30s），未检测到 dsh web: 就绪行' })
      }, 30000)

      let output = ''
      run.stdout?.on('data', (d) => {
        const text = d.toString()
        output += text
        if (text.includes('dsh web:')) {
          clearTimeout(bootTimer)
          try { run.kill('SIGKILL') } catch { /* 已退出 */ }
          resolveResult({ ok: true, log: output })
        }
      })
      run.stderr?.on('data', (d) => { output += d.toString() })
      run.on('close', () => {
        clearTimeout(bootTimer)
        if (!output.includes('dsh web:')) {
          resolveResult({ ok: false, log: output || '进程异常退出' })
        }
      })
      run.on('error', (e) => {
        clearTimeout(bootTimer)
        resolveResult({ ok: false, log: String(e) })
      })
    })

    if (!bootResult.ok) {
      log('试装启动验证失败')
      log(bootResult.log)
      return { ok: false, log: logLines.join('\n') }
    }

    log('试装启动验证通过')
    return { ok: true, log: logLines.join('\n') }
  } finally {
    // 清理临时目录
    try { rmSync(trialDir, { recursive: true, force: true }) } catch { /* 清理失败不致命 */ }
  }
}

// ============================================================
// 新能力：pnpm 自动修复
// ============================================================
export function healReleaseAgeExclude(cwd, stderr) {
  if (!stderr || !stderr.includes('ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION')) return false
  const file = join(cwd, 'pnpm-workspace.yaml')
  if (!existsSync(file)) return false

  const lines = readFileSync(file, 'utf8').split('\n')
  const marker = 'minimumReleaseAgeExclude:'
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === marker) { idx = i; break }
  }

  const pkgRe = /["']([^"']+)["']/
  const pkgs = []
  for (const line of stderr.split('\n')) {
    const m = pkgRe.exec(line)
    if (m) pkgs.push(m[1])
  }
  if (!pkgs.length) return false

  if (idx !== -1) {
    const existing = new Set()
    for (let i = idx + 1; i < lines.length; i++) {
      const em = /^\s*-\s*['"]?([^'"]+)['"]?\s*$/.exec(lines[i])
      if (!em) break
      existing.add(em[1].trim())
    }
    let changed = false
    for (const pkg of pkgs) {
      if (!existing.has(pkg)) {
        lines.splice(idx + 1, 0, '  - ' + quotePkg(pkg))
        changed = true
      }
    }
    if (changed) { writeFileSync(file, lines.join('\n'), 'utf8'); return true }
    return false
  }

  if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('')
  lines.push(marker)
  for (const pkg of pkgs) lines.push('  - ' + quotePkg(pkg))
  writeFileSync(file, lines.join('\n'), 'utf8')
  return true
}

export function healAllowBuilds(cwd, stderr) {
  if (!stderr || !stderr.includes('ERR_PNPM_IGNORED_BUILDS')) return false
  const file = join(cwd, 'pnpm-workspace.yaml')
  if (!existsSync(file)) return false

  const lines = readFileSync(file, 'utf8').split('\n')
  const marker = 'allowBuilds:'
  let idx = -1
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === marker) { idx = i; break }
  }

  const pkgRe = /["']([^"']+)["']/
  const pkgs = []
  for (const line of stderr.split('\n')) {
    const m = pkgRe.exec(line)
    if (m) pkgs.push(m[1])
  }
  if (!pkgs.length) return false

  if (idx !== -1) {
    const existing = new Set()
    for (let i = idx + 1; i < lines.length; i++) {
      const em = /^\s*-\s*['"]?([^'"]+)['"]?\s*$/.exec(lines[i])
      if (!em) break
      existing.add(em[1].trim())
    }
    let changed = false
    for (const pkg of pkgs) {
      if (!existing.has(pkg)) {
        lines.splice(idx + 1, 0, '  - ' + quotePkg(pkg))
        changed = true
      }
    }
    if (changed) { writeFileSync(file, lines.join('\n'), 'utf8'); return true }
    return false
  }

  if (lines.length && lines[lines.length - 1].trim() !== '') lines.push('')
  lines.push(marker)
  for (const pkg of pkgs) lines.push('  - ' + quotePkg(pkg))
  writeFileSync(file, lines.join('\n'), 'utf8')
  return true
}

// ============================================================
// 新能力：安装前快照 + 回滚
// ============================================================
export function snapshotProfile(profile) {
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  if (!existsSync(pkgFile)) return null
  const stamp = Date.now()
  const snapFile = join(profileDir, '.mkts-snapshot-' + stamp + '.json')
  try {
    copyFileSync(pkgFile, snapFile)
    return snapFile
  } catch {
    return null
  }
}

export function rollbackProfile(profile, source, snapshotFile) {
  if (!snapshotFile || !existsSync(snapshotFile)) return false
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  try {
    copyFileSync(snapshotFile, pkgFile)
    // 尝试卸载失败的包
    const result = runOnce(profile, 'remove', source, false, profileDir)
    return result.code === 0
  } catch {
    return false
  } finally {
    try { rmSync(snapshotFile, { force: true }) } catch { /* 清理快照文件 */ }
  }
}

// ============================================================
// 新能力：热挂载（hot mount）
// ============================================================
// 把各种 source 形式规范化为 dsh 包名，避免同一插件以两种形态同时进入 bundles
//   github:owner/repo[#path:/xxx] → repo
//   npm:xxx                       → xxx
//   https://.../xxx.tgz           → xxx
//   @scope/name / name            → 原样
function normalizeBundleName(source) {
  if (!source || typeof source !== 'string') return source
  if (source.startsWith('github:')) {
    let rest = source.slice('github:'.length)
    const hashIdx = rest.indexOf('#')
    if (hashIdx !== -1) rest = rest.slice(0, hashIdx)
    const parts = rest.split('/').filter(Boolean)
    return parts[parts.length - 1] || source
  }
  if (source.startsWith('npm:')) return source.slice('npm:'.length)
  if (source.startsWith('http://') || source.startsWith('https://')) {
    try {
      const u = new URL(source)
      const seg = (u.pathname.split('/').pop() || source).replace(/\.tgz$/, '')
      return seg || source
    } catch { return source }
  }
  return source
}

// 对 bundles 去重 + 规范化：同一插件若有多种形态条目，只保留规范化包名一份
function normalizeBundles(bundles) {
  const seen = new Set()
  const out = []
  for (const b of bundles || []) {
    const name = normalizeBundleName(b)
    if (seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

export function hotMount(profile, source) {
  const patchFile = join(HERE, '..', 'cordis.patch.yml')
  if (!existsSync(patchFile)) return false

  try {
    const content = readFileSync(patchFile, 'utf8')
    const insertMatches = content.match(/^\s*-\s+insert:/gm)
    if (!insertMatches) return false

    // 尝试通过 cordis-plugin-include 的 Include 子树挂载
    const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
    const pkg = readJson(join(profileDir, 'package.json'), {})
    if (!pkg.dsh) pkg.dsh = {}
    if (!pkg.dsh.profile) pkg.dsh.profile = {}
    if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = []

    // 规范化 + 去重：把 source 形态收敛为包名，避免同一插件写成两条
    const name = normalizeBundleName(source)
    const before = pkg.dsh.profile.bundles
    const dedup = normalizeBundles(before)
    if (!dedup.includes(name)) dedup.push(name)
    // 仅当发生变化才写盘
    if (dedup.length !== before.length || dedup.join(',') !== before.join(',')) {
      pkg.dsh.profile.bundles = dedup
      writeJson(join(profileDir, 'package.json'), pkg)
    }
    return true
  } catch {
    return false
  }
}

// ============================================================
// 新能力：禁用/启用
// ============================================================
function loadDisabled() {
  return readJson(DISABLED_FILE(), [])
}

function saveDisabled(list) {
  writeJson(DISABLED_FILE(), list)
}

export function disablePlugin(profile, source) {
  const ag = isAgentRunning(profile)
  if (ag.running) {
    return { ok: false, error: 'agent 正在运行（会话 ' + ag.sessionId + '），为避免运行中热替换崩溃，请先停止 agent 再禁用插件', agentRunning: true }
  }
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  const pkg = readJson(pkgFile, {})
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []

  const idx = bundles.indexOf(source)
  if (idx === -1) {
    return { ok: false, error: '插件 ' + source + ' 不在 bundles 中，无需禁用' }
  }

  // 热禁用：写入 cordis.patch.yml 的 disabled 标记，HMR ~1s 生效，免重启
  const ok = !RUNTIME.patchWriteDisabled || typeof RUNTIME.patchWriteDisabled !== 'function'
    ? (function () {
        // 兼容：旧实现移除 bundle
        bundles.splice(idx, 1)
        if (!pkg.dsh) pkg.dsh = {}
        if (!pkg.dsh.profile) pkg.dsh.profile = {}
        pkg.dsh.profile.bundles = bundles
        writeJson(pkgFile, pkg)
        return true
      })()
    : RUNTIME.patchWriteDisabled(source, true)
  if (!ok) return { ok: false, error: '写入 cordis.patch.yml 失败，禁用未生效' }

  const disabled = loadDisabled()
  if (!disabled.includes(source)) {
    disabled.push(source)
    saveDisabled(disabled)
  }

  return { ok: true, hint: '已禁用（cordis.patch.yml disabled，约 1 秒生效，无需重启）' }
}

export function enablePlugin(profile, source) {
  const ag = isAgentRunning(profile)
  if (ag.running) {
    return { ok: false, error: 'agent 正在运行（会话 ' + ag.sessionId + '），为避免运行中热替换崩溃，请先停止 agent 再启用插件', agentRunning: true }
  }
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  const pkg = readJson(pkgFile, {})

  // 热启用：清除 cordis.patch.yml 的 disabled 标记
  if (RUNTIME.patchWriteDisabled && typeof RUNTIME.patchWriteDisabled === 'function') {
    RUNTIME.patchWriteDisabled(source, false)
  }

  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
  if (!bundles.includes(source)) {
    bundles.push(source)
    if (!pkg.dsh) pkg.dsh = {}
    if (!pkg.dsh.profile) pkg.dsh.profile = {}
    pkg.dsh.profile.bundles = bundles
    writeJson(pkgFile, pkg)
  }

  const disabled = loadDisabled().filter((d) => d !== source)
  saveDisabled(disabled)

  return { ok: true, hint: '已启用（约 1 秒生效，无需重启）' }
}

export function listDisabled() {
  return loadDisabled()
}

// ============================================================
// 主题系统：cordis.patch.yml 的 disabled 标记控制主题启停，切换后重启 dsh 生效
// ============================================================
const PATCH_FILE = () => join(RUNTIME.dshHome, 'profiles', 'web', 'cordis.patch.yml')
const THEME_STATE = () => join(DATA_DIR(), 'theme-state.json')

function loadThemeState() {
  return readJson(THEME_STATE(), { active: null, disabled: [] })
}
function saveThemeState(state) {
  writeJson(THEME_STATE(), state)
}

/** 解析 cordis.patch.yml：返回 [{id,name,disabled,rawLine}] */
function parsePatchRows() {
  try {
    const text = readFileSync(PATCH_FILE(), 'utf8')
    const rows = []
    const lines = text.split('\n')
    let cur = null
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const idm = /^-\s*id:\s*(.+)\s*$/.exec(line)
      if (idm) {
        const raw = idm[1].trim()
        const idVal = (raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))
          ? raw.slice(1, -1).replace(/''/g, "'")
          : raw
        cur = { line: i, id: idVal, name: null, disabled: null }
        rows.push(cur)
        continue
      }
      if (!cur) continue
      const nm = /^\s*name:\s*(.+)\s*$/.exec(line)
      if (nm) {
        const raw = nm[1].trim()
        cur.name = ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) ? raw.slice(1, -1) : raw
        continue
      }
      const dm = /^\s*disabled:\s*(true|false)\s*$/.exec(line)
      if (dm) { cur.disabled = dm[1] === 'true'; }
    }
    return rows
  } catch { return [] }
}

/** 在 cordis.patch.yml 中写入/更新某插件的 disabled 标记 */
function writePatchDisabled(id, disabled) {
  try {
    const file = PATCH_FILE()
    const text = readFileSync(file, 'utf8')
    const lines = text.split('\n')
    const rows = parsePatchRows()
    const hit = rows.find((r) => r.id === id || r.name === id)

    if (hit) {
      // 已有条目：找出 disabled 行的缩进。若只有 id/name 无 disabled 行，在其后追加
      const startIdx = hit.line
      let disabledIdx = -1
      for (let i = startIdx; i < lines.length; i++) {
        if (i > startIdx && /^-\s*id:/.test(lines[i])) break
        if (/^\s*disabled:/.test(lines[i])) { disabledIdx = i; break }
      }
      if (disabledIdx >= 0) {
        lines[disabledIdx] = '  disabled: ' + disabled
      } else {
        // 在条目末尾（下一个 id 之前）插入
        const insertAt = (() => {
          for (let i = startIdx + 1; i < lines.length; i++) {
            if (/^-?\s*id:/.test(lines[i]) && i !== startIdx) return i
          }
          return lines.length
        })()
        const pad = '  '
        lines.splice(insertAt, 0, pad + 'disabled: ' + disabled)
      }
    } else {
      // 无条目：文件末尾追加新条目（注意保持文件以换行结尾）
      // YAML 1.1 中 @ 是指示符字符，必须给 id 加引号，否则解析失败
      const needsQuote = /[^A-Za-z0-9._\-\/]/.test(id)
      const idLine = needsQuote ? "- id: '" + id.replace(/'/g, "''") + "'" : '- id: ' + id
      if (lines.length && lines[lines.length - 1] !== '') lines.push('')
      lines.push(idLine)
      lines.push('  disabled: ' + disabled)
    }
    writeFileSync(file, lines.join('\n') + (lines.length && lines[lines.length - 1] === '' ? '' : '\n'), 'utf8')
    return true
  } catch (e) {
    return false
  }
}

/** 从注册表中的 theme 分类提取主题插件列表（复用社区目录数据） */
export async function themeCatalog(force) {
  const snap = await communityCatalog(force)
  const themes = (snap.items || []).filter((it) => it.category === '主题与外观')
  const state = loadThemeState()
  const info = readInstalled('web')
  // 过滤掉非主题插件：只有注入 @deepseek-ai/dsh-client-ui-theme 的才是真主题
  // dsh-diorama 等角色皮肤插件虽有 category=主题与外观 但不是 UI 主题
  var realThemes = themes.filter(function (it) {
    var pkgName = it.name || it.npm || ''
    var pkgFile = join(RUNTIME.dshHome, 'profiles', 'web', 'node_modules', pkgName, 'package.json')
    if (!existsSync(pkgFile)) return true // 未安装的保留
    try {
      var pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
      var inject = pkg.dsh?.client?.inject
      return Array.isArray(inject) && inject.indexOf('@deepseek-ai/dsh-client-ui-theme') !== -1
    } catch { return true }
  })
  return {
    at: snap.at,
    themes: realThemes.map((it) => {
      const installed = info.all.includes(it.name) || info.all.includes(it.npm || '')
      const disabledInPatch = installed ? readThemeBundleDisabled(it.name) : false
      return { ...it, installed, disabled: disabledInPatch }
    }),
    active: state.active,
  }
}

// ---- P2: 详情页懒加载 API ----

/** 插件元数据：从社区目录快照查单个 source */
export async function getPluginMeta(source) {
  if (!source) return null
  const norm = String(source).replace(/^git\+/, '').replace(/\.git$/, '').toLowerCase()
  try {
    const snap = await communityCatalog(false)
    const items = (snap.items || []).find((it) => {
      const cand = [it.source, it.name, it.npm, it.url]
        .filter(Boolean)
        .map((x) => String(x).replace(/^git\+/, '').replace(/\.git$/, '').toLowerCase())
      return cand.includes(norm)
    })
    return items || null
  } catch {
    return null
  }
}

/** 插件 README：从 GitHub raw 拉取主分支 README */
export async function getPluginReadme(source) {
  if (!source) return null
  const repo = String(source).replace(/^github:/i, '').replace(/\.git$/, '').replace(/\/+$/, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return null
  for (const branch of ['main', 'master']) {
    for (const name of ['README.md', 'readme.md', 'README.markdown']) {
      const url = 'https://raw.githubusercontent.com/' + repo + '/' + branch + '/' + name
      try {
        const res = await fetch(url)
        if (res.ok) return await res.text()
      } catch { /* 继续尝试 */ }
    }
  }
  return null
}

/** 插件版本历史：git tag 列表（从 GitHub API），失败回退空数组 */
export async function getPluginVersions(source) {
  if (!source) return []
  const repo = String(source).replace(/^github:/i, '').replace(/\.git$/, '').replace(/\/+$/, '')
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) return []
  try {
    const res = await fetch('https://api.github.com/repos/' + repo + '/tags?per_page=20')
    if (!res.ok) return []
    const arr = await res.json()
    return (Array.isArray(arr) ? arr : []).map((x) => ({ version: x.name, sha: x.commit && x.commit.sha }))
  } catch {
    return []
  }
}

/** 切换主题（互斥）：先禁用其他主题，再启用目标 */
export function switchTheme(profile, target, opts = {}) {
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  const info = readInstalled(profile)
  const state = loadThemeState()

  const installedName = info.all.find((n) => n === target || n === target.replace('@', '')) 
    || (state.disabled.includes(target) ? target : null)
  if (!installedName) {
    return { ok: false, error: '主题 ' + target + ' 未安装。请先在社区市场安装后再切换。' }
  }

  // 确保目标主题可被 dsh 作为 bundle 加载（加 dsh.bundle.patch + 创建 insert 格式 patch 文件）
  ensureBundleable(installedName)

  // 扫描所有已安装主题，禁用除目标外的所有已启用主题（防止多个主题同时启用）
  var allInstalled = info.all || []
  for (var i = 0; i < allInstalled.length; i++) {
    var testName = allInstalled[i]
    if (testName === installedName) continue
    // 检查是否是真主题（有 client-ui-theme inject）
    var testPkgFile = join(profileDir, 'node_modules', testName, 'package.json')
    try {
      var testPkg = JSON.parse(readFileSync(testPkgFile, 'utf8'))
      var testInject = testPkg.dsh?.client?.inject
      var isRealTheme = Array.isArray(testInject) && testInject.indexOf('@deepseek-ai/dsh-client-ui-theme') !== -1
      if (!isRealTheme) continue
    } catch { continue }
    // 禁用这个主题：先确保 patch 文件存在，再写入 disabled: true
    // （若顺序反了，文件不存在时 setDisabled 无效，ensureBundleable 创建的新文件缺 disabled 字段，主题仍启用）
    ensureBundleable(testName)
    setThemeBundleDisabled(testName, true)
  }

  // 启用目标：在 bundle 级 patch 中设 disabled: false
  var ok = setThemeBundleDisabled(installedName, false)
  if (!ok) return { ok: false, error: '写入主题 patch 文件失败' }

  // 把目标主题加入 profile 的 bundles 列表（dsh 只服务 bundle 的 client.js）
  var pkg = readJson(pkgFile, {})
  if (!pkg.dsh) pkg.dsh = {}
  if (!pkg.dsh.profile) pkg.dsh.profile = {}
  if (!Array.isArray(pkg.dsh.profile.bundles)) pkg.dsh.profile.bundles = []
  var bundles = normalizeBundles(pkg.dsh.profile.bundles)
  if (bundles.indexOf(installedName) === -1) {
    bundles.push(installedName)
    pkg.dsh.profile.bundles = bundles
    writeJson(pkgFile, pkg)
  } else if (bundles.join(',') !== (pkg.dsh.profile.bundles).join(',')) {
    pkg.dsh.profile.bundles = bundles
    writeJson(pkgFile, pkg)
  }

  saveThemeState({ active: installedName, disabled: [] })

  return {
    ok: true,
    active: installedName,
    hint: '主题已切换，正在重启 dsh…',
  }
}

/** 卸载主题时清理：若它是 active，则移除 active 标记 */
export function onThemeRemoved(name) {
  const state = loadThemeState()
  if (state.active === name) {
    state.active = null
    saveThemeState(state)
  }
}

// 注册补丁写入器，供 disablePlugin/enablePlugin 复用（热禁用入口）
RUNTIME.patchWriteDisabled = (id, disabled) => writePatchDisabled(id, disabled)

/** 重启 dsh 进程：启动新进程后退出当前进程，实现主题切换等配置生效 */
export function restartDsh() {
  const restartScript = fileURLToPath(new URL('./restart.cjs', import.meta.url))
  const args = [restartScript, RUNTIME.dshBin, ...process.argv.slice(2)]
  spawn(RUNTIME.nodeBin, args, { detached: true, stdio: 'ignore', env: process.env, windowsHide: true }).unref()
  setTimeout(function () { process.exit(0); }, 500)
}

/** 确保主题可作为 dsh bundle 加载：给 package.json 加 dsh.bundle.patch + 创建 insert 格式 patch 文件 */
function ensureBundleable(themeName) {
  const profileDir = join(RUNTIME.dshHome, 'profiles', 'web')
  const modDir = join(profileDir, 'node_modules', themeName)
  const pkgFile = join(modDir, 'package.json')
  if (!existsSync(pkgFile)) return false
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8'))
  if (!pkg.dsh) pkg.dsh = {}
  if (!pkg.dsh.bundle) pkg.dsh.bundle = {}
  if (!pkg.dsh.bundle.patch) {
    pkg.dsh.bundle.patch = './cordis.patch.yml'
    writeFileSync(pkgFile, JSON.stringify(pkg, null, 2))
  }
  const patchFile = join(modDir, 'cordis.patch.yml')
  // 如果文件不存在或格式不对（缺 insert），一律重写为标准格式
  var needsWrite = false
  if (!existsSync(patchFile)) {
    needsWrite = true
  } else {
    var existing = readFileSync(patchFile, 'utf8')
    if (!existing.includes('- insert:')) needsWrite = true
  }
  if (needsWrite) {
    // 用 insert 指令将条目插入 loader 树；id 用包名，dsh 通过 name 字段查找 dsh.client 声明。
    writeFileSync(patchFile,
      '# auto-generated by dsh-plugin-market\n' +
      '- insert:\n' +
      '    - id: ' + themeName + '\n' +
      '      name: \'' + themeName.replace(/'/g, "''") + '\'\n'
    )
  }
  return true
}

/** 在主题的 bundle 级 cordis.patch.yml 中设置 disabled 状态（insert 条目内的 disabled 字段） */
function setThemeBundleDisabled(themeName, disabled) {
  const patchFile = join(RUNTIME.dshHome, 'profiles', 'web', 'node_modules', themeName, 'cordis.patch.yml')
  if (!existsSync(patchFile)) return false
  try {
    // 统一去除行尾 \r（CRLF 文件会导致 $ 锚定失败，正则匹配不到 id 行）
    const text = readFileSync(patchFile, 'utf8').replace(/\r\n/g, '\n')
    const lines = text.split('\n')
    // 在 insert 条目中找到 id 或 name 匹配 themeName 的行
    let idLineIdx = -1
    let afterInsert = false
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*-\s*insert:\s*$/.test(lines[i])) { afterInsert = true; continue }
      if (afterInsert && /^\s*-\s*id:\s*(.+)$/.test(lines[i])) {
        var val = RegExp.$1.trim()
        if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
          val = val.slice(1, -1)
        }
        if (val === themeName) { idLineIdx = i; break }
        // 在当前 insert 条目内查找 name 字段（可能在 id 后的任意行）
        var nameMatch = false
        for (var scan = i + 1; scan < lines.length; scan++) {
          if (/^\s*-\s*id:\s*/.test(lines[scan])) break
          var nm = /^\s*name:\s*(.+)$/.exec(lines[scan])
          if (nm) {
            var nv = nm[1].trim()
            if ((nv.startsWith("'") && nv.endsWith("'")) || (nv.startsWith('"') && nv.endsWith('"'))) {
              nv = nv.slice(1, -1)
            }
            nameMatch = (nv === themeName)
            break
          }
        }
        if (nameMatch) { idLineIdx = i; break }
      }
    }
    if (idLineIdx < 0) return false
    // 在 id 行之后查找 disabled 行
    for (let i = idLineIdx + 1; i < lines.length; i++) {
      if (/^\s*disabled:\s*(true|false)\s*$/.test(lines[i])) {
        lines[i] = '      disabled: ' + disabled
        writeFileSync(patchFile, lines.join('\n'))
        return true
      }
      if (/^\s*-\s*id:\s*/.test(lines[i])) break
    }
    // 没有 disabled 行：在 id 行后追加
    var insertAt = idLineIdx + 1
    lines.splice(insertAt, 0, '      disabled: ' + disabled)
    writeFileSync(patchFile, lines.join('\n'))
    return true
  } catch {
    return false
  }
}

/** 读取主题的 bundle 级 cordis.patch.yml 中的 disabled 状态 */
function readThemeBundleDisabled(themeName) {
  const patchFile = join(RUNTIME.dshHome, 'profiles', 'web', 'node_modules', themeName, 'cordis.patch.yml')
  if (!existsSync(patchFile)) return false
  try {
    const text = readFileSync(patchFile, 'utf8').replace(/\r\n/g, '\n')
    const lines = text.split('\n')
    var inInsert = false
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*-\s*insert:\s*$/.test(lines[i])) { inInsert = true; continue }
      if (inInsert && /^\s*-\s*id:\s*(.+)$/.test(lines[i])) {
        var val = RegExp.$1.trim()
        if ((val.startsWith("'") && val.endsWith("'")) || (val.startsWith('"') && val.endsWith('"'))) {
          val = val.slice(1, -1)
        }
        // 检查 id 或 name 是否匹配（name 可能在 id 后的任意行）
        var nameMatch = false
        for (var scan = i + 1; scan < lines.length; scan++) {
          if (/^\s*-\s*id:\s*/.test(lines[scan])) break
          var nm = /^\s*name:\s*(.+)$/.exec(lines[scan])
          if (nm) {
            var nv = nm[1].trim()
            if ((nv.startsWith("'") && nv.endsWith("'")) || (nv.startsWith('"') && nv.endsWith('"'))) {
              nv = nv.slice(1, -1)
            }
            nameMatch = (nv === themeName)
            break
          }
        }
        if (val !== themeName && !nameMatch) { inInsert = false; continue }
        // 匹配了，找 disabled 字段
        for (var j = i + 1; j < lines.length; j++) {
          if (/^\s*disabled:\s*(true|false)\s*$/.test(lines[j])) {
            return RegExp.$1 === 'true'
          }
          if (/^\s*-?\s*id:\s*/.test(lines[j])) break
        }
        return false
      }
    }
    return false
  } catch {
    return false
  }
}

/** 合并的禁用列表：disabled 文件 + cordis.patch.yml 中的 disabled 标记 */
export function listDisabledEffective() {
  const patchRows = parsePatchRows()
  const fromPatch = patchRows.filter((r) => r.disabled === true).map((r) => r.id || r.name).filter(Boolean)
  const fromFile = loadDisabled()
  return [...new Set([...fromFile, ...fromPatch])]
}

// ============================================================
// P1：每插件更新检测（git HEAD vs npm latest）
// ============================================================
const UPDATE_CACHE = {}
const UPDATE_TTL = 30 * 60 * 1000 // 30 分钟

export async function checkPluginUpdates(profile) {
  const info = readInstalled(profile)
  const now = Date.now()
  const results = {}
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const nodeModulesDir = join(profileDir, 'node_modules')

  // 先一次性拉取社区目录，用于判断每个 bundle 的来源（npm 或 git）
  let cat = null
  try { cat = await communityCatalog(false) } catch { /* 静默 */ }
  const catItems = (cat && cat.items) || []

  for (const bundle of info.bundles || []) {
    // 检查缓存
    const cached = UPDATE_CACHE[bundle]
    if (cached && (now - cached.ts) < UPDATE_TTL) {
      results[bundle] = cached.result
      continue
    }

    const result = { outdated: false, current: null, latest: null, source: null }

    // 1. 当前版本：读 node_modules/<pkg>/package.json
    try {
      const pkgPath = join(nodeModulesDir, bundle, 'package.json')
      const pkgJson = readJson(pkgPath, {})
      if (pkgJson.version) {
        result.current = pkgJson.version
        result.source = pkgJson.name ? 'npm' : 'npm'
      }
    } catch { /* 静默 */ }

    // 2. 来源判断：先从社区目录匹配，确定是 npm 还是 git
    const catItem = catItems.find((it) => it.name === bundle || it.npm === bundle)
    if (catItem) {
      result.source = catItem.npm ? 'npm' : 'github'
    }

    // 3. 最新版本：从 npm registry 拉取
    // 私有包（@deepseek-ai/dsh-* 核心包）不在 npm registry，跳过
    // catalog 中 type=git 的包是 GitHub 直装，不在 npm registry，跳过
    const isPrivateCore = bundle.startsWith('@deepseek-ai/')
    const isGitSource = catItem && catItem.type === 'git'
    if (!isPrivateCore && !isGitSource) {
      try {
        const registryUrl = 'https://registry.npmmirror.com/' + bundle
        const res = await fetch(registryUrl, {
          headers: { 'Accept': 'application/json', 'User-Agent': 'dsh-plugin-market' },
          signal: AbortSignal.timeout(8000),
        })
        if (res.ok) {
          const data = await res.json()
          // 校验返回的包名匹配，避免同名不同包误报
          if (data.name === bundle) {
            const latest = data['dist-tags'] && data['dist-tags'].latest
            if (latest) {
              result.latest = latest
              if (result.current) {
                result.outdated = result.current !== latest
              }
            }
          }
        }
      } catch { /* 网络错误静默，保留 current */ }
    } else {
      result.source = isPrivateCore ? 'private' : 'github'
    }

    // 缓存结果
    UPDATE_CACHE[bundle] = { ts: now, result }
    results[bundle] = result
  }

  return results
}

// ============================================================
// P1：备份与恢复
// ============================================================
export function backupProfile(profile) {
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  const pkg = readJson(pkgFile, {})
  const disabled = loadDisabled()
  const patchRows = parsePatchRows()

  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    profile,
    bundles: (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || [],
    dependencies: pkg.dependencies || {},
    disabled,
    patchDisabled: patchRows.filter((r) => r.disabled === true).map((r) => r.id || r.name).filter(Boolean),
  }

  return backup
}

export function restoreProfile(profile, backup) {
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  const pkg = readJson(pkgFile, {})

  // 恢复 bundles
  if (!pkg.dsh) pkg.dsh = {}
  if (!pkg.dsh.profile) pkg.dsh.profile = {}
  pkg.dsh.profile.bundles = backup.bundles || []
  pkg.dependencies = { ...(pkg.dependencies || {}), ...(backup.dependencies || {}) }
  writeJson(pkgFile, pkg)

  // 恢复 disabled 列表
  saveDisabled(backup.disabled || [])

  // 恢复 patch disabled
  for (const id of (backup.patchDisabled || [])) {
    writePatchDisabled(id, true)
  }
  for (const id of (backup.bundles || [])) {
    if (!(backup.patchDisabled || []).includes(id)) {
      writePatchDisabled(id, false)
    }
  }

  return { ok: true, hint: '已恢复备份（bundles=' + (backup.bundles || []).length + ', disabled=' + (backup.disabled || []).length + '）' }
}

// ============================================================
// P2：诊断面板
// ============================================================
export function diagnoseProfile(profile) {
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const pkgFile = join(profileDir, 'package.json')
  const pkg = readJson(pkgFile, {})
  const bundles = (pkg.dsh && pkg.dsh.profile && pkg.dsh.profile.bundles) || []
  const issues = []

  // 1. bundle 栈冲突检测：同一 id 出现在多个 bundle 中
  const seen = {}
  for (const b of bundles) {
    const nodeDir = join(profileDir, 'node_modules', b)
    const bPkgFile = join(nodeDir, 'package.json')
    if (!existsSync(bPkgFile)) continue
    const bPkg = readJson(bPkgFile, {})
    const bBundlesArr = (bPkg.dsh && Array.isArray(bPkg.dsh.bundle) ? bPkg.dsh.bundle : [])
    for (const sub of bBundlesArr) {
      const id = typeof sub === 'string' ? sub : (sub.id || sub.name || '')
      if (!id) continue
      if (seen[id]) {
        issues.push({
          type: 'conflict',
          severity: 'warning',
          message: 'bundle 冲突："' + id + '" 同时被 "' + seen[id] + '" 和 "' + b + '" 声明',
          bundle: b,
          conflictWith: seen[id],
          id,
        })
      }
      seen[id] = b
    }
  }

  // 2. 重复 loader 条目
  const loaderIds = bundles.map((b) => b.replace(/^@/, '').replace(/\//g, '-'))
  const seenLoaders = {}
  for (const id of loaderIds) {
    if (seenLoaders[id]) {
      issues.push({
        type: 'duplicate-loader',
        severity: 'warning',
        message: 'loader 名称重复：' + id,
        id,
      })
    }
    seenLoaders[id] = true
  }

  // 3. 依赖版本不匹配
  const deps = pkg.dependencies || {}
  for (const [name, ver] of Object.entries(deps)) {
    if (ver && ver.startsWith('github:')) {
      // GitHub 来源无法直接比较版本
      continue
    }
    const nodeDir = join(profileDir, 'node_modules', name)
    if (!existsSync(nodeDir)) {
      issues.push({
        type: 'missing-dependency',
        severity: 'error',
        message: '依赖缺失：' + name + '（' + ver + '）未在 node_modules 中找到',
        name,
        version: ver,
      })
    }
  }

  // 4. 多版本核心包检测
  const corePackages = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/cordis']
  for (const cp of corePackages) {
    const nodeDir = join(profileDir, 'node_modules', cp)
    if (!existsSync(nodeDir)) continue
    const p = readJson(join(nodeDir, 'package.json'), {})
    // 检查是否有多个版本
    const versions = [p.version]
    const nestedDir = join(nodeDir, 'node_modules', cp)
    if (existsSync(nestedDir)) {
      const np = readJson(join(nestedDir, 'package.json'), {})
      if (np.version && np.version !== p.version) {
        issues.push({
          type: 'multi-version-core',
          severity: 'error',
          message: cp + ' 存在多版本：顶层 v' + p.version + '，嵌套 v' + np.version,
          name: cp,
          topVersion: p.version,
          nestedVersion: np.version,
        })
      }
    }
  }

  // 5. patch 兼容性检查
  const patchFile = join(profileDir, 'cordis.patch.yml')
  if (existsSync(patchFile)) {
    const patchText = readFileSync(patchFile, 'utf8')
    const rows = parsePatchRows()
    const disabledRows = rows.filter((r) => r.disabled === true)
    for (const dr of disabledRows) {
      if (bundles.includes(dr.id) || bundles.includes(dr.name)) {
        issues.push({
          type: 'disabled-in-patch',
          severity: 'info',
          message: '插件 "' + (dr.name || dr.id) + '" 在 cordis.patch.yml 中已禁用（若 bundle 仍存在，重启后可能重载）',
          id: dr.id || dr.name,
        })
      }
    }
  }

  return { ok: true, profile, bundles: bundles.length, issues }
}

// ============================================================
// P2：agent 运行中拒绝变更（基于活跃会话写入检测）
// ============================================================
const AGENT_ACTIVE_WINDOW_MS = 2 * 60 * 1000 // 最近 2 分钟有写入即视为 agent 活跃

export function isAgentRunning(profile) {
  try {
    const sessionDir = join(RUNTIME.dshHome, 'sessions')
    if (!existsSync(sessionDir)) return { running: false }
    const now = Date.now()
    let latestWrite = 0
    let latestId = null
    let totalSessions = 0

    // DSH 会话存储结构：sessions/<encoded-cwd>/session-<uuid>/session.jsonl.zstd
    for (const entry of readdirSync(sessionDir)) {
      const dir = join(sessionDir, entry)
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
      for (const sess of readdirSync(dir)) {
        const sessDir = join(dir, sess)
        if (!existsSync(sessDir) || !statSync(sessDir).isDirectory()) continue
        for (const file of readdirSync(sessDir)) {
          if (!file.startsWith('session.') || !file.endsWith('.zstd')) continue
          totalSessions += 1
          const st = statSync(join(sessDir, file))
          if (st.mtimeMs > latestWrite) {
            latestWrite = st.mtimeMs
            latestId = sess
          }
        }
      }
    }

    if (!totalSessions) return { running: false }
    // 若最近写入时间落在活跃窗口内，判定为 agent 正在运行
    if (now - latestWrite < AGENT_ACTIVE_WINDOW_MS) {
      return { running: true, sessionId: latestId, status: 'active', lastWriteMs: latestWrite }
    }
    return { running: false, lastWriteMs: latestWrite }
  } catch {
    return { running: false }
  }
}

// ============================================================
// P2：孤儿 store 清理
// ============================================================
export function cleanOrphanStore(profile) {
  const profileDir = join(RUNTIME.dshHome, 'profiles', profile)
  const nodeModules = join(profileDir, 'node_modules')
  if (!existsSync(nodeModules)) return { ok: true, cleaned: 0 }

  let cleaned = 0
  const entries = readdirSync(nodeModules)
  for (const entry of entries) {
    // 清理 pnpm 留下的临时目录
    if (entry.startsWith('_tmp_') || entry.startsWith('.tmp_')) {
      try {
        rmSync(join(nodeModules, entry), { recursive: true, force: true })
        cleaned++
      } catch { /* 目录可能被占用 */ }
    }
    // 清理空目录
    if (entry.startsWith('.')) continue
    const full = join(nodeModules, entry)
    try {
      if (existsSync(full) && readdirSync(full).length === 0) {
        rmSync(full, { recursive: true, force: true })
        cleaned++
      }
    } catch { /* 跳过 */ }
  }

  return { ok: true, cleaned }
}

// ============================================================
// P2：pnpm 错误双语提示 + -w 注入 + fetchTimeout
// ============================================================
const PNPM_ERROR_HINTS = {
  'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION': {
    zh: '软件包发布未满 14 天，pnpm 默认拒绝。已自动写入 minimumReleaseAgeExclude 到 pnpm-workspace.yaml 并重试',
    en: 'Package published less than 14 days ago. Autofixed via minimumReleaseAgeExclude in pnpm-workspace.yaml',
  },
  'ERR_PNPM_IGNORED_BUILDS': {
    zh: '构建被 pnpm 忽略。已自动写入 allowBuilds 到 pnpm-workspace.yaml 并重试',
    en: 'Builds ignored by pnpm. Autofixed via allowBuilds in pnpm-workspace.yaml',
  },
  'ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF': {
    zh: 'pnpm 公共 hoist 模式不一致。自动执行 pnpm install 重建依赖树',
    en: 'Public hoist pattern mismatch. Rebuilding dependency tree via pnpm install',
  },
  'ERR_PNPM_NO_PACKAGE': {
    zh: '包不存在或无法访问。请检查包名是否正确、网络是否通畅',
    en: 'Package not found or unreachable. Check package name and network connectivity',
  },
  'ETIMEDOUT': {
    zh: '网络连接超时。已自动重试一次',
    en: 'Connection timed out. Auto-retried once.',
  },
  'ECONNRESET': {
    zh: '网络连接被重置。已自动重试一次',
    en: 'Connection reset. Auto-retried once.',
  },
  'ENOTFOUND': {
    zh: 'DNS 解析失败。请检查网络连接',
    en: 'DNS resolution failed. Check your network connection.',
  },
  'ERR_PNPM_UNSUPPORTED_ENGINE': {
    zh: '包的 Node.js 版本不兼容。请尝试升级或降级 Node.js',
    en: 'Package requires a different Node.js version. Try upgrading/downgrading Node.js.',
  },
  'ERR_PNPM_OUTDATED_LOCKFILE': {
    zh: 'lockfile 版本过旧。自动执行 pnpm install --fix-lockfile',
    en: 'Lockfile outdated. Auto-fixing via pnpm install --fix-lockfile',
  },
}

export function getPnpmErrorHint(key, locale) {
  const hint = PNPM_ERROR_HINTS[key]
  if (!hint) return null
  return hint[locale === 'zh' ? 'zh' : 'en'] || hint.en
}

export function injectWFlag(cwd, args) {
  // 判断 pnpm-workspace.yaml 存在时自动加 -w
  if (existsSync(join(cwd, 'pnpm-workspace.yaml'))) {
    if (!args.includes('-w') && !args.includes('--workspace-root')) {
      args.push('-w')
    }
  }
  return args
}

export function buildEnvWithTimeout(mirror) {
  const env = buildEnv(mirror)
  // 增加 fetchTimeout 避免大 tarball 下载超时
  env['npm_config_fetch_timeout'] = '600000'
  env['COREPACK_ENABLE_STRICT'] = '0'
  env['PNPM_HIDE_VERBOSE_LOGS'] = 'false'
  return env
}