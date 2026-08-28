/**
 * Renderer-exposed, capability-scoped surface. Runs in the dsh web UI's
 * renderer under `contextIsolation: true`, so the page cannot reach Node or
 * tamper with the bindings — only `window.dshDesktop` is visible, and every
 * method is one of the whitelisted `bridge:method` channels. There is no
 * shell, fs, or url entry point to escalate through.
 * @module dsh-desktop/preload
 */

// 外壳控制预load（自绘标题栏 + shell:window/shell:get-state 桥）合并进主 preload。
// Electron 单窗口仅支持一个 preload 文件，故以模块导入方式并入，而非单独注册。
import './shell-titlebar-preload.js'
import { contextBridge, ipcRenderer } from 'electron'
import { BRIDGE_CHANNELS, type BridgeName } from './capabilities.js'

function makeBridge(bridge: BridgeName): Record<string, (...args: unknown[]) => Promise<unknown>> {
  const api: Record<string, (...args: unknown[]) => Promise<unknown>> = {}
  for (const method of BRIDGE_CHANNELS[bridge]) {
    api[method] = (...args: unknown[]) => ipcRenderer.invoke(`${bridge}:${method}`, ...args)
  }
  return api
}

contextBridge.exposeInMainWorld('dshDesktop', {
  desktopPrefs: makeBridge('desktopPrefs'),
  logs: makeBridge('logs'),
  releases: makeBridge('releases'),
  externalTools: makeBridge('externalTools'),
})
