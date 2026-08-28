/**
 * Connection manager for external coding tools: health-checks each tool on
 * connect (`<command> --version`), tracks connected state in the store, and
 * projects connected tools' capabilities via dynamic-projection — the Host
 * capability queried at the safe turn boundary.
 * @module dsh-desktop/external-tools/manager
 */

import { spawnSync } from 'node:child_process'
import { addTool, loadTools, removeTool, setConnected, type ToolConfig, type ToolKind } from './store.js'
import { projectTools, type ProjectedTool } from '../dynamic-projection.js'

/** Re-exported so callers (e.g. main.ts IPC wiring) import the tool types from one place. */
export type { ToolConfig, ToolKind } from './store.js'

const HEALTH_FLAG = '--version'

/** Per-kind capability surface a connected tool contributes. */
export function capabilitiesFor(kind: ToolKind): string[] {
  return kind === 'codex' ? ['codex.exec', 'codex.suggest'] : ['claude.read', 'claude.write']
}

/** Probe a tool by running `<command> --version`; exit 0 means reachable. */
function probe(t: ToolConfig): boolean {
  try {
    const res = spawnSync(t.command, [HEALTH_FLAG], { timeout: 5000 })
    return res.status === 0
  } catch {
    return false
  }
}

export function listTools(): ToolConfig[] {
  return loadTools()
}

export function addExternalTool(tool: Omit<ToolConfig, 'id' | 'connected'>): ToolConfig {
  return addTool(tool)
}

export function removeExternalTool(id: string): void {
  removeTool(id)
}

/** Health-check and flip the connected flag. Returns the new connected state. */
export function connect(id: string): boolean {
  const tools = loadTools()
  const t = tools.find((x) => x.id === id)
  if (!t) return false
  const ok = probe(t)
  setConnected(id, ok)
  return ok
}

export function disconnect(id: string): void {
  setConnected(id, false)
}

/** The projected tool set for the current connection state (turn boundary). */
export function projectedTools(): ProjectedTool[] {
  return projectTools(
    loadTools().map((t) => ({ id: t.id, kind: t.kind, connected: t.connected, capabilities: capabilitiesFor(t.kind) })),
  )
}
