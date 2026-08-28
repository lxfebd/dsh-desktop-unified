/**
 * 把原生右键菜单接到主窗口的 webContents 上。复制/粘贴/选择全部走
 * Electron role（macOS 加速键依赖 Edit role 存在），复制链接/图片走
 * clipboard，打开链接交系统浏览器。
 * @module dsh-desktop/context-menu
 */

import { clipboard, Menu, shell, type BrowserWindow } from 'electron'
import { buildContextMenuTemplate } from './context-menu-template.js'

/**
 * 在窗口的 webContents 上安装 context-menu 监听并 popup 原生菜单。
 * 语言判定用谓词注入，调用方直接传主进程的 isZhLocale —— 菜单在每次
 * 右键时求值，避免早期（app-ready 前）缓存到错误语言。
 * @param window - 目标窗口
 * @param isZhLocale - 返回当前是否为中文环境的谓词
 */
export function installContextMenu(
  window: BrowserWindow,
  isZhLocale: () => boolean,
): void {
  window.webContents.on('context-menu', (_event, params) => {
    const template = buildContextMenuTemplate(params, isZhLocale() ? 'zh' : 'en', {
      openLink: (url) => {
        void shell.openExternal(url)
      },
      copyLink: (url) => clipboard.writeText(url),
      copyImage: () => {
        if (window.isDestroyed()) return
        window.webContents.copyImageAt(params.x, params.y)
      },
    })
    if (template.length === 0 || window.isDestroyed()) return
    Menu.buildFromTemplate(template).popup({ window })
  })
}
