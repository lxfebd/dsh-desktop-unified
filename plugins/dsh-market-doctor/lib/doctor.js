// dsh-market-doctor · 体检逻辑（纯函数：把已经拿到的数据换算成分级结论）
//
// 为什么要有这个插件：本机上一次排查市场问题时，全部结论都是手工 curl 出来的
// —— 哪些插件可更新、预置插件到底挂上没有、有没有插件被 running-agent 守卫挡回、
// 安全模式的回滚快照存不存在。这些判断每次都要重做一遍，这里固化成一次调用。
//
// 结论只从证据来：每条 finding 都带 evidence，拿不到的数据就明说拿不到，不猜。

/**
 * 桌面壳预置插件清单，镜像 src/main.ts 的 PRESET_PLUGINS。
 * 重复是有意的（插件看不到壳的常量），但漂移会被 tests/preset-list-sync.test.ts 抓住。
 */
export const PRESET_PLUGIN_NAMES = [
  'dshmarket',
  'dsh-plugin-version-manager',
  'dsh-shell-control',
  'dsh-desktop-preset-transfer',
  'dsh-terminal',
  'dsh-market-tools',
  'dsh-plugin-snapshot',
  'dsh-market-doctor',
]

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info']

function finding(severity, code, message, evidence) {
  const item = { severity, code, message }
  if (evidence !== undefined) item.evidence = evidence
  return item
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((x) => typeof x === 'string' && x !== '')
  if (typeof value === 'string') return value.split(',').map((x) => x.trim()).filter((x) => x !== '')
  return []
}

/**
 * 市场自己的日志（profiles/<profile>/.dsh-market/log.ndjson）：
 * 行形状 { at, level, event, detail }，实测事件有 install-blocked / update-blocked /
 * uninstall-blocked / install-rejected / region。坏行跳过，不影响整体。
 */
export function parseMarketLog(text, { days = 14, limit = 12, now = new Date() } = {}) {
  const events = []
  for (const line of String(text ?? '').split('\n')) {
    if (line.trim() === '') continue
    try {
      const entry = JSON.parse(line)
      if (entry && typeof entry.event === 'string') events.push(entry)
    } catch {
      // 半行/编码问题不影响其余事件
    }
  }
  const cutoff = now.getTime() - Math.max(0, days) * 86400000
  const recent = events.filter((e) => {
    const at = Date.parse(typeof e.at === 'string' ? e.at : '')
    return Number.isFinite(at) ? at >= cutoff : false
  })
  const counts = {}
  for (const e of recent) counts[e.event] = (counts[e.event] ?? 0) + 1
  return {
    total: events.length,
    recent: recent.length,
    windowDays: days,
    counts,
    latest: recent.slice(-Math.max(1, limit)).reverse().map((e) => ({
      at: e.at,
      level: e.level ?? null,
      event: e.event,
      detail: typeof e.detail === 'string' ? e.detail.slice(0, 200) : null,
    })),
  }
}

/** 目录多久没更新过（registry.updated 是收录时间戳）；不满一天算 0，不四舍五入往上抬。 */
export function catalogAgeDays(updated, now = new Date()) {
  const at = Date.parse(typeof updated === 'string' ? updated : '')
  if (!Number.isFinite(at) || !Number.isFinite(now.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - at) / 86400000))
}

/**
 * 汇总成一份体检报告。所有输入都是"已经拿到的东西"，undefined 表示这项没查到，
 * 报告里会落成 info 而不是编一个结论。
 */
export function diagnose({
  installed,
  capabilities,
  updates,
  registry,
  log,
  snapshots,
  runningAgents,
  presetExpect = PRESET_PLUGIN_NAMES,
  npmLatest,
  now = new Date(),
} = {}) {
  const findings = []

  if (!installed || typeof installed !== 'object') {
    findings.push(finding('critical', 'market-unreachable',
      '市场路由没有回答，后面的结论都无从谈起。先确认 dshmarket 在这个 profile 里活着、且 webServer 已就绪。'))
    return finalize(findings, { profile: capabilities?.profile ?? null, marketVersion: capabilities?.marketVersion ?? null })
  }

  const profile = typeof installed.profile === 'string' ? installed.profile : (capabilities?.profile ?? null)
  const present = asArray(installed.present)
  const presentSet = new Set(present)

  // 壳预置的插件不在 present 里：这些工具位（market_* / 外壳控制 / 版本管理）此刻其实不可用。
  const missingPresets = asArray(presetExpect).filter((name) => !presentSet.has(name))
  if (missingPresets.length > 0) {
    findings.push(finding('high', 'preset-missing',
      `桌面壳预置的插件没有出现在本 profile 的已安装列表里，它们提供的工具位现在不可用（改壳或重启前，别指望这些工具存在）。`,
      { missing: missingPresets, expectedFrom: 'PRESET_PLUGIN_NAMES（镜像 src/main.ts PRESET_PLUGINS）', profile }))
  }

  const broken = installed.brokenPlugins
  if (broken && typeof broken === 'object' && Object.keys(broken).length > 0) {
    findings.push(finding('critical', 'broken-plugins',
      '有插件声明了但加载不起来，启动列表与实际文件已经不一致。', { brokenPlugins: broken }))
  }

  const unbundled = asArray(installed.unbundled)
  if (unbundled.length > 0) {
    findings.push(finding('high', 'unbundled',
      '这些插件在依赖里，但不在启动列表（bundles）里：装了却没启用。', { unbundled }))
  }

  const disabled = [...asArray(installed.disabled), ...asArray(installed.patchDisabled)]
  if (disabled.length > 0) {
    findings.push(finding('low', 'disabled', '这些插件被停用（市场开关或补丁层），重启后仍保持关闭。', { disabled }))
  }

  const forced = asArray(installed.patchForced)
  if (forced.length > 0) {
    findings.push(finding('low', 'patch-forced',
      '这些插件被补丁层强制开启：市场里的开关关不掉它们，要改的是补丁层。', { forced }))
  }

  if (updates && typeof updates === 'object') {
    const updatable = Number.isFinite(updates.updatable) ? updates.updatable : asArray(updates.packages).length
    const packages = Array.isArray(updates.packages) ? updates.packages.slice(0, 20).map((p) => ({
      name: p?.name, installedVersion: p?.installedVersion ?? p?.installed ?? null, latestVersion: p?.latestVersion ?? p?.latest ?? null,
    })) : []
    if (updatable > 0) {
      findings.push(finding('medium', 'updatable',
        `${updatable} 个插件有更新可用（共检查 ${updates.checked ?? packages.length} 个）。`, { packages }))
    }
  } else {
    findings.push(finding('info', 'updates-unknown',
      '没拿到可更新清单（capabilities 里 updatesSummary 不可用，或这次没查）。'))
  }

  if (snapshots) {
    if (!snapshots.exists || snapshots.count === 0) {
      findings.push(finding('high', 'no-snapshots',
        '安全模式/托盘的「回滚到最后一次良好状态」没有任何快照可回——写侧插件没装或还没写过任何一份。',
        { dir: snapshots.dir, count: snapshots.count ?? 0 }))
    } else {
      findings.push(finding('info', 'snapshots-ok',
        `回滚快照有 ${snapshots.count} 份，最新 ${snapshots.latest ?? '未知'}。`, { dir: snapshots.dir }))
    }
  } else {
    findings.push(finding('info', 'snapshots-unknown', '没读到快照目录（profile 目录无法确定时会是这样）。'))
  }

  if (registry && typeof registry === 'object') {
    const age = catalogAgeDays(registry.updated ?? registry.catalogUpdated, now)
    const total = Number.isFinite(registry.total) ? registry.total : asArray(registry.plugins).length
    if (age !== null && age > 7) {
      findings.push(finding('medium', 'catalog-stale', `精选目录已 ${age} 天没更新（共 ${total} 条）。`, { ageDays: age, total }))
    } else {
      findings.push(finding('info', 'catalog-fresh', `精选目录 ${total} 条，${age ?? '未知'} 天前更新。`, { ageDays: age, total }))
    }
  }

  if (Array.isArray(runningAgents) && runningAgents.length > 0) {
    findings.push(finding('info', 'guard-busy',
      `现在有 ${runningAgents.length} 个 agent 在跑：这段时间市场会拒绝装/卸/更新（409）。`, { runningAgents }))
  }

  if (log) {
    const blocked = (log.counts?.['install-blocked'] ?? 0) + (log.counts?.['update-blocked'] ?? 0) + (log.counts?.['uninstall-blocked'] ?? 0)
    const rejected = log.counts?.['install-rejected'] ?? 0
    if (blocked > 0) {
      findings.push(finding('medium', 'mutations-blocked',
        `最近 ${log.windowDays} 天有 ${blocked} 次装卸/更新被 running-agent 守卫挡回。要么在空闲时段做，要么用带等待的安装工具。`,
        { counts: log.counts, latest: log.latest.slice(0, 5) }))
    }
    if (rejected > 0) {
      findings.push(finding('low', 'install-rejected',
        `最近 ${log.windowDays} 天有 ${rejected} 次安装被目录校验拒绝（url 不在精选目录里）。自己写的插件走不了市场安装，得用 file:/link: 依赖或提交收录。`,
        { counts: log.counts }))
    }
  } else {
    findings.push(finding('info', 'log-unavailable', '没读到市场日志（profiles/<profile>/.dsh-market/log.ndjson）。'))
  }

  if (typeof npmLatest === 'string' && npmLatest !== '' && capabilities?.marketVersion && npmLatest !== capabilities.marketVersion) {
    findings.push(finding('medium', 'market-version-drift',
      `本机 dshmarket ${capabilities.marketVersion}，npm 上最新 ${npmLatest}。`, { local: capabilities.marketVersion, npm: npmLatest }))
  }

  return finalize(findings, {
    profile,
    marketVersion: capabilities?.marketVersion ?? null,
    runtime: capabilities?.runtime ?? null,
    apiVersion: capabilities?.apiVersion ?? null,
    restartSupported: capabilities?.restart?.supported ?? capabilities?.features?.restart ?? null,
    present: present.length,
    bundles: asArray(installed.bundles).length,
  })
}

function finalize(findings, meta) {
  const sorted = [...findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity))
  const summary = {}
  for (const level of SEVERITY_ORDER) {
    const count = sorted.filter((f) => f.severity === level).length
    if (count > 0) summary[level] = count
  }
  return { ok: true, ...meta, summary, findings: sorted }
}
