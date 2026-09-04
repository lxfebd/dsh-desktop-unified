// dsh-plugin-version-manager · 核心逻辑
// 所有命令走「官方 dsh bin / 内置 pnpm」，不另装 dsh 副本：
//   - 版本查询：npm view @deepseek-ai/dsh dist-tags
//   - 升级：对桌面实际运行的目录（桌面内置 dsh 或 workbuddy/全局）执行 install
//   - 补丁：已停用（历史版本直改安装树源码，违反核心原则，见 applyPatches）
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

/** 内置 pnpm 所在目录（桌面壳启动时写入 DSH_BUNDLED_PNPM_DIR，指向 @pnpm/exe 目录） */
const BUNDLED_PNPM_DIR = process.env.DSH_BUNDLED_PNPM_DIR || ''

/** 定位 pnpm 可执行文件（优先内置 pnpm，其次系统 PATH） */
function pnpmBin() {
  if (BUNDLED_PNPM_DIR) {
    const bin = path.join(BUNDLED_PNPM_DIR, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm')
    if (fs.existsSync(bin)) return { bin, args: [] }
  }
  return { bin: process.platform === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : 'pnpm', args: process.platform === 'win32' ? ['/c', 'pnpm'] : [] }
}

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

/** 桌面壳注入的捆绑 dsh 包目录（main.ts 设置 DSH_DESKTOP_BUNDLED_DSH，指向随应用分发的捆绑副本）。 */
function bundledDshRoot() {
  const p = process.env.DSH_DESKTOP_BUNDLED_DSH
  if (p && fs.existsSync(path.join(p, 'lib', 'bin.js'))) return p
  return null
}

/** 找到已安装的 dsh 安装树根目录：优先桌面捆绑副本（与桌面实际运行实例一致），否则外部 CLI/全局。 */
export function findDshRoot() {
  const bundled = bundledDshRoot()
  if (bundled) return bundled
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

/** 升级 dsh 到指定通道。安装到实际运行目录（桌面内置或 workbuddy/全局），而非固定 npm 全局。 */
export async function upgradeTo(channel) {
  const tag = channel === 'explorer' ? 'next' : 'latest'
  const root = findDshRoot()
  if (!root) return { ok: false, error: '未找到已安装的 dsh' }
  // root = .../node_modules/@deepseek-ai/dsh；安装目标是 node_modules 的上级（应用根目录或 node 版本根目录）
  const installDir = findInstallPrefix(root)
  if (!installDir) return { ok: false, error: '无法解析安装前缀' }
  const isBundled = bundledDshRoot() === root
  return new Promise((resolve) => {
    // 桌面内置 dsh：优先用内置 pnpm 更新应用内依赖，与桌面实际运行的捆绑实例保持一致
    const { bin, args } = isBundled ? pnpmBin() : npmInvoke([])
    // 两种包管理器的加依赖语法不同，混用会静默失败或报 Unknown options：
    //  - npm：`install --prefix <dir> <pkg>` 可加依赖；audit/fund 默认开启，用
    //    --no-audit --no-fund 关掉（这两个是 npm 专属开关，pnpm 不认识会直接报错）。
    //  - pnpm：`install <pkg>` 不会加依赖（静默 no-op），必须用 `add --dir <dir> <pkg>`；
    //    实测 pnpm add --dir 能把指定版本装进目标目录并写入其 package.json。
    const fullArgs = isBundled
      ? [...args, 'add', '--dir', installDir, `@deepseek-ai/dsh@${tag}`, '--progress=false']
      : [...args, 'install', '--prefix', installDir, `@deepseek-ai/dsh@${tag}`, '--no-audit', '--no-fund', '--progress=false']
    const child = spawn(bin, fullArgs, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d.toString() })
    child.stderr.on('data', (d) => { out += d.toString() })
    child.on('error', (e) => resolve({ ok: false, error: 'pnpm/npm 启动失败: ' + e.message }))
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
        resolve({ ok: false, error: `pnpm/npm install 失败 (${code}): ${tail}` })
      }
    })
  })
}

// ---- 补丁（H1 修复：不再直改 node_modules 源码）----
// 说明：原 scope-symbol-for 补丁通过 fs.writeFileSync 直接改写
// node_modules/@deepseek-ai/dsh-scope/lib/index.js，绕过官方 cordis.patch.yml 补丁层，
// 违反「不 fork、不改源码、补丁走官方补丁层」核心原则，且升级后会被覆盖。
// 此处停用该源码级补丁；如需符号共享修复，应通过官方补丁层 / 上游包修复，严禁恢复直改源码。
const PATCHES = []

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
  // H1：已停用源码级补丁，返回空列表（接口保持兼容，不执行任何写文件操作）
  return []
}