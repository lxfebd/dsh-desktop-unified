/**
 * macOS launch-origin guard. A GUI-launched process reports
 * `XPC_SERVICE_NAME` as `application.<bundle id>.<n>.<n>`, while a process
 * started by a LaunchAgent/LaunchDaemon carries the task's own label. A
 * malicious LaunchAgent that respawns this binary makes its second copy fire
 * `second-instance`, which would otherwise be treated as a user asking for
 * focus. `isUserInitiatedInstance` additionally rejects synthetic launches
 * carrying a script argument (.mjs/.cjs/.js) — those belong to the runtime,
 * not to a file the user wants opened.
 * @module dsh-desktop/launchd-guard
 */

/**
 * Reports whether the process was started by LaunchAgent/LaunchDaemon rather
 * than by the user. Always false off macOS, so the guard is inert elsewhere.
 */
export function isDaemonLaunch(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): boolean {
  if (platform !== 'darwin') return false
  const serviceName = environment.XPC_SERVICE_NAME
  if (serviceName === undefined || serviceName === '' || serviceName === '0') return false
  return !serviceName.startsWith('application.')
}

/** Matches the script extensions passed to Electron as a runtime argument. */
const scriptArgumentPattern = /\.[mc]?js$/i

/**
 * Reports whether the argv of a relaunch looks like a real user action. The
 * first argument is inspected: a helper bundled inside the app
 * (`.../Contents/Frameworks/...`) or a script path means the launch was
 * synthesised, not requested.
 */
export function isUserInitiatedInstance(argv: string[]): boolean {
  if (argv.length === 0) return true
  const [binary, ...rest] = argv as [string, ...string[]]
  if (binary.includes('/Contents/Frameworks/')) return false
  const firstArgument = rest[0]
  if (firstArgument === undefined) return true
  return !scriptArgumentPattern.test(firstArgument)
}
