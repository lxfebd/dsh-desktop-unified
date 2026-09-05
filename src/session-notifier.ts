// src/session-notifier.ts — 会话完成检测（纯逻辑，无 Electron 依赖，可离线单测）。
// 上游 dsh 不在 stdout 输出会话完成标记（0.1.2-alpha 实测无），因此复用
// market.js isAgentRunning 同款的「会话文件 mtime 活跃窗口」探测：
//   - 轮询 $DSH_HOME/sessions/**/session-*/session.*
//   - 观察到新活跃（新会话或已有会话新写入）后，持续 quietMs 无新写入 → 完成
//   - 基线快照只建立认知不触发（避免应用启动就把陈旧会话当"完成"通知）
//   - 同一会话只通知一次；换会话后可再次通知
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

export interface SessionStamp {
  sessionId: string
  lastWriteMs: number
}

/** 扫描 sessions 目录，返回最近写入的会话与 mtime；无会话返回 undefined。 */
export function scanLatestSession(dshHome: string): SessionStamp | undefined {
  const sessionsDir = join(dshHome, 'sessions')
  if (!existsSync(sessionsDir)) return undefined
  let latest: SessionStamp | undefined
  try {
    for (const entry of readdirSync(sessionsDir)) {
      const dir = join(sessionsDir, entry)
      if (!existsSync(dir) || !statSync(dir).isDirectory()) continue
      for (const sess of readdirSync(dir)) {
        const sessDir = join(dir, sess)
        if (!existsSync(sessDir) || !statSync(sessDir).isDirectory()) continue
        for (const file of readdirSync(sessDir)) {
          if (!file.startsWith('session.')) continue
          const st = statSync(join(sessDir, file))
          if (!latest || st.mtimeMs > latest.lastWriteMs) {
            latest = { sessionId: sess, lastWriteMs: st.mtimeMs }
          }
        }
      }
    }
  } catch {
    return undefined
  }
  return latest
}

export interface SessionNotifierOptions {
  dshHome: string
  /** 观察到新活跃后，超过此时长无新写入视为会话完成 */
  quietMs?: number
  /** 轮询间隔 */
  pollMs?: number
  /** 可注入时钟（测试用） */
  now?: () => number
}

export interface SessionNotifier {
  onDone: (stamp: SessionStamp) => void
  start(): void
  stop(): void
}

const DEFAULTS = { quietMs: 90_000, pollMs: 5_000 }

export function createSessionNotifier(opts: SessionNotifierOptions): SessionNotifier {
  const quietMs = opts.quietMs ?? DEFAULTS.quietMs
  const pollMs = opts.pollMs ?? DEFAULTS.pollMs
  const now = opts.now ?? Date.now
  let timer: ReturnType<typeof setTimeout> | undefined
  let known: SessionStamp | undefined
  /** 最近一次观察到活跃的墙钟时刻（注入时钟）；驱动静止判定 */
  let lastActiveAt = 0
  let lastNotifiedId: string | undefined
  /** 已通知过的会话：换回该会话（恢复）不重复通知 */
  const notifiedIds = new Set<string>()
  const notifier: SessionNotifier = {
    onDone: () => {},
    start() {
      if (timer !== undefined) return
      const tick = () => {
        const stamp = scanLatestSession(opts.dshHome)
        if (stamp !== undefined) {
          const t = now()
          const isFirstSight = known === undefined
          const changed =
            isFirstSight ||
            stamp.sessionId !== known!.sessionId ||
            stamp.lastWriteMs > known!.lastWriteMs
          if (changed) {
            // 基线（首次观察）只建立认知不触发：启动时把陈旧会话当"完成"
            // 通知是误报。之后任何新活跃只刷新认知，同样不立即通知。
            known = stamp
            lastActiveAt = t
          } else if (stamp.sessionId !== lastNotifiedId && !notifiedIds.has(stamp.sessionId) && t - lastActiveAt >= quietMs) {
            // 自最近活跃起静默超过窗口 → 完成；同一会话只通知一次
            lastNotifiedId = stamp.sessionId
            notifiedIds.add(stamp.sessionId)
            notifier.onDone(stamp)
          }
        }
        timer = setTimeout(tick, pollMs)
      }
      timer = setTimeout(tick, pollMs)
    },
    stop() {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
      known = undefined
      lastActiveAt = 0
      lastNotifiedId = undefined
      notifiedIds.clear()
    },
  }
  return notifier
}