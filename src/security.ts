/**
 * 装配窗口级安全 handler。本项目是单窗口应用：setWindowOpenHandler
 * 对所有 window.open 返回 deny（受信任源也不再开新窗口），仅把
 * http(s) 外链交给系统浏览器。新增 will-attach-webview 阻断与
 * clipboard-sanitized-write 权限放行（受信任剪贴板写）。
 * @module dsh-desktop/security
 */

import { shell, type BrowserWindow } from 'electron'
import { canGrantWindowPermission, isTrustedAppUrl } from './security-policy.js'

/**
 * 给窗口装上导航与权限守卫：外链走系统浏览器、禁止附加 webview、
 * 放行主框架的受信任剪贴板写。会话级 handler 配在该窗口的 session 上，
 * 本项目只有这一个窗口，因此与全局默认会话等价。
 * @param window - 目标窗口
 */
export function secureWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (!isTrustedAppUrl(url) && (url.startsWith('https://') || url.startsWith('http://'))) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    if (isTrustedAppUrl(url)) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
  })
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      canGrantWindowPermission(
        permission,
        details.requestingUrl ?? requestingOrigin,
        details.isMainFrame,
      ),
  )
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(canGrantWindowPermission(permission, details.requestingUrl, details.isMainFrame))
    },
  )
}
