/**
 * GitHub Releases 拉取：查询最新发布、比较版本、按平台挑选安装包并下载。
 *
 * 与 electron-updater 互补：electron-updater 在 Windows 上后台自动下载，
 * 但它依赖 publish 配置正确、构建签名与 CDN 重定向；本模块提供用户显式的
 * 「从 GitHub 拉取更新」路径——无需签名、不依赖 latest.yml，macOS 未签名
 * 构建同样可用。纯逻辑（fetch 可注入、下载写文件带进度），无 Electron
 * 依赖，可离线单测。
 * @module dsh-desktop/github-releases
 */

import { createWriteStream, mkdirSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import { gt, valid } from 'semver'

/** GitHub Release 的一个资产文件（安装包等）。 */
export interface GitHubReleaseAsset {
  name: string
  /** 直接下载 URL（browser_download_url）。 */
  url: string
  size: number
}

/** GitHub Release 的摘要视图。 */
export interface GitHubRelease {
  /** 如 `v0.1.2-rc.1.202609041312`。 */
  tag: string
  /** 去掉 `v` 前缀的版本号。 */
  version: string
  name: string
  publishedAt: string
  /** Release 正文（变更说明），可能为空字符串。 */
  notes: string
  assets: GitHubReleaseAsset[]
}

export interface GitHubReleaseOptions {
  /** 形如 `owner/repo`。 */
  repo: string
  /** 可注入的 fetch 实现（测试用）；默认 globalThis.fetch。 */
  fetchImpl?: typeof fetch
  /** API 请求超时（毫秒）。 */
  timeoutMs?: number
}

/** 去掉 tag 的 v 前缀（`v1.2.3` → `1.2.3`）。 */
export function normalizeVersion(v: string): string {
  return v.trim().replace(/^v/i, '')
}

/**
 * 远端版本是否比当前版本新。版本号可带 prerelease（`0.1.2-rc.1.202609041312`）：
 * 双方都能用 semver 解析时按 semver 规则比较（prerelease 段同样参与）；任一方
 * 解析失败则退回字典序比较（如 tag 丢失）。
 */
export function isNewerRemote(remoteVersion: string, currentVersion: string): boolean {
  const r = normalizeVersion(remoteVersion)
  const c = normalizeVersion(currentVersion)
  if (r === c) return false
  if (valid(r) && valid(c)) return gt(r, c)
  return r > c
}

/**
 * 查询仓库的最新非 draft/pre 发布。GitHub API 未认证有 60 次/时限制，
 * 足够桌面端使用；失败会抛带状态的错误，由调用方提示。
 */
export async function fetchLatestRelease(opts: GitHubReleaseOptions): Promise<GitHubRelease> {
  const f = opts.fetchImpl ?? fetch
  const url = `https://api.github.com/repos/${opts.repo}/releases/latest`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000)
  try {
    const res = await f(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-desktop' },
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`GitHub API ${res.status} (${url})`)
    const data = (await res.json()) as {
      tag_name?: unknown
      name?: unknown
      published_at?: unknown
      body?: unknown
      assets?: Array<{ name?: unknown; browser_download_url?: unknown; size?: unknown }>
    }
    if (typeof data.tag_name !== 'string' || data.tag_name === '') {
      throw new Error(`GitHub 返回的 release 缺少 tag_name (${url})`)
    }
    const assets = Array.isArray(data.assets)
      ? data.assets
          .filter((a) => typeof a?.name === 'string' && typeof a?.browser_download_url === 'string')
          .map((a) => ({
            name: a!.name as string,
            url: a!.browser_download_url as string,
            size: typeof a!.size === 'number' ? a!.size : 0,
          }))
      : []
    return {
      tag: data.tag_name,
      version: normalizeVersion(data.tag_name),
      name: typeof data.name === 'string' ? data.name : data.tag_name,
      publishedAt: typeof data.published_at === 'string' ? data.published_at : '',
      notes: typeof data.body === 'string' ? data.body : '',
      assets,
    }
  } finally {
    clearTimeout(timer)
  }
}

/** 按优先级匹配安装包的资产；无匹配返回 undefined。 */
function assetPatterns(platform: NodeJS.Platform): RegExp[] {
  if (platform === 'win32') return [/-setup\.exe$/i, /\.exe$/i]
  if (platform === 'darwin') return [/\.dmg$/i, /\.zip$/i]
  return [/\.(dmg|zip|appimage)$/i]
}

/** 为一个平台挑选安装包资产（win32 → setup.exe；darwin → dmg 优先，zip 兜底）。 */
export function pickInstallerAsset(
  release: GitHubRelease,
  platform: NodeJS.Platform = process.platform,
): GitHubReleaseAsset | undefined {
  for (const pattern of assetPatterns(platform)) {
    const hit = release.assets.find((a) => pattern.test(a.name))
    if (hit) return hit
  }
  return undefined
}

export interface DownloadProgress {
  received: number
  /** 总字节数；响应头无 Content-Length 时为 0。 */
  total: number
  /** 0–100；total 未知时为 -1。 */
  percent: number
}

export interface DownloadAssetOptions {
  fetchImpl?: typeof fetch
  /** 进度回调（下载线程内触发）。 */
  onProgress?: (p: DownloadProgress) => void
  /** 每次完整百分比需要多少次回调后节流（默认每 10 个百分点）。 */
  progressStep?: number
}

/**
 * 把 release 资产下载到 destDir，返回落盘路径。流式写入，不把整个文件
 * 载入内存；`onProgress` 以固定步长回调（避免每 chunk 都触发）。
 */
export async function downloadAsset(
  asset: GitHubReleaseAsset,
  destDir: string,
  opts: DownloadAssetOptions = {},
): Promise<string> {
  const f = opts.fetchImpl ?? fetch
  mkdirSync(destDir, { recursive: true })
  const outPath = join(destDir, asset.name)
  const res = await f(asset.url, { headers: { 'User-Agent': 'dsh-desktop' }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`下载失败 (HTTP ${res.status}): ${asset.name}`)
  const total = Number(res.headers.get('content-length')) || asset.size || 0
  const reader = res.body.getReader()
  const file = createWriteStream(outPath)
  const push = (received: number): void => {
    if (!opts.onProgress) return
    const percent = total > 0 ? Math.round((received / total) * 100) : -1
    opts.onProgress({ received, total, percent })
  }
  const step = opts.progressStep ?? 10
  let received = 0
  let lastReported = -1
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (!file.write(Buffer.from(value))) await once(file, 'drain')
      const delta = total > 0 ? Math.floor((received / total) * 100) : -1
      if (delta >= 0 && delta >= lastReported + step) {
        lastReported = delta
        push(received)
      }
    }
    file.end()
    await once(file, 'finish')
    push(received)
    return outPath
  } catch (error) {
    file.destroy()
    throw error
  }
}

/** 供 main.ts 直接使用的便捷类型。 */