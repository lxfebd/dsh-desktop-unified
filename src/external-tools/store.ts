/**
 * Persistence for external coding-tool configs. The file lives under
 * userData so it survives upgrades; the desktop shell owns it (not dsh).
 * @module dsh-desktop/external-tools/store
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

export type ToolKind = 'codex' | 'claude-code'

export interface ToolConfig {
  id: string
  name: string
  kind: ToolKind
  command: string
  connected: boolean
}

interface ToolStore {
  tools: ToolConfig[]
}

function storeFile(): string {
  return join(app.getPath('userData'), 'external-tools.json')
}

export function loadTools(): ToolConfig[] {
  if (!existsSync(storeFile())) return []
  try {
    return (JSON.parse(readFileSync(storeFile(), 'utf8')) as ToolStore).tools ?? []
  } catch {
    return []
  }
}

export function saveTools(tools: ToolConfig[]): void {
  writeFileSync(storeFile(), JSON.stringify({ tools }, undefined, 2) + '\n', 'utf8')
}

export function addTool(tool: Omit<ToolConfig, 'id' | 'connected'>): ToolConfig {
  const tools = loadTools()
  const created: ToolConfig = { ...tool, id: `tool-${Date.now()}`, connected: false }
  tools.push(created)
  saveTools(tools)
  return created
}

export function removeTool(id: string): void {
  saveTools(loadTools().filter((t) => t.id !== id))
}

export function setConnected(id: string, connected: boolean): void {
  const tools = loadTools()
  const t = tools.find((x) => x.id === id)
  if (t) {
    t.connected = connected
    saveTools(tools)
  }
}
