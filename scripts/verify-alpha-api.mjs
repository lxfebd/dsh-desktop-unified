// 0.1.2-alpha 升级后验证：connection.fetch 注册表 + agentPresets 服务可解析。
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const pin = pkg.dsh?.upstreamVersion ?? ''
const checks = {
  pinAtLeastAlpha: /^0\.1\.2-alpha/.test(pin),
  hasAgentPresetsDep: Object.keys(pkg.dependencies).some((k) => k.includes('dsh-agent-presets')),
  hasClientConnection: Object.keys(pkg.dependencies).some((k) => k.includes('dsh-client-connection')),
  clientConnectionLocal: false,
  agentPresetsLocal: false,
  presetsOnNpm: false,
  clientOnNpm: false,
}
// Verify the new API packages are actually resolvable in the local node_modules
// (hoisted layout), not just declared — electron-builder needs them at package time.
for (const [key, sub] of [
  ['clientConnectionLocal', 'dsh-client-connection'],
  ['agentPresetsLocal', 'dsh-agent-presets'],
]) {
  try {
    require.resolve(`@deepseek-ai/${sub}/package.json`)
    checks[key] = true
  } catch {
    checks[key] = false
  }
}
for (const [key, sub] of [
  ['presetsOnNpm', 'dsh-agent-presets'],
  ['clientOnNpm', 'dsh-client-connection'],
]) {
  const r = spawnSync(process.execPath, ['-e', `
    fetch('https://registry.npmjs.org/@deepseek-ai%2F${sub}')
      .then((res) => res.json())
      .then((j) => console.log(JSON.stringify(j['dist-tags'])))
      .catch(() => process.exit(1))
  `], { encoding: 'utf8', timeout: 30000 })
  if (r.status === 0) checks[key] = true
}

console.log(JSON.stringify(checks, null, 2))
if (!checks.pinAtLeastAlpha) {
  console.error('FAIL: dsh not on 0.1.2-alpha')
  process.exit(1)
}
if (!checks.clientConnectionLocal || !checks.agentPresetsLocal) {
  console.error('FAIL: a new-API package is not resolvable in local node_modules — re-run pnpm install')
  process.exit(1)
}
console.log('OK: dsh on 0.1.2-alpha; connection.fetch + agentPresets resolvable')