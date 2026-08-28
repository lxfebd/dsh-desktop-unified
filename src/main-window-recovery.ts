/**
 * 主窗口渲染器/GPU 崩溃后的重载决策。Windows 上 GPU 进程死后 Electron
 * 默认留黑屏，单次重载通常即愈；但同一原因反复触发时紧密循环重载只
 * 掩盖真问题并耗尽 GPU，故限流 + 设上限。
 * @module dsh-desktop/main-window-recovery
 */

export const MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS = 5_000
export const MAIN_WINDOW_RECOVERY_MAX_RELOADS = 3

/**
 * 渲染器/GPU 进程丢失后，主窗口是否还能安全 reload。
 * - 未重载过 → 立即重载。
 * - 冷却窗口内 → 不重载（防紧密循环）。
 * - 超过上限 → 不重载（转交 Harness 失败页而非硬敲 GPU）。
 */
export function shouldReloadAfterMainWindowRendererLoss(options: {
  now: number
  lastReloadAt: number
  reloadCount: number
  cooldownMs?: number
  maxReloads?: number
}): boolean {
  const cooldown = options.cooldownMs ?? MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS
  const maxReloads = options.maxReloads ?? MAIN_WINDOW_RECOVERY_MAX_RELOADS
  if (options.reloadCount >= maxReloads) return false
  if (options.lastReloadAt === 0) return true
  return options.now - options.lastReloadAt >= cooldown
}
