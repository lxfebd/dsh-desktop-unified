// dsh-market-tools · 真机冒烟：对着正在运行的 dsh 主机跑一遍聚合，打印真实体积。
// 跑法：node scripts/live-check.mjs [端口]
// 只读路由，不做任何安装/卸载/更新。
import { summarizeCatalog, summarizeCategories, describeEntry } from '../lib/http.js'

const port = Number(process.argv[2] ?? 19387)
const origin = `http://127.0.0.1:${port}`
const bytes = (value) => Buffer.byteLength(JSON.stringify(value), 'utf8')

async function get(path) {
  const res = await fetch(origin + path, {
    headers: { origin },
    signal: AbortSignal.timeout(90000),
  })
  const text = await res.text()
  if (res.status !== 200) throw new Error(`${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`)
  return JSON.parse(text)
}

const registryJson = await get('/dsh-market/registry')
const installedJson = await get('/dsh-market/installed')
console.log(`原始 /dsh-market/registry 响应：${Buffer.byteLength(JSON.stringify(registryJson), 'utf8')} 字节`)

const plain = summarizeCatalog(registryJson, installedJson)
console.log(`\n[market_list 无参数] matched=${plain.matched} returned=${plain.returned} truncated=${plain.truncated} → ${bytes(plain)} 字节`)
console.log(`  热度前 5：${plain.catalog.slice(0, 5).map((e) => `${e.name}(${e.downloads ?? 0})`).join(', ')}`)

const hot = summarizeCatalog(registryJson, installedJson, { query: '安全' })
console.log(`\n[query=安全] matched=${hot.matched} returned=${hot.returned} → ${bytes(hot)} 字节`)
for (const entry of hot.catalog.slice(0, 5)) {
  console.log(`  ${entry.name}  cat=${entry.category.join('/')}  caps=${(entry.capabilities ?? []).join(',') || '-'}`)
}

const cats = summarizeCategories(registryJson, installedJson)
console.log(`\n[market_categories] ${cats.categories.length} 个分类，目录 ${cats.catalogTotal} 条`)
console.log(`  ${cats.categories.slice(0, 6).map((c) => `${c.zh}:${c.count}(已装${c.installed})`).join('  ')}`)

const info = describeEntry(registryJson, installedJson, 'dsh-knit')
console.log(`\n[market_info dsh-knit] ok=${info.ok} → ${bytes(info)} 字节`)
console.log(`  version=${info.catalogEntry?.version} downloads=${info.catalogEntry?.downloads} caps=${(info.catalogEntry?.capabilities ?? []).join(',') || '-'} installed=${JSON.stringify(info.installed)}`)

const summary = await get('/dsh-market/api/v1/updates/summary')
console.log(`\n[market_updates] checked=${summary.checked} updatable=${summary.updatable}`)
for (const pkg of summary.packages) console.log(`  ${pkg.name}: ${pkg.installedVersion} -> ${pkg.latestVersion}`)
