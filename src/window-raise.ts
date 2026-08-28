/**
 * Focus-preserving window raise. On macOS `BrowserWindow.show()` also focuses,
 * activating this app over whatever the user is currently using;
 * `showInactive()` is the path that leaves the foreground app alone. Automatic
 * triggers (activate, second-instance) take the non-stealing path, while an
 * explicit user action keeps the plain restore/show/focus sequence.
 * @module dsh-desktop/window-raise
 */

/** Minimal window surface needed to raise a window. */
export interface RaiseableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  showInactive(): void
  focus(): void
}

/** Whether the raise came from the user or from the app itself. */
export type WindowFocusIntent = 'automatic' | 'user'

/**
 * Brings a window forward. On macOS an automatic raise while this app is not
 * active uses `showInactive()` so the user's current app keeps focus; every
 * other combination restores, shows and focuses as before.
 */
export function raiseWindowWithoutStealingFocus(
  window: RaiseableWindow,
  platform: NodeJS.Platform,
  isAppActive: () => boolean,
  intent: WindowFocusIntent = 'automatic',
): void {
  if (window.isDestroyed()) return
  if (platform === 'darwin' && intent === 'automatic' && !isAppActive()) {
    window.showInactive()
    return
  }
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}
