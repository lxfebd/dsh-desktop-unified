// dsh-plugin-version-manager · 核心逻辑
// 所有命令走「官方 dsh bin」，不另装 dsh 副本：
//   - 版本查询：npm view @deepseek-ai/dsh dist-tags
//   - 升级：npm install -g @deepseek-ai/dsh@<tag>
//   - 补丁：直接改安装树里的文件
'use strict'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const execFileP = promisify(execFile)

const NPM_BIN = process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : 'npm'
const NPM_ARGS = process.platform === 'win32' ? ['/c', 'npm'] : []

/** 内置 node 目录（桌面壳启动时前置到 PATH，并写入 BUNDLED_NODE_DIR） */
const BUNDLED_NODE = process.env.BUNDLED_NODE_DIR || ''

/** 解析 npm 执行方式：优先用内置 node 直接跑 npm-cli.js，避免依赖系统 npm */
function npmInvoke(args) {
  if (BUNDLED_NODE) {
    const cli = path.join(BUNDLED_NODE, 'node_modules', 'npm', 'bin', 'npm-cli.js')
    if (fs.existsSync(cli)) {
      return { bin: path.join(BUNDLED_NODE, 'node.exe'), args: [cli, ...args] }
    }
  }
  return { bin: NPM_BIN, args: [...NPM_ARGS, ...args] }
}

/** 查询官方两个通道的版本号 */
export async function queryTags() {
  try {
    const { bin, args } = npmInvoke(['view', '@deepseek-ai/dsh', 'dist-tags', '--json'])
    const { stdout } = await execFileP(bin, args, {
      timeout: 30000, windowsHide: true,
    })
    const tags = JSON.parse(stdout)
    return { latest: tags.latest || null, next: tags.next || null }
  } catch (e) {
    console.error('[dsh-plugin-version-manager] 查询版本失败', e.message)
    return { latest: null, next: null, error: String(e.message).slice(0, 200) }
  }
}

/** 找到已安装的 dsh 安装树根目录 */
export function findDshRoot() {
  if (process.env.DSH_INSTALL_ROOT && fs.existsSync(path.join(process.env.DSH_INSTALL_ROOT, 'lib', 'bin.js'))) {
    return process.env.DSH_INSTALL_ROOT
  }
  const wb = path.join(process.env.USERPROFILE || '', '.workbuddy', 'binaries', 'node', 'versions')
  try {
    for (const v of fs.readdirSync(wb)) {
      const candidate = path.join(wb, v, 'node_modules', '@deepseek-ai', 'dsh')
      if (fs.existsSync(path.join(candidate, 'lib', 'bin.js'))) return candidate
    }
  } catch (e) { /* ignore */ }
  try {
    const root = execFileSync(NPM_BIN, [...NPM_ARGS, 'root', '-g'], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).trim()
    const candidate = path.join(root, '@deepseek-ai', 'dsh')
    if (fs.existsSync(path.join(candidate, 'lib', 'bin.js'))) return candidate
  } catch (e) { /* ignore */ }
  return null
}

/** 当前安装版本 */
export function installedVersion() {
  const root = findDshRoot()
  if (!root) return ''
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || ''
  } catch (e) { console.error('[dsh-plugin-version-manager] 读取版本失败', e.message); return '' }
}

/** 从 dsh 包目录向上查找 node_modules，返回其父目录（安装前缀） */
function findInstallPrefix(pkgDir) {
  let dir = pkgDir
  for (let i = 0; i < 6; i++) {
    dir = path.dirname(dir)
    if (path.basename(dir) === 'node_modules') return path.dirname(dir)
  }
  return null
}

/** 升级 dsh 到指定通道。安装到实际运行目录（workbuddy 或全局），而非固定 npm 全局。 */
export async function upgradeTo(channel) {
  const tag = channel === 'explorer' ? 'next' : 'latest'
  const root = findDshRoot()
  if (!root) return { ok: false, error: '未找到已安装的 dsh' }
  // root = .../node_modules/@deepseek-ai/dsh；安装目标是 node_modules 的上级（node 版本根目录）
  const installDir = findInstallPrefix(root)
  if (!installDir) return { ok: false, error: '无法解析安装前缀' }
  return new Promise((resolve) => {
    const { bin, args } = npmInvoke(['install', '--prefix', installDir, `@deepseek-ai/dsh@${tag}`, '--no-audit', '--no-fund', '--progress=false'])
    const child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    child.on('error', (e) => resolve({ ok: false, error: 'npm 启动失败: ' + e.message }))
    child.on('close', (code) => {
      if (code === 0) {
        const root2 = findDshRoot()
        let version = ''
        try { version = JSON.parse(fs.readFileSync(path.join(root2, 'package.json'), 'utf8')).version } catch (e) { console.error('[dsh-plugin-version-manager] 升级后读取版本失败', e.message) }
        let applied = []
        try { applied = applyPatches(root2) } catch (e) { applied = [{ ok: false, error: e.message }] }
        resolve({ ok: true, version, applied })
      } else {
        const tail = out.split('\n').filter(Boolean).slice(-8).join('\n')
        resolve({ ok: false, error: `npm install 失败 (${code}): ${tail}` })
      }
    })
  })
}

// ---- 补丁（真正需要的只有 scope Symbol.for 一条）----
const PATCHES = [
  {
    id: 'scope-symbol-for',
    label: 'dsh-scope · Symbol.for 修复',
    file: ['../dsh-scope/lib/index.js', 'node_modules/@deepseek-ai/dsh-scope/lib/index.js'],
    detect: (c) => /Symbol\(\s*['"]dsh\.scope['"]\s*\)/.test(c) && !/Symbol\.for\(\s*['"]dsh\.scope['"]\s*\)/.test(c),
    apply: (c) => c.replace(/Symbol\(\s*(['"])dsh\.scope\1\s*\)/g, 'Symbol.for($1dsh.scope$1)'),
  },
]

/** 解析补丁目标文件：依次尝试候选相对路径，返回第一个存在的绝对路径 */
function resolvePatchFile(root, candidates) {
  for (const rel of candidates) {
    const fp = path.join(root, rel)
    if (fs.existsSync(fp)) return fp
  }
  return path.join(root, candidates[0])
}

export function checkPatches(root) {
  return PATCHES.map((p) => {
    const fp = resolvePatchFile(root, p.file)
    try {
      const content = fs.readFileSync(fp, 'utf8')
      return { id: p.id, label: p.label, patched: !p.detect(content) }
    } catch (e) {
      return { id: p.id, label: p.label, patched: false, error: '文件不存在: ' + e.code }
    }
  })
}

export function applyPatches(root) {
  return PATCHES.map((p) => {
    const fp = resolvePatchFile(root, p.file)
    try {
      const content = fs.readFileSync(fp, 'utf8')
      if (!p.detect(content)) return { id: p.id, label: p.label, ok: true, already: true }
      fs.writeFileSync(fp, p.apply(content), 'utf8')
      console.log('[dsh-plugin-version-manager] 补丁已应用:', p.id)
      return { id: p.id, label: p.label, ok: true, file: fp }
    } catch (e) {
      return { id: p.id, label: p.label, ok: false, error: e.message }
    }
  })
}