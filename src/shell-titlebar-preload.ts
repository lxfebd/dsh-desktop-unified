/**
 * 渲染进程 preload（外壳控制专用）：暴露 window.shell 给自绘标题栏按钮调用，
 * 并在 frameless 模式注入一个 36px 高、fixed 定位、最高 z-index 的拖拽标题栏
 * + 三按钮（最小化 / 最大化 / 关闭）。
 *
 * 设计为「自执行模块」：仅需在现有的 src/preload.ts 顶部追加一行
 *   import './shell-titlebar-preload.js'
 * 即可把本能力并入主 preload（Electron 单窗口仅支持一个 preload 文件，故必须合并，
 * 不能单独作为第二个 preload 注册）。本文件不动现有 window.dshDesktop 桥。
 * @module dsh-desktop/shell-titlebar-preload
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('shell', {
  minimize: (): void => { ipcRenderer.send('shell:window', { action: 'minimize' }) },
  toggleMaximize: (): void => { ipcRenderer.send('shell:window', { action: 'toggle-maximize' }) },
  close: (): void => { ipcRenderer.send('shell:window', { action: 'close' }) },
  getState: (): Promise<unknown> => ipcRenderer.invoke('shell:get-state'),
  onMaximizedChange: (cb: (maximized: boolean) => void): (() => void) => {
    const h = (_e: unknown, v: boolean): void => { cb(v) }
    ipcRenderer.on('shell:maximized', h as (...args: unknown[]) => void)
    return (): void => { ipcRenderer.removeListener('shell:maximized', h as (...args: unknown[]) => void) }
  },
  onFramelessChange: (cb: (frameless: boolean) => void): (() => void) => {
    const h = (_e: unknown, v: boolean): void => { cb(v) }
    ipcRenderer.on('shell:frameless', h as (...args: unknown[]) => void)
    return (): void => { ipcRenderer.removeListener('shell:frameless', h as (...args: unknown[]) => void) }
  },
})

const TITLEBAR_ID = 'dsh-shell-titlebar'

ipcRenderer.on('shell:frameless', (_e: unknown, frameless: boolean): void => {
  if (frameless) injectTitlebar()
  else removeTitlebar()
})

function injectTitlebar(): void {
  if (document.getElementById(TITLEBAR_ID)) return
  const ready = (): void => buildTitlebar()
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready)
  else ready()
}

function buildTitlebar(): void {
  if (document.getElementById(TITLEBAR_ID)) return
  const bar = document.createElement('div')
  bar.id = TITLEBAR_ID
  bar.setAttribute('style', [
    'position:fixed', 'top:0', 'left:0', 'right:0', 'height:36px', 'z-index:2147483647',
    'display:flex', 'align-items:center', 'justify-content:flex-end',
    'padding:0 8px', 'box-sizing:border-box',
    '-webkit-app-region:drag', 'user-select:none',
    'background:rgba(13,15,20,.72)', 'backdrop-filter:blur(8px)',
    'font:12px -apple-system,"Segoe UI",sans-serif', 'color:#e6e6e6',
  ].join(';'))
  const mkBtn = (label: string, action: string): HTMLButtonElement => {
    const b = document.createElement('button')
    b.textContent = label
    b.setAttribute('style', '-webkit-app-region:no-drag;border:none;background:transparent;color:#e6e6e6;width:40px;height:28px;cursor:pointer;font-size:14px;')
    b.addEventListener('click', () => ipcRenderer.send('shell:window', { action }))
    return b
  }
  // 'shell:maximized' 状态同步：用 ONE 全局 handler 驱动 DOM 里所有 toggle 按钮。
  // 原先每个按钮各自注册一个监听器，重建（frameless 切换）时旧监听器从不移除——
  // 泄漏的监听器会持续更新已脱离 DOM 的按钮。全局 handler 经阻止默认的
  // stale==false 检查后，只更新仍在文档中的按钮。
  const syncMaximize = (event: Event): void => {
    const ev = event as CustomEvent<{ maximized: boolean }>
    let stale = false
    document.querySelectorAll('.dsh-max-toggle').forEach((el) => {
      if (!el.isConnected) { stale = true; return }
      const btn = el as HTMLButtonElement
      btn.textContent = ev.detail.maximized ? '⧉' : '▢'
    })
    if (stale) event.preventDefault()
  }
  document.addEventListener('dsh:maximized', syncMaximize)
  ipcRenderer.on('shell:maximized', (_e: unknown, m: boolean) => {
    document.dispatchEvent(new CustomEvent('dsh:maximized', { detail: { maximized: m } }))
    // Also mark newly-built buttons with the latest state
    document.querySelectorAll('.dsh-max-toggle').forEach((el) => {
      if (el.isConnected) (el as HTMLButtonElement).textContent = m ? '⧉' : '▢'
    })
  })
  const mkToggle = (): HTMLButtonElement => {
    const b = document.createElement('button')
    b.className = 'dsh-max-toggle'
    b.textContent = '▢'
    b.setAttribute('style', '-webkit-app-region:no-drag;border:none;background:transparent;color:#e6e6e6;width:40px;height:28px;cursor:pointer;font-size:12px;')
    b.addEventListener('click', () => ipcRenderer.send('shell:window', { action: 'toggle-maximize' }))
    return b
  }
  bar.appendChild(mkBtn('—', 'minimize'))
  bar.appendChild(mkToggle())
  bar.appendChild(mkBtn('✕', 'close'))
  document.body.appendChild(bar)
}

function removeTitlebar(): void {
  document.getElementById(TITLEBAR_ID)?.remove()
}
