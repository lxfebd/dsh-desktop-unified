/**
 * 外壳图标系统：把 build/ 白名单内的图标应用到窗口/任务栏，持久化到
 * dsh-home/shell/icon/，并更新 Windows 快捷方式（.lnk）的 IconLocation。
 * PNG→多尺寸 ICO 用 nativeImage 纯 node 组装（不依赖 PowerShell / 外部库）。
 * exe 文件图标不改（运行时不可改，需重打包）。
 * @module dsh-desktop/shell-icon
 */

import { app, BrowserWindow, nativeImage } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-home')
}

/** 图标专用目录。 */
function iconDir(): string {
  const d = join(dshHome(), 'shell', 'icon')
  mkdirSync(d, { recursive: true })
  return d
}

function currentPng(): string {
  return join(iconDir(), 'current.png')
}

function currentIco(): string {
  return join(iconDir(), 'current.ico')
}

function metaFile(): string {
  return join(iconDir(), 'meta.json')
}

function logFile(): string {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'dsh.log')
}

/** 应用 build/ 目录（dev 模式为源码 build/，打包后为 app.asar/build/）。 */
function buildDir(): string {
  return join(app.getAppPath(), 'build')
}

/** 图标元数据（持久化在 meta.json）。 */
export interface IconMeta {
  source: 'build' | 'default'
  fileName: string | null
  appliedAt: string | null
}

/** 读取图标元数据；文件损坏/缺失时回退默认。 */
export function readIconMeta(): IconMeta {
  try {
    return {
      source: 'default', fileName: null, appliedAt: null,
      ...(JSON.parse(readFileSync(metaFile(), 'utf8')) as Partial<IconMeta>),
    }
  } catch {
    return { source: 'default', fileName: null, appliedAt: null }
  }
}

/** 校验 path 解析到 build/ 目录内（防路径穿越）。 */
function isInsideBuild(p: string): boolean {
  const abs = isAbsolute(p) ? p : resolve(p)
  const rel = relative(buildDir(), abs)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** 用 nativeImage 把 PNG 缩放为多尺寸，组装成 ICO（嵌入 PNG 数据，Vista+ 支持）。 */
function buildIcoFromPng(pngPath: string): { ok: boolean; error?: string } {
  try {
    const sizes = [16, 32, 48, 64, 128, 256]
    const base = nativeImage.createFromPath(pngPath)
    const blobs: { size: number; data: Buffer }[] = []
    for (const size of sizes) {
      const img = base.resize({ width: size, height: size })
      blobs.push({ size, data: img.toPNG() })
    }
    const count = blobs.length
    const header = Buffer.alloc(6)
    header.writeUInt16LE(0, 0) // reserved
    header.writeUInt16LE(1, 2) // type = icon
    header.writeUInt16LE(count, 4)
    const dirSize = 16 * count
    const entries: Buffer[] = []
    const datas: Buffer[] = []
    let offset = 6 + dirSize
    for (const { size, data } of blobs) {
      const e = Buffer.alloc(16)
      e.writeUInt8(size >= 256 ? 0 : size, 0) // width (0 = 256)
      e.writeUInt8(size >= 256 ? 0 : size, 1) // height (0 = 256)
      e.writeUInt8(0, 2) // color palette
      e.writeUInt8(0, 3) // reserved
      e.writeUInt16LE(1, 4) // color planes
      e.writeUInt16LE(32, 6) // bits per pixel
      e.writeUInt32LE(data.length, 8) // image bytes
      e.writeUInt32LE(offset, 12) // offset to image
      entries.push(e)
      datas.push(data)
      offset += data.length
    }
    writeFileSync(currentIco(), Buffer.concat([header, ...entries, ...datas]))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Windows shortcut (.lnk) maintenance: point every shortcut that LAUNCHES THIS
 * APP at the current icon. Only shortcuts whose target resolves to our own
 * executable are touched — a shortcut with the same name for some other
 * DeepSeek tool keeps its icon. Fails loud on spawn errors instead of
 * reporting success: the old script was a PowerShell parse error (bare string
 * piped to -Filter), so shortcuts were never updated and the failure was
 * silently reported as applied.
 */
function updateShortcuts(): { ok: boolean; applied: string[]; warning?: string } {
  if (process.platform !== 'win32') {
    return { ok: true, applied: [], warning: '非 Windows，跳过快捷方式' }
  }
  const home = app.getPath('home')
  const targets = [
    join(home, 'Desktop'),
    join(home, 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    join('C:', 'ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ].filter(existsSync)
  if (targets.length === 0) return { ok: true, applied: [], warning: '未找到桌面或开始菜单目录' }
  const ps =
    `$ErrorActionPreference = 'Stop'\n` +
    `$targets = @(${targets.map((t) => `'${t.replace(/'/g, "''")}'`).join(',')})\n` +
    `$appExe = '${process.execPath.replace(/'/g, "''")}'\n` +
    `$ico = '${currentIco().replace(/'/g, "''")}'\n` +
    `$fixed = @()\n` +
    `foreach ($dir in $targets) {\n` +
    `  Get-ChildItem -LiteralPath $dir -Filter *.lnk -Recurse -ErrorAction SilentlyContinue | ForEach-Object {\n` +
    `    try {\n` +
    `      $lnk = $ws.CreateShortcut($_.FullName)\n` +
    `      if ($lnk.TargetPath -eq $appExe) {\n` +
    `        $lnk.IconLocation = "$ico,0"\n` +
    `        $lnk.Save()\n` +
    `        $fixed += $_.FullName\n` +
    `      }\n` +
    `    } catch {}\n` +
    `  }\n` +
    `}\n` +
    `$fixed | Out-String | Write-Output\n`
  const exe = existsSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    : 'powershell'
  const r = spawnSync(exe, ['-NoProfile', '-Command', ps], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', windowsHide: true })
  if (r.error) {
    return { ok: false, applied: [], warning: '调用 PowerShell 失败: ' + r.error.message }
  }
  if (r.status !== 0) {
    return { ok: false, applied: [], warning: `PowerShell 快捷方式更新失败 (exit ${r.status}): ${String(r.stderr ?? '').trim().slice(0, 300)}` }
  }
  const fixed = String(r.stdout ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
  return { ok: true, applied: fixed }
}

/**
 * 应用图标：校验 build/ 白名单 → 存 current.png → 组装 current.ico → win.setIcon → 改快捷方式。
 * @param path 图标文件路径（必须位于 build/ 白名单内）
 * @param win 目标窗口（可为 undefined，仅持久化不应用）
 */
export async function applyShellIcon(
  path: string | undefined,
  win: BrowserWindow | undefined,
): Promise<{ ok: boolean; applied?: string[]; warning?: string; error?: string }> {
  if (!path) return { ok: false, error: '缺少 path' }
  if (!isInsideBuild(path)) return { ok: false, error: '图标路径必须在 build/ 目录内' }
  const abs = isAbsolute(path) ? path : resolve(path)
  if (!existsSync(abs)) return { ok: false, error: '图标文件不存在: ' + abs }
  try {
    writeFileSync(currentPng(), readFileSync(abs))
  } catch (e) {
    return { ok: false, error: '写入 current.png 失败: ' + (e instanceof Error ? e.message : String(e)) }
  }
  const ico = buildIcoFromPng(currentPng())
  const meta: IconMeta = { source: 'build', fileName: abs, appliedAt: new Date().toISOString() }
  writeFileSync(metaFile(), JSON.stringify(meta, undefined, 2) + '\n')
  if (win && !win.isDestroyed()) {
    try {
      win.setIcon(nativeImage.createFromPath(currentPng()))
    } catch (e) {
      appendFileSync(logFile(), `\n=== setIcon failed: ${e instanceof Error ? e.message : String(e)} ===\n`)
    }
  }
  const sc = updateShortcuts()
  const applied = ['window', 'taskbar']
  if (sc.ok && sc.applied.length > 0) applied.push('shortcut')
  const warning =
    !ico.ok
      ? 'ICO 转换失败，仅窗口/任务栏生效（' + ico.error + '）'
      : sc.warning
  return { ok: true, applied, warning }
}

/** 恢复默认图标：删 meta + current，窗口恢复 devIcon（打包后为 baked-in 图标）。 */
export async function resetShellIcon(
  win: BrowserWindow | undefined,
): Promise<{ ok: boolean; warning?: string }> {
  try {
    writeFileSync(metaFile(), JSON.stringify({ source: 'default', fileName: null, appliedAt: new Date().toISOString() }) + '\n')
  } catch { /* 忽略 */ }
  if (win && !win.isDestroyed()) {
    const di = devIconFile()
    if (di && existsSync(di)) {
      try { win.setIcon(nativeImage.createFromPath(di)) } catch { /* 忽略 */ }
    }
  }
  const sc = updateShortcuts()
  return { ok: true, warning: sc.warning }
}

/** Dev 模式下的内置图标文件（与 main.ts 的 devIcon 同源）。 */
function devIconFile(): string | undefined {
  const f = join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(f) ? f : undefined
}

/** 启动恢复：读 meta，有自定义图标则 win.setIcon 恢复 + 同步快捷方式。 */
export function ensureShellIcon(win: BrowserWindow | undefined): void {
  const meta = readIconMeta()
  if (meta.source === 'default' || !existsSync(currentPng())) return
  if (win && !win.isDestroyed()) {
    try { win.setIcon(nativeImage.createFromPath(currentPng())) } catch { /* 忽略 */ }
  }
  updateShortcuts()
}
