/**
 * Windows GPU 沙箱降级状态机。某些机器的 GPU 进程无法在沙箱内启动
 * （虚拟显示驱动叠 AMD 核显 → 0x80000003 → 渲染器随之死），加载页
 * ERR_FAILED。开关必须在 Chromium 启动前就位，故上次有效的级别落盘、
 * 下次启动前应用。降级非免费（丢 GPU 沙箱乃至硬件加速），故门槛高、
 * 且可回升：见 planGpuFallbackResponse / planStableLaunch。
 * @module dsh-desktop/gpu-fallback
 */

export type GpuFallbackLevel = 'default' | 'sandbox-disabled' | 'gpu-disabled'

export interface GpuFallbackState {
  level: GpuFallbackLevel
  /** 当前级别下、应用可用期间观测到的 GPU 丢失次数。 */
  failures: number
  /** 当前级别下未丢 GPU 进程的启动次数。 */
  stableLaunches: number
}

const levels: readonly GpuFallbackLevel[] = ['default', 'sandbox-disabled', 'gpu-disabled']

export const defaultGpuFallbackState: GpuFallbackState = {
  level: 'default',
  failures: 0,
  stableLaunches: 0,
}

/** 连续多少次 GPU 丢失才在「应用仍可用」时降级。单次崩溃不致丢沙箱。 */
export const GPU_FALLBACK_FAILURE_THRESHOLD = 3
/** 降级级别下多少次干净启动后，尝试回升一级。 */
export const GPU_FALLBACK_PROBE_LAUNCHES = 20

/** 不代表本机无法跑 GPU 沙箱的 GPU 进程退出原因（正常退出/被杀）。 */
const survivableReasons: ReadonlySet<string> = new Set(['clean-exit', 'killed'])

export function isGpuLossFatal(reason: string): boolean {
  return !survivableReasons.has(reason)
}

/** 每级保留上一级开关：丢了沙箱的机器关硬件加速后仍需丢沙箱。 */
export function gpuFallbackSwitches(level: GpuFallbackLevel): string[] {
  switch (level) {
    case 'default':
      return []
    case 'sandbox-disabled':
      return ['disable-gpu-sandbox']
    case 'gpu-disabled':
      return ['disable-gpu-sandbox', 'disable-gpu', 'disable-gpu-compositing']
  }
}

/**
 * 决定一次 GPU 进程丢失应改变什么。
 * - Harness 从未渲染 → 这次启动不可用：立即降级并 relaunch。
 * - Harness 已渲染 → GPU 进程会自恢复，仅在丢失累积越阈值后记录下一级别（不 relaunch，免丢用户工作）。
 * - 已到末级 → 不再 relaunch，避免永久坏 GPU 的机器无限重启。
 */
export function planGpuFallbackResponse(options: {
  state: GpuFallbackState
  harnessRendered: boolean
}): { state: GpuFallbackState; relaunch: boolean } {
  const { state, harnessRendered } = options
  const failures = state.failures + 1
  const next = levels[levels.indexOf(state.level) + 1]
  if (next === undefined) {
    return { state: { ...state, failures, stableLaunches: 0 }, relaunch: false }
  }
  if (!harnessRendered) {
    return { state: { level: next, failures: 0, stableLaunches: 0 }, relaunch: true }
  }
  if (failures < GPU_FALLBACK_FAILURE_THRESHOLD) {
    return { state: { ...state, failures, stableLaunches: 0 }, relaunch: false }
  }
  return { state: { level: next, failures: 0, stableLaunches: 0 }, relaunch: false }
}

/** 降级级别下连续干净启动到阈值后，回升一级。 */
export function planStableLaunch(state: GpuFallbackState): GpuFallbackState {
  if (state.level === 'default') return defaultGpuFallbackState
  const stableLaunches = state.stableLaunches + 1
  if (stableLaunches < GPU_FALLBACK_PROBE_LAUNCHES) {
    return { level: state.level, failures: 0, stableLaunches }
  }
  const previous = levels[levels.indexOf(state.level) - 1]
  return { level: previous ?? state.level, failures: 0, stableLaunches: 0 }
}

export function gpuFallbackStateEquals(a: GpuFallbackState, b: GpuFallbackState): boolean {
  return (
    a.level === b.level && a.failures === b.failures && a.stableLaunches === b.stableLaunches
  )
}

export function serializeGpuFallbackState(state: GpuFallbackState): string {
  return JSON.stringify(state)
}

function readCount(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0
}

export function parseGpuFallbackState(raw: string): GpuFallbackState {
  try {
    const parsed = JSON.parse(raw) as Partial<Record<keyof GpuFallbackState, unknown>>
    const level = parsed.level
    if (!levels.includes(level as GpuFallbackLevel)) return defaultGpuFallbackState
    return {
      level: level as GpuFallbackLevel,
      failures: readCount(parsed.failures),
      stableLaunches: readCount(parsed.stableLaunches),
    }
  } catch {
    return defaultGpuFallbackState
  }
}
