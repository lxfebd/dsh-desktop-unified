/**
 * Dynamic tool projection: maps the external-tools connection state to the
 * set of capabilities projected into the agent at a safe turn boundary. Only
 * connected tools are projected — a disconnect immediately drops its tools,
 * so the Host never advertises capabilities the user has turned off.
 * @module dsh-desktop/dynamic-projection
 */

export type ToolKind = 'codex' | 'claude-code'

/** A tool's live connection state, as held by the external-tools manager. */
export interface ToolConnection {
  id: string
  kind: ToolKind
  connected: boolean
  capabilities: string[]
}

/** One projected tool: its id, the capabilities it contributes, and its source kind. */
export interface ProjectedTool {
  id: string
  capabilities: string[]
  source: ToolKind
}

/**
 * Project connected tools' capabilities. Pure: the call site (a Host
 * capability queried at the turn boundary) supplies the live connection
 * state and receives exactly the tools that should be injected now.
 */
export function projectTools(connections: ToolConnection[]): ProjectedTool[] {
  return connections
    .filter((c) => c.connected)
    .map((c) => ({ id: c.id, capabilities: c.capabilities, source: c.kind }))
}
