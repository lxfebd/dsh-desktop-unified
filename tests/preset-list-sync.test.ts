// 预置插件清单防漂移：dsh-market-doctor 里那份镜像常量必须与壳里的真常量一致。
// 漂移会让体检报告把"其实装着"的插件报成缺失，或反过来——所以宁可让测试抓住。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { PRESET_PLUGIN_NAMES } from '../plugins/dsh-market-doctor/lib/doctor.js'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** 从 src/main.ts 里抠出 PRESET_PLUGINS 的字面量。 */
function shellPresets(): string[] {
  const source = readFileSync(join(repoRoot, 'src', 'main.ts'), 'utf8')
  const block = /const PRESET_PLUGINS = \[([\s\S]*?)\]/.exec(source)
  if (!block) throw new Error('src/main.ts 里找不到 PRESET_PLUGINS——壳改了写法，两边都要跟进')
  return block[1]
    .split(',')
    .map((line) => line.replace(/\/\/.*$/g, '').trim().replace(/^'|'$/g, ''))
    .filter((name) => name !== '')
}

describe('预置插件清单', () => {
  it('壳里的 PRESET_PLUGINS 与插件里的镜像常量逐项一致（顺序也一致）', () => {
    expect(PRESET_PLUGIN_NAMES).toEqual(shellPresets())
  })

  it('清单非空且都是合法包名', () => {
    expect(PRESET_PLUGIN_NAMES.length).toBeGreaterThan(0)
    for (const name of PRESET_PLUGIN_NAMES) expect(name).toMatch(/^[@A-Za-z0-9._-]+$/)
  })
})
