const findCulprit = (attemptLog) => {
  const apply = /failed to (?:apply|import) loader entry ([^\s(]+) \(([^)]+)\)/g
  let culprit = undefined
  for (const m of attemptLog.matchAll(apply)) culprit = { kind: 'apply', entryId: m[1], packageName: m[2] }
  const unresolvable = /cannot resolve profile bundle "([^"]+)"/g
  for (const m of attemptLog.matchAll(unresolvable)) culprit = { kind: 'unresolvable', packageName: m[1] }
  const noBundle = /profile bundle ["']([^"']+)["'] declares no dsh\.bundle/gi
  for (const m of attemptLog.matchAll(noBundle)) culprit = { kind: 'unresolvable', packageName: m[1] }
  const failedToLoad = /plugin\(s\) failed to load:\s*([a-zA-Z0-9@/_-]+)/gi
  for (const m of attemptLog.matchAll(failedToLoad)) culprit = { kind: 'unresolvable', packageName: m[1] }
  const bootTitle = /^Failed to load plugins\s*$/im
  const stripped = attemptLog.split(/\r?\n/).map((line) => line.replace(/^\[(?:stdout|stderr)\]\s*/, '')).join('\n')
  const tm = bootTitle.exec(stripped)
  if (tm) {
    const after = stripped.slice(tm.index + tm[0].length).split(/\r?\n/)
    const pkgRef = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i
    for (const line of after) { const c = line.trim(); if (pkgRef.test(c)) culprit = { kind: 'unresolvable', packageName: c } }
  }
  const dupEntry = /duplicate loader entry id:\s*["']?([^\s"']+)["']?/gi
  for (const m of attemptLog.matchAll(dupEntry)) culprit = { kind: 'unresolvable', packageName: m[1] }
  const slot = /slot\s+["']?([^"'\s]+)["']?\s+(?:conflict|duplicate|already\s+(?:registered|provided|occupied|taken|has\s+a\s+registration))/gi
  for (const m of attemptLog.matchAll(slot)) culprit = { kind: 'slot-conflict', slotName: m[1] }
  return culprit
}

const cases = [
  ['apply', '=== dsh web starting ===\n[stderr] DSH entry failed: failed to apply loader entry plugins/dsh-market (dsh-plugin-market)'],
  ['unresolvable', '=== dsh web starting ===\n[stderr] cannot resolve profile bundle "dsh-plugin-broken"'],
  ['noBundle', "=== dsh web starting ===\n[stderr] profile bundle \"dsh-plugin-decor\" declares no dsh.bundle"],
  ['failedToLoad', '=== dsh web starting ===\n[stderr] plugin(s) failed to load: dsh-plugin-crashy'],
  ['block', '=== dsh web starting ===\n[stderr] Failed to load plugins\n[stderr] dsh-plugin-one\n[stderr] dsh-plugin-two'],
  ['dupEntry', '=== dsh web starting ===\n[stderr] duplicate loader entry id: "dsh-market"'],
  ['slot', '=== dsh web starting ===\n[stderr] single slot "sidebar" already has a registration'],
  ['none', '=== dsh web starting ===\n[stderr] EADDRINUSE'],
  ['innermost', '=== dsh web starting ===\n[stderr] failed to apply loader entry plugins/outer (@scope/a-broken)\n[stderr]   [cause] failed to apply loader entry plugins/inner (@scope/a-broken)'],
]
for (const [name, log] of cases) console.log(name.padEnd(11), '->', JSON.stringify(findCulprit(log)))