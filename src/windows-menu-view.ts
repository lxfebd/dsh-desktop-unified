/**
 * Windows menu view geometry plus zoom isolation. The native
 * `Menu.setApplicationMenu` is drawn by the system and is unaffected by
 * webContents zoom, so this module focuses on two things:
 * `windowsMenuViewBounds` reserves the geometry for a future custom
 * WebContentsView menu, and `lockZoomFactor` pins overlay/splash content at
 * 1.0 so Ctrl± cannot break it.
 * @module dsh-desktop/windows-menu-view
 */

import type { Rectangle, WebContents } from 'electron'

/** Height of the custom Windows titlebar (mirrors shared/desktop-menu). */
export const WINDOWS_TITLEBAR_HEIGHT = 36
export const WINDOWS_CAPTION_CONTROLS_WIDTH = 140
export const WINDOWS_MENU_BUTTON_WIDTH = 44
export const WINDOWS_MENU_PANEL_WIDTH = 304
export const WINDOWS_MENU_PANEL_MAX_HEIGHT = 760

/** Content area the menu view is laid out against, in DIPs. */
interface ContentSize {
  width: number
  height: number
}

/**
 * Computes the bounds of the custom Windows menu view. Collapsed it occupies
 * only the menu button, expanded it occupies the panel; it is right-aligned
 * against the caption controls, which vanish in fullscreen.
 */
export function windowsMenuViewBounds(
  contentSize: ContentSize,
  menuOpen: boolean,
  fullscreen = false,
): Rectangle {
  const contentWidth = Math.max(0, Math.floor(contentSize.width))
  const contentHeight = Math.max(0, Math.floor(contentSize.height))
  const captionWidth = fullscreen ? 0 : Math.min(WINDOWS_CAPTION_CONTROLS_WIDTH, contentWidth)
  const availableWidth = Math.max(0, contentWidth - captionWidth)
  const requestedWidth = menuOpen ? WINDOWS_MENU_PANEL_WIDTH : WINDOWS_MENU_BUTTON_WIDTH
  const width = Math.min(requestedWidth, availableWidth)
  const height = menuOpen
    ? Math.min(WINDOWS_MENU_PANEL_MAX_HEIGHT, contentHeight)
    : Math.min(WINDOWS_TITLEBAR_HEIGHT, contentHeight)
  return {
    x: Math.max(0, contentWidth - captionWidth - width),
    y: 0,
    width,
    height,
  }
}

/**
 * Pins a webContents' zoom at 1.0. Overlays and the splash must not follow the
 * page's Ctrl±: any zoom request is immediately dialled back. No-ops silently
 * once the webContents is destroyed.
 */
export function lockZoomFactor(webContents: WebContents): void {
  const apply = (): void => {
    if (webContents.isDestroyed()) return
    try {
      webContents.setZoomFactor(1)
    } catch {
      // setZoomFactor can throw before the contents finish loading
    }
  }
  apply()
  webContents.on('did-start-loading', apply)
  // Electron reports a zoom *direction* here, not a factor: re-apply either way
  webContents.on('zoom-changed', apply)
}
