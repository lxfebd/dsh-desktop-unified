/**
 * The single source of truth for what the Host exposes to web content. Every
 * preload binding and every ipcMain handler is generated from this map, so a
 * capability that is not listed here cannot be reached from the renderer —
 * there is no generic shell/fs/url bridge to escalate through.
 * @module dsh-desktop/capabilities
 */

export type BridgeName = 'desktopPrefs' | 'logs' | 'releases' | 'externalTools'

export const BRIDGE_CHANNELS: Record<BridgeName, readonly string[]> = {
  desktopPrefs: ['get', 'set'],
  logs: ['tail', 'reveal'],
  releases: ['list'],
  externalTools: ['list', 'add', 'remove', 'connect', 'disconnect', 'projected'],
}

/** Names that must never appear as a bridge — they would grant generic power. */
export const FORBIDDEN_CAPABILITIES = ['shell', 'exec', 'spawn', 'openUrl', 'fs', 'process'] as const

/**
 * Assert a (bridge, method) pair is on the allow-list. ipcMain handlers call
 * this before dispatching, so a renderer that somehow synthesizes an unknown
 * channel gets a hard rejection instead of a capability it should not have.
 */
export function assertCapabilityAllowed(bridge: string, method: string): void {
  const allowed = BRIDGE_CHANNELS[bridge as BridgeName]
  if (!allowed || !allowed.includes(method)) {
    throw new Error(`capability not allowed: ${bridge}.${method}`)
  }
}
