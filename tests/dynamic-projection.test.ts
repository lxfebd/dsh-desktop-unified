import { describe, it, expect } from 'vitest'
import { projectTools } from '../src/dynamic-projection.js'

describe('projectTools', () => {
  it('projects only connected tools with their capabilities', () => {
    const r = projectTools([
      { id: 'a', kind: 'codex', connected: true, capabilities: ['codex.exec', 'codex.suggest'] },
      { id: 'b', kind: 'claude-code', connected: false, capabilities: ['claude.read'] },
    ])
    expect(r).toEqual([{ id: 'a', capabilities: ['codex.exec', 'codex.suggest'], source: 'codex' }])
  })

  it('returns an empty projection when nothing is connected', () => {
    expect(projectTools([])).toEqual([])
  })

  it('projects multiple connected tools independently', () => {
    const r = projectTools([
      { id: 'a', kind: 'codex', connected: true, capabilities: ['codex.exec'] },
      { id: 'b', kind: 'claude-code', connected: true, capabilities: ['claude.read', 'claude.write'] },
    ])
    expect(r).toHaveLength(2)
    expect(r.map((t) => t.source).sort()).toEqual(['claude-code', 'codex'])
  })
})
