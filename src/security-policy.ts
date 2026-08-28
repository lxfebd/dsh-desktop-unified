/**
 * 窗口安全策略判定。受信任 URL = 本地 Harness（127.0.0.1/localhost）+
 * file: + dsh-recovery: 恢复页。clipboard-sanitized-write 仅对主框架、
 * 且请求来自 Harness 源时放行——这是「受信任剪贴板写」的核心。
 * @module dsh-desktop/security-policy
 */

/**
 * 是否为本地 Harness 服务的 HTTP 源。端口任意，只认回路地址，
 * 因此带查询串、带端口、localhost 变体都能识别。
 * @param rawUrl - 待判定的 URL
 */
function isHarnessUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
  } catch {
    return false
  }
}

/**
 * 是否为应用自身的受信任源：Harness 本地服务、file: 页面、
 * dsh-recovery: 恢复页。用于导航与 window.open 的守卫。
 * @param rawUrl - 待判定的 URL
 */
export function isTrustedAppUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'file:' || parsed.protocol === 'dsh-recovery:') return true
  } catch {
    return false
  }
  return isHarnessUrl(rawUrl)
}

/**
 * 是否放行某权限请求。目前只放行主框架、来自 Harness 源的
 * clipboard-sanitized-write —— 渲染层的「复制到剪贴板」依赖它，
 * 而子框架与外站继续被拒。
 * @param permission - Electron 权限名
 * @param requestingUrl - 发起请求的框架 URL
 * @param isMainFrame - 请求是否来自主框架
 */
export function canGrantWindowPermission(
  permission: string,
  requestingUrl: string | undefined,
  isMainFrame: boolean,
): boolean {
  return (
    permission === 'clipboard-sanitized-write' &&
    isMainFrame &&
    requestingUrl !== undefined &&
    isHarnessUrl(requestingUrl)
  )
}
