/**
 * DSH Desktop main process: boots `dsh web` on the first free loopback port
 * (3080 upward) with Electron's embedded Node, waits for readiness, then loads
 * the UI in a single BrowserWindow. Owns the child process lifecycle, log
 * capture, navigation guards, and auto-updates.
 * @module dsh-desktop/main
 */

import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, screen, shell, ipcMain } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { spawn, spawnSync } from 'node:child_process'
import type { Rectangle } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { appendFileSync, chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertCapabilityAllowed, BRIDGE_CHANNELS, type BridgeName } from './capabilities.js'
import {
  addExternalTool,
  connect as connectTool,
  disconnect as disconnectTool,
  listTools,
  projectedTools,
  removeExternalTool,
  type ToolConfig,
} from './external-tools/manager.js'
import {
  disableEntry,
  enterFullSafeMode,
  findCulprit,
  loadRecoveryActions,
  readLastAttemptLog,
  recordRecoveryAction,
  removeBundle,
  restoreAll,
} from './safe-mode.js'
import { latestSnapshot, restoreSnapshot } from './plugin-recovery-restore.js'
import { activeProfile, ensureProfileSeed, PROFILES, setActiveProfile, type ProfileName } from './profiles.js'
import {
  defaultGpuFallbackState,
  gpuFallbackStateEquals,
  gpuFallbackSwitches,
  isGpuLossFatal,
  parseGpuFallbackState,
  planGpuFallbackResponse,
  planStableLaunch,
  serializeGpuFallbackState,
  type GpuFallbackState,
} from './gpu-fallback.js'
import {
  MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS,
  shouldReloadAfterMainWindowRendererLoss,
} from './main-window-recovery.js'
import { installContextMenu } from './context-menu.js'
import { secureWindow } from './security.js'
import { isDaemonLaunch, isUserInitiatedInstance } from './launchd-guard.js'
import { raiseWindowWithoutStealingFocus, type WindowFocusIntent } from './window-raise.js'
import { aboutDetail, bundledHarnessVersion } from './version-info.js'
import { lockZoomFactor } from './windows-menu-view.js'
import {
  ensureShellIconFromMain,
  loadPrefs,
  startShellControl,
  stopShellControl,
  type ShellPrefs,
} from './shell-control.js'

/** First port tried for the dsh web server. */
const FIRST_PORT = 3080
/** Last port tried before giving up. */
const LAST_PORT = 3099
/** How long to wait for the server to answer before declaring boot failure. */
const READY_TIMEOUT_MS = 60_000
/** Release page used as the manual-download fallback when auto-update fails. */
const RELEASES_URL = 'https://github.com/foolgry/dsh-desktop/releases'

/**
 * UI locale switch: the shell ships Chinese + English strings; every other
 * locale falls back to English. Computed lazily so callers before app-ready
 * still work (getLocale only becomes reliable once the app module loads).
 */
let zhLocale: boolean | undefined
function isZhLocale(): boolean {
  return (zhLocale ??= app.getLocale().startsWith('zh'))
}

/**
 * 36×36 tray icon (whale with padding), embedded as a data URL
 * so the packaged app needs no extra resource files — electron-builder only
 * ships `dist/` and `node_modules/`. Regenerate from `build/icon.png` with:
 * `magick build/icon.png -trim +repage -resize 30x30 -gravity center -background none -extent 36x36`
 */
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACQAAAAkCAMAAADW3miqAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAHvUExURQAAAE1r/kJn/1Bt/01r/01q/U1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/k1r/gAAAIw+fZsAAACjdFJOUwAAAAAAABtQemMJjGAFMGaJmJR+j9H2bgQSvyICJCyh6+EeH9hpAw4XattD/BkW1fJlisr65i/awfSeC6rQMznk11LzMk/f/cg/qc7W7dNFpPuiWD0PMWi39eq74+ziOPnpKE3ExUY3wOgp95awNibLEHgIiElezL0Kn1OQSPgVQu6zDEvwZKhzE4fndBG173YN1Lk1JbbJ4CedizSlgi0HxoXQznh8AAAAAWJLR0QAiAUdSAAAAAd0SU1FB+oIDgYlI+W9c5EAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMDgtMTRUMDE6MDc6MTQrMDA6MDAj9EBCAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTA4LTE0VDAxOjA3OjE0KzAwOjAwUqn4/gAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0wOC0xNFQwNjozNzozNSswMDowMAV/tbEAAAHaSURBVDjLY2AYBWDACAds7BycXECamwdIgCWQ1PDy8QsICgmLiIqJiUswMkqKSkmDNcnIItTIySsshgJFJSBfWXGxiqoak7qGphZckbbKYjjQEdRlZNTTX7zYwNDIWMXEFKbIzHwxMrAwY1STB9KWII4VVJG1zWJUYGvHaO8AYTryQRU5OS9GV+XC6OoGpN09PGG+81rs4O3ji6LKz18tYHFgULAGPAgUFUJC9cLCIyIhCqKiYxYvjg2IW2wZz4gIp4TEJBCPKzkFrCg1LT0DzMjMQgQlQ2C2PyS4NXICgXLmuXn5PiBFBYUINQy+i4ugUVBcorN4sVhiKWOZCVCRIDOSovLFFdZQVZVVICOi08SB7jOpRrKNoWaxZS2Yz8LIqFQAUlUHsragHllRQ+PipmagANhdLa3QUAhsY2RFSijF7YsDO0AKijuB0d4FVeTVjGwQA2N69+LGMqAiT+OeXsbOPkhASKOoAVqjmb24f8JERt1JiydPYZzqAVQTySPDiGoSIy+H2GKdaWUt0xcvnsHDNXMyKCRtGtCNkuAHxrp7Asie7AyRWVJ+sc79s2VQFIH8NWduIyx2Tefp1c/Py7JGNQmsakGDkGhrYHbmwkVh8GxBn2w4FAAA8TPI0GQOSlEAAAAASUVORK5CYII='

/** Directory holding dsh's own state (profiles, sessions), inside userData. */
function dshHome(): string {
  return join(app.getPath('userData'), 'dsh-home')
}

/** The active profile's directory, where user-installed plugins are registered. */
function webProfileDir(): string {
  return join(dshHome(), 'profiles', activeProfile())
}

/** Recovery-action record consumed by the tray's restore menu item. */
function safeModeStateFile(): string {
  return join(app.getPath('userData'), 'safe-mode.json')
}

/** File that receives the dsh child's stdout and stderr. */
function logFile(): string {
  const dir = join(app.getPath('userData'), 'logs')
  mkdirSync(dir, { recursive: true })
  return join(dir, 'dsh.log')
}

/** GPU sandbox degradation state file (last effective level, persisted across launches). */
function gpuFallbackStateFile(): string {
  return join(app.getPath('userData'), 'gpu-fallback.json')
}

function loadGpuFallbackState(): GpuFallbackState {
  try {
    return parseGpuFallbackState(readFileSync(gpuFallbackStateFile(), 'utf8'))
  } catch {
    return defaultGpuFallbackState
  }
}

function saveGpuFallbackState(state: GpuFallbackState): void {
  try {
    writeFileSync(gpuFallbackStateFile(), serializeGpuFallbackState(state) + '\n', 'utf8')
  } catch {
    // 非致命：丢失的只是下次启动的降级记忆
  }
}

/**
 * 渲染器/GPU 进程丢失后限流重载主窗口（与 Task 1 的 GPU 降级协作）。
 * 非致命丢失走此路径重载；致命丢失由 render-process-gone 处理器接管。
 */
function reloadMainWindowAfterRendererLoss(win: BrowserWindow): void {
  if (win.isDestroyed() || win.webContents.isDestroyed()) return
  const now = Date.now()
  if (!shouldReloadAfterMainWindowRendererLoss({
    now,
    lastReloadAt: mainWindowRecoveryReloadAt,
    reloadCount: mainWindowRecoveryReloadCount,
  })) {
    appendFileSync(logFile(), `\n=== main window recovery: reload throttled (count=${mainWindowRecoveryReloadCount}) ===\n`)
    return
  }
  mainWindowRecoveryReloadAt = now
  mainWindowRecoveryReloadCount += 1
  // 冷却的 4 倍后清零计数，使孤立崩溃干净恢复、持续失败仍触上限。
  setTimeout(() => { mainWindowRecoveryReloadCount = 0 }, MAIN_WINDOW_RECOVERY_RELOAD_COOLDOWN_MS * 4).unref()
  try {
    void win.webContents.reload()
    appendFileSync(logFile(), `\n=== main window recovery: reload #${mainWindowRecoveryReloadCount} ===\n`)
  } catch (error) {
    appendFileSync(logFile(), `\n=== main window recovery: reload threw: ${error instanceof Error ? error.message : String(error)} ===\n`)
  }
}

/**
 * Resolve the published CLI entry. The package has no `exports` map, so the
 * subpath resolves directly; in a packaged app the file lives in
 * `app.asar.unpacked`, which spawn can execute.
 * @returns absolute path to `@deepseek-ai/dsh/lib/bin.js`
 */
function dshBin(): string {
  const require = createRequire(import.meta.url)
  const bin = require.resolve('@deepseek-ai/dsh/lib/bin.js')
  return bin.includes('app.asar')
    ? bin.replace('app.asar', 'app.asar.unpacked')
    : bin
}

/**
 * Overlay that swaps the native OS folder dialog for the in-app file-tree
 * picker. The native picker (`directory-picker-auto` → `-native` on win32/darwin)
 * loads `koffi.node`; its prebuilt win32-x64 binary throws a NAPI fatal error
 * under Electron's embedded Node ABI, so the dialog worker dies before
 * reporting a result (issue #1). macOS uses `osascript` and Linux uses
 * `zenity`/`kdialog`, neither of which touches koffi, so this is win32-only.
 *
 * Disabling `-auto` and mounting both the browse backend and its UI surface
 * mirrors exactly what `-auto` does on its own `browse` branch.
 */
const BROWSE_PICKER_PATCH = `# Force the in-app file-tree picker (pure node:fs) instead of the native OS
# dialog. The native picker's koffi.node crashes under Electron's embedded Node
# ABI on win32 — see https://github.com/foolgry/dsh-desktop/issues/1
- id: directory-picker
  disabled: true

- insert:
    - id: directory-picker-browse
      name: '@deepseek-ai/dsh-host-directory-picker-browse'
    - id: directory-picker-browse-client
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'
`

/** Marks a profile patch layer that already carries the browse-picker overlay. */
const PICKER_PATCH_MARKER = '# dsh-desktop: browse-picker-fallback'

/**
 * On win32, layer the browse-picker overlay into the web profile's
 * `cordis.patch.yml` — dsh's own patch layer, applied after every bundle on
 * each boot. Returns `false` on every other platform, leaving the native
 * picker (and its better UX) intact.
 * @returns whether the overlay is in place for the profile dsh is about to load
 */
function ensurePickerFallbackPatch(): boolean {
  if (process.platform !== 'win32') return false
  const profileDir = webProfileDir()
  mkdirSync(profileDir, { recursive: true })
  const patchPath = join(profileDir, 'cordis.patch.yml')
  const current = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : PROFILE_PATCH_TEMPLATE
  if (current.includes(PICKER_PATCH_MARKER)) return true
  // The template's `[]` is a flow-style empty array; appending sequence items
  // after it would be invalid YAML, so drop it before layering the entries on.
  const body = current.replace(/^[ \t]*\[[ \t]*\][ \t]*$/gm, '')
  writeFileSync(patchPath, `${body.replace(/\s+$/, '')}\n\n${PICKER_PATCH_MARKER}\n${BROWSE_PICKER_PATCH}`, 'utf8')
  return true
}

/**
 * Plugins the desktop build presets into the web profile. They ship as regular
 * app dependencies (hoisted, asar-unpacked), so presetting needs no pnpm and
 * no network on the user's machine — the exact state `dsh plugin --profile
 * web add <name>` would produce, minus the registry round-trip.
 *
 * `dsh-desktop-preset-transfer` is presetted since dsh 0.1.2-alpha (its
 * `connection` inject and `@deepseek-ai/dsh-agent-presets` import only exist
 * upstream 0.1.2-alpha); see the sync-upstream report-preserve-don't-adopt
 * stance on GitHub-only prereleases for the pre-0.1.2 rationale.
 */
const PRESET_PLUGINS = [
  'dshmarket',
  'dsh-plugin-market',
  'dsh-plugin-version-manager',
  'dsh-shell-control',
  'dsh-desktop-preset-transfer',
]

/**
 * The web profile's shipped bundle template. Must stay in sync with
 * `PROFILE_TEMPLATES.web` in @deepseek-ai/dsh-app-boot — the profile we
 * pre-create replaces the one `dsh web` would auto-initialize on first boot.
 */
const WEB_PROFILE_TEMPLATE = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** Marker recording that the preset plugins were already applied for a profile. */
function presetMarkerFile(): string {
  return join(dshHome(), `.bundled-plugins-preset-${activeProfile()}`)
}

/** Profile manifest shape (the parts presetting touches). */
interface ProfileManifest {
  name?: string
  private?: boolean
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

/** dsh's profile patch-layer template (mirrors initProfile in dsh-app-boot). */
const PROFILE_PATCH_TEMPLATE = `# Your patch layer for this dsh profile, applied after every bundle layer:
# a top-level YAML array of loader patch entries (id-targeted config
# overrides, disables, and insert lists; \`!!js\` expressions allowed).
[]
`

/** dsh's profile pnpm settings template (mirrors initProfile in dsh-app-boot). */
const PROFILE_PNPM_WORKSPACE = `packages:
  - .

nodeLinker: hoisted
autoInstallPeers: false
`

/**
 * Resolve a bundled plugin's directory inside this installation. Same
 * require.resolve + asar-unpacked rewrite as {@link dshBin}; the plugin ships
 * in the app's hoisted node_modules, which the parent-walk from dist/main.js
 * reaches in both dev and packaged runs.
 * @param name - the plugin's package name
 * @returns the plugin's absolute package directory
 */
function bundledPluginDir(name: string): string {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve(`${name}/package.json`)
  const real = manifest.includes('app.asar')
    ? manifest.replace('app.asar', 'app.asar.unpacked')
    : manifest
  return dirname(real)
}

/**
 * Ensure `link` is a symlink to `target` (junction on win32, like dsh's own
 * fallback healer). A path occupied by anything other than our symlink is
 * left alone — something else owns the name, and resolution through it works.
 * @param link - the symlink path to maintain
 * @param target - the absolute directory it should point at
 */
function ensurePluginSymlink(link: string, target: string): void {
  let stat
  try {
    stat = lstatSync(link)
  } catch {
    stat = undefined
  }
  if (stat !== undefined) {
    if (!stat.isSymbolicLink()) return
    if (readlinkSync(link) === target) return
    unlinkSync(link)
  }
  symlinkSync(target, link, 'junction')
}

/**
 * Preset {@link PRESET_PLUGINS} into the web profile before `dsh web` boots:
 * append each to `dsh.profile.bundles` (with a `dependencies` entry, matching
 * what `dsh plugin add` reconciles) and link it into the flat module fallback
 * `$DSH_HOME/profiles/node_modules`. The fallback link is required: dsh's
 * healProfilesModuleFallback only links packages from the dsh app's own
 * dependency closure, which preset plugins are not part of, while the Loader
 * imports every bundle by bare name from the profile directory.
 *
 * Runs at most once (marker file): a user who later removes a preset plugin
 * via `dsh plugin remove` keeps that choice. Failures are logged and never
 * block the app from booting.
 */
function presetBundledPlugins(): void {
  try {
    const marker = presetMarkerFile()
    if (existsSync(marker)) return
    const plugins = PRESET_PLUGINS.map((name) => {
      const dir = bundledPluginDir(name)
      const version = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0'
      return { name, dir, version }
    })
    const profileDir = join(dshHome(), 'profiles', activeProfile())
    const manifestPath = join(profileDir, 'package.json')
    mkdirSync(profileDir, { recursive: true })
    let manifest: ProfileManifest
    if (existsSync(manifestPath)) {
      manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as ProfileManifest
    } else {
      // Pre-create what `dsh web`'s first-boot initProfile would, with the
      // preset plugins already layered in, so the profile is complete before
      // the child ever loads it.
      manifest = {
        name: 'dsh-profile-web',
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: [...WEB_PROFILE_TEMPLATE] } },
      }
      const patchPath = join(profileDir, 'cordis.patch.yml')
      if (!existsSync(patchPath)) writeFileSync(patchPath, PROFILE_PATCH_TEMPLATE)
      const workspacePath = join(profileDir, 'pnpm-workspace.yaml')
      if (!existsSync(workspacePath)) writeFileSync(workspacePath, PROFILE_PNPM_WORKSPACE)
    }
    const bundles = manifest.dsh?.profile?.bundles ?? []
    let changed = false
    for (const plugin of plugins) {
      if (!bundles.includes(plugin.name)) {
        bundles.push(plugin.name)
        changed = true
      }
      manifest.dependencies ??= {}
      if (manifest.dependencies[plugin.name] === undefined) {
        manifest.dependencies[plugin.name] = `^${plugin.version}`
        changed = true
      }
    }
    if (changed) {
      manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
      writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    }
    const fallbackDir = join(dshHome(), 'profiles', 'node_modules')
    mkdirSync(fallbackDir, { recursive: true })
    for (const plugin of plugins) ensurePluginSymlink(join(fallbackDir, plugin.name), plugin.dir)
    writeFileSync(marker, `${JSON.stringify(Object.fromEntries(plugins.map((p) => [p.name, p.version])), undefined, 2)}\n`)
    appendFileSync(logFile(), `=== preset bundled plugins: ${PRESET_PLUGINS.join(', ')} applied ===\n`)
  } catch (error) {
    appendFileSync(logFile(), `\n=== preset bundled plugins failed: ${error instanceof Error ? error.message : String(error)} ===\n`)
  }
}

/**
 * Preheat `dsh-home/profiles/node_modules/` with junctions that mirror the
 * dsh app's own `node_modules/`, so dsh-app-boot's `healProfilesModuleFallback`
 * finds every expected entry with the correct target on its first
 * `readlinkSync` and returns without calling `trash()`.
 *
 * WorkBuddy's safe-delete sandbox intercepts every `trash()` call
 * (genie-safe-delete.cjs → "Some operations were aborted") whenever a Node
 * module loader still holds a handle to the link target. dsh web then exits
 * code 1 on every startup, main.ts's safe-mode kicks in, and the welcome
 * notice acknowledgement cannot persist (`scope.set` writes into the
 * safe-mode-reset `cordis.patch.yml` and the derive step always reads the
 * old value, so `acknowledge()` always reports the acknowledgement did
 * not persist and the UI flashes the red `welcomeError`).
 *
 * We replicate dsh-app-boot's own `packageDirFromAnchor` (a logical
 * `join(searchPath, packageName)` target, no `realpath`) and its
 * `@deepseek-ai/dsh` install anchor, so the pre-built junction targets match
 * byte-for-byte and `ensureSymlink` returns before it ever touches `unlinkSync`
 * (which the safe-delete sandbox would otherwise intercept and fail on).
 */
function preheatProfileNodeModules(): void {
  try {
    const dshAnchor = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
    const profileFallback = join(dshHome(), 'profiles', 'node_modules')
    mkdirSync(profileFallback, { recursive: true })

    /** Standard `node_modules` upward walk (mirrors Node's `Module._nodeModulePaths`).
     * Implemented manually because Electron overrides `require.resolve.paths` in the
     * main process, which otherwise returns wrong/empty search paths here. */
    function nodeModulesSearchPaths(fromDir: string): string[] {
      const paths: string[] = []
      let current = fromDir
      for (;;) {
        paths.push(join(current, 'node_modules'))
        const parent = dirname(current)
        if (parent === current) break
        current = parent
      }
      return paths
    }

    /** Mirror of dsh-app-boot's `packageDirFromAnchor`: the first node_modules-walk
     * candidate that holds the package's manifest, as a logical (non-realpath) path. */
    function packageDirFromAnchor(anchor: string, packageName: string): string | undefined {
      for (const searchPath of nodeModulesSearchPaths(dirname(anchor))) {
        const candidate = join(searchPath, packageName)
        if (existsSync(join(candidate, 'package.json'))) return candidate
      }
      return undefined
    }

    const links = new Map<string, string>()
    const manifestCache = new Map<string, Record<string, unknown>>()
    const readManifest = (path: string): Record<string, unknown> => {
      if (!manifestCache.has(path)) {
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(readFileSync(path, 'utf8')) } catch { /* ignore unreadable */ }
        manifestCache.set(path, parsed)
      }
      return manifestCache.get(path)!
    }

    const appManifest = readManifest(dshAnchor)
    if (typeof appManifest.name === 'string') links.set(appManifest.name, dirname(dshAnchor))
    const queue: string[] = [dshAnchor]
    const visited = new Set<string>()
    while (queue.length) {
      const anchor = queue.shift()!
      if (visited.has(anchor)) continue
      visited.add(anchor)
      const manifest = readManifest(anchor)
      const deps = { ...(manifest.dependencies as Record<string, string> | undefined ?? {}), ...(manifest.peerDependencies as Record<string, string> | undefined ?? {}) }
      for (const dep of Object.keys(deps)) {
        if (links.has(dep)) continue
        const dir = packageDirFromAnchor(anchor, dep)
        if (dir === undefined) continue
        links.set(dep, dir)
        const depManifest = join(dir, 'package.json')
        if (!visited.has(depManifest)) { visited.add(depManifest); queue.push(depManifest) }
      }
    }

    let linked = 0
    let skipped = 0
    for (const [pkgName, target] of links) {
      const link = join(profileFallback, pkgName)
      mkdirSync(dirname(link), { recursive: true })
      if (existsSync(link)) {
        try {
          if (readlinkSync(link) === target) { skipped++; continue }
        } catch { /* not a symlink / unreadable — fall through to replace */ }
        try { unlinkSync(link) } catch { /* swallow; still try to relink */ }
      }
      symlinkSync(target, link, 'junction')
      linked++
    }
    appendFileSync(logFile(), `=== preheat profile node_modules: linked ${linked}, skipped ${skipped} (anchor ${dshAnchor}, ${links.size} pkg) ===\n`)
  } catch (error) {
    appendFileSync(logFile(), `=== preheat profile node_modules failed: ${error instanceof Error ? error.message : String(error)} ===\n`)
  }
}

/**
 * Probe one loopback port.
 * @param port - candidate port
 * @returns whether something could bind it right now
 */
function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)))
  })
}

/**
 * Pick the first bindable loopback port in the configured range.
 * @returns a free port
 */
async function pickPort(): Promise<number> {
  for (let port = FIRST_PORT; port <= LAST_PORT; port++) {
    if (await isFree(port)) return port
  }
  throw new Error(`no free loopback port between ${FIRST_PORT} and ${LAST_PORT}`)
}

/**
 * Standalone pnpm plus a `node` shim for in-app plugin installs. dshmarket
 * and `dsh plugin add` spawn `pnpm` by bare name (and package lifecycle
 * scripts spawn `node`), but GUI launches inherit a bare launchd PATH with
 * neither — the marketplace then fails with "cannot find Node". We ship
 * `@pnpm/exe` (a self-contained SEA binary, no system Node needed) and
 * prepend its dir to the dsh child's PATH; the POSIX node shim reuses the
 * same Electron binary dsh runs on, which also keeps native builds on the
 * ABI the runtime actually loads.
 * @returns PATH prefix (trailing delimiter included) for the child env
 */
function toolingPathPrefix(): string {
  try {
    const parts: string[] = []
    if (process.platform !== 'win32') {
      const shimDir = join(app.getPath('userData'), 'tooling-bin')
      mkdirSync(shimDir, { recursive: true })
      const nodeShim = join(shimDir, 'node')
      const script = `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`
      if (!existsSync(nodeShim) || readFileSync(nodeShim, 'utf8') !== script) {
        writeFileSync(nodeShim, script, { mode: 0o755 })
      }
      chmodSync(nodeShim, 0o755)
      parts.push(shimDir)
    }
    const require = createRequire(import.meta.url)
    const pkgJson = require.resolve('@pnpm/exe/package.json')
    const real = pkgJson.includes('app.asar')
      ? pkgJson.replace('app.asar', 'app.asar.unpacked')
      : pkgJson
    const pnpmDir = dirname(real)
    // The published tarball ships the SEA binary without the exec bit, and
    // setup.js's hardlink does not add it — fix it here or spawn gets EACCES.
    try {
      chmodSync(join(pnpmDir, process.platform === 'win32' ? 'pnpm.exe' : 'pnpm'), 0o755)
    } catch {
      // read-only install location; the spawn error surfaces downstream
    }
    parts.push(pnpmDir)
    return parts.join(delimiter) + delimiter
  } catch (error) {
    appendFileSync(logFile(), `\n=== tooling setup failed: ${error instanceof Error ? error.message : String(error)} ===\n`)
    return ''
  }
}

/**
 * Spawn `dsh web --port <port>` under Electron's embedded Node
 * (`ELECTRON_RUN_AS_NODE`), so end users need no system Node. Output is
 * appended to the userData log.
 * @param port - the probed free port
 * @returns the running child
 */
function startDsh(port: number): ChildProcess {
  const log = logFile()
  appendFileSync(log, `\n=== dsh web starting on port ${port} at ${new Date().toISOString()} ===\n`)
  dshAuthUrl = undefined
  dshReadyCookie = undefined
  /** Rolling tail of the child's stdout, scanned for the printed Web URL line. */
  let stdoutTextBuf = ''
  // --expose-internals is required by cordis-plugin-hmr's HMR service, which
  // ships in the base profile and reads Node internals unavailable by default.
  // `dsh --profile <name>` boots the named profile; `dsh web` is a hardcoded
  // alias for `--profile web`, but only `--profile` works for custom profiles.
  const args = ['--expose-internals', dshBin(), '--profile', activeProfile()]
  // The shell loads the UI in its own window; dsh's default behavior of
  // opening the system browser on top of that is a redundant tab per launch.
  args.push('--no-open')
  // win32: the native folder dialog's koffi.node crashes under Electron's ABI
  // (issue #1), so overlay the pure-JS browse picker. `dsh web` has no
  // `--patch` flag; the overlay goes into the profile's own cordis.patch.yml,
  // which dsh layers in after every bundle on each boot.
  if (ensurePickerFallbackPatch()) {
    appendFileSync(log, `=== win32: using browse directory picker (native koffi crashes under Electron ABI; issue #1) ===\n`)
  }
  args.push('--port', String(port))
  const child = spawn(process.execPath, args, {
    env: {
      ...process.env,
      PATH: `${toolingPathPrefix()}${process.env.PATH ?? ''}`,
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: dshHome(),
      DSH_DESKTOP_PROFILE: activeProfile(),
      DSH_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => {
    appendFileSync(log, chunk)
    // dsh 0.1.2-alpha prints the authenticated root URL once its plugin tree
    // settles: `dsh web: http://<host>:<port>/?token=<launchToken>`. Keep the
    // newest full URL; the shell needs it to pass the browser-trust fence.
    stdoutTextBuf += chunk.toString('utf8')
    const claimed = /dsh web:\s+(\S+)/.exec(stdoutTextBuf)
    if (claimed) {
      dshAuthUrl = claimed[1]
    }
    // 保留最后一个换行符之后的未完成行，防止跨 chunk 的 URL 行被截断
    const lastNl = stdoutTextBuf.lastIndexOf('\n')
    if (lastNl !== -1) stdoutTextBuf = stdoutTextBuf.slice(lastNl + 1)
  })
  child.stderr?.on('data', (chunk: Buffer) => appendFileSync(log, chunk))
  child.on('exit', (code, signal) =>
    appendFileSync(log, `\n=== dsh web exited (code ${code}, signal ${signal}) at ${new Date().toISOString()} ===\n`),
  )
  return child
}

/**
 * Poll the server until it answers HTTP or the child dies. Readiness requires
 * three consecutive OK answers: `dsh web` binds its port before the plugin
 * tree finishes loading, so a plugin crash lets the server answer for a
 * brief window (~50ms) and then exit — a single OK is not proof of life.
 * @param port - port the server was asked to bind
 * @param child - the dsh child, watched for early exit
 */
async function waitReady(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  let stableAnswers = 0
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`dsh exited with code ${child.exitCode} before becoming ready`)
    }
    // In 0.1.2-alpha the clean root only answers once authenticated. The
    // probe completes the process-token exchange (303 + Set-Cookie) before
    // judging readiness, since Node's fetch carries no cookie jar.
    if (await probeReady(port)) {
      stableAnswers++
      if (stableAnswers >= 3) return
    } else {
      stableAnswers = 0
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`dsh did not answer on port ${port} within ${READY_TIMEOUT_MS / 1000}s`)
}

/** Resolve the shell's entry URL: the authenticated root once the child has
 * printed it, else the bare loopback root (which dsh now answers with a 401
 * until the token URL arrives). */
function authenticatedRootUrl(port: number): string {
  return dshAuthUrl ?? `http://127.0.0.1:${port}/`
}

/** Cookie-aware readiness probe. Once `dshReadyCookie` is known it reuses it
 * against the clean root; before that it fetches the token URL with redirects
 * disabled to mint the signed session cookie from its 303 `Set-Cookie` — the
 * same exchange a browser performs automatically. */
async function probeReady(port: number): Promise<boolean> {
  if (dshReadyCookie !== undefined) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie: dshReadyCookie } })
      return res.ok
    } catch {
      return false
    }
  }
  try {
    const res = await fetch(authenticatedRootUrl(port), { redirect: 'manual' })
    // No token print yet (still booting): a 401/connection error isn't ready.
    if (res.status !== 303) return res.ok
    const cookie = res.headers.get('set-cookie')?.split(';')[0]
    if (!cookie) return false
    dshReadyCookie = cookie
    const index = await fetch(`http://127.0.0.1:${port}/`, { headers: { cookie } })
    return index.ok
  } catch {
    return false
  }
}

/**
 * Whale icon from `build/` for dev mode (`electron .` uses Electron's default
 * bundle icon, which leaks into the dock, window chrome, and dialogs).
 * Returns `undefined` when packaged — electron-builder bakes the real icon
 * into the bundle/exe there.
 */
function devIcon(): Electron.NativeImage | undefined {
  if (app.isPackaged) return undefined
  const file = join(app.getAppPath(), 'build', 'icon.png')
  return existsSync(file) ? nativeImage.createFromPath(file) : undefined
}

/**
 * Compiled preload path, sibling to `dist/main.js`. Works in dev and asar.
 * The preload is capability-scoped (see `src/preload.ts`) — it never grants
 * generic shell/fs/url access to the renderer.
 */
function preloadPath(): string {
  return fileURLToPath(new URL('./preload.js', import.meta.url))
}

/** Persisted window geometry, restored on the next launch. */
interface WindowState {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

function windowStateFile(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/**
 * Read the last saved window geometry. A state is only honored when it is
 * plausibly sized and at least partially intersects some display's work area —
 * a window saved on a now-unplugged external monitor would otherwise restore
 * off-screen where the user cannot grab it.
 */
function loadWindowState(): WindowState | undefined {
  try {
    const saved = JSON.parse(readFileSync(windowStateFile(), 'utf8')) as Partial<WindowState>
    if (typeof saved.x !== 'number' || typeof saved.y !== 'number') return undefined
    if (typeof saved.width !== 'number' || typeof saved.height !== 'number') return undefined
    if (saved.width < 800 || saved.height < 600) return undefined
    const area = screen.getDisplayMatching(saved as Rectangle).workArea
    const visible =
      saved.x < area.x + area.width &&
      saved.y < area.y + area.height &&
      saved.x + saved.width > area.x &&
      saved.y + saved.height > area.y
    if (!visible) return undefined
    return {
      x: saved.x,
      y: saved.y,
      width: saved.width,
      height: saved.height,
      maximized: saved.maximized === true,
    }
  } catch {
    return undefined
  }
}

/** Save the window's normal (non-maximized) geometry. Never throws. */
function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getNormalBounds()
    const state: WindowState = { ...bounds, maximized: win.isMaximized() }
    writeFileSync(windowStateFile(), JSON.stringify(state) + '\n')
  } catch {
    // non-fatal: a lost geometry falls back to the default on next launch
  }
}

/**
 * Capability-scoped IPC bridges (Task 4 & 5). Every handler is generated
 * from `BRIDGE_CHANNELS` and re-checked by `assertCapabilityAllowed`, so the
 * exposed surface is exactly the allow-list: desktop preferences, a
 * read-only log tail, a read-only release listing, and external-tools
 * management. No shell/fs/url passthrough — a synthesized unknown channel is
 * rejected before dispatch.
 * @module dsh-desktop/capability-ipc
 */

/** Release page used as the read-only GitHub releases source. */
const RELEASES_API = 'https://api.github.com/repos/deepseekhar/dsh-desktop-unified/releases?per_page=10'

/** File holding desktop preferences, under userData. */
function prefsFile(): string {
  return join(app.getPath('userData'), 'desktop-prefs.json')
}

/** Per-bridge handler tables, generated against the allow-list. */
const capabilityHandlers: Record<BridgeName, Record<string, (...args: unknown[]) => unknown>> = {
  desktopPrefs: {
    get: () => {
      try {
        return JSON.parse(readFileSync(prefsFile(), 'utf8'))
      } catch {
        return {}
      }
    },
    set: (prefs: unknown) => {
      writeFileSync(prefsFile(), JSON.stringify(prefs ?? {}, undefined, 2) + '\n', 'utf8')
    },
  },
  logs: {
    // Read-only tail of the single dsh.log — no arbitrary file path accepted.
    tail: (bytes: unknown) => {
      const n = Number(bytes) || 64 * 1024
      const lp = logFile()
      return existsSync(lp) ? readFileSync(lp, 'utf8').slice(-n) : ''
    },
    reveal: () => shell.showItemInFolder(logFile()),
  },
  releases: {
    // Read-only GitHub releases listing; no arbitrary URL fetch.
    list: async () => {
      try {
        const res = await fetch(RELEASES_API, { headers: { 'User-Agent': 'dsh-desktop' } })
        if (!res.ok) return []
        const data = (await res.json()) as Array<{
          tag_name: string
          name: string
          published_at: string
          html_url: string
        }>
        return data.map((r) => ({ tag: r.tag_name, name: r.name, publishedAt: r.published_at, url: r.html_url }))
      } catch {
        return []
      }
    },
  },
  externalTools: {
    list: () => listTools(),
    add: (tool: unknown) => addExternalTool(tool as Omit<ToolConfig, 'id' | 'connected'>),
    remove: (id: unknown) => removeExternalTool(String(id)),
    connect: (id: unknown) => connectTool(String(id)),
    disconnect: (id: unknown) => disconnectTool(String(id)),
    projected: () => projectedTools(),
  },
}

/**
 * Register every whitelisted `bridge:method` handler. Each handler re-checks
 * the allow-list before dispatch, so the surface cannot grow accidentally.
 */
function registerCapabilityIpcHandlers(): void {
  for (const bridge of Object.keys(BRIDGE_CHANNELS) as BridgeName[]) {
    for (const method of BRIDGE_CHANNELS[bridge]) {
      const channel = `${bridge}:${method}`
      ipcMain.handle(channel, (_event, ...args) => {
        assertCapabilityAllowed(bridge, method)
        return capabilityHandlers[bridge][method](...args)
      })
    }
  }
}

/**
 * Create the single application window pointed at the local server.
 * @param port - port the server bound
 */
function createWindow(port: number, prefs: ShellPrefs = loadPrefs()): BrowserWindow {
  const saved = loadWindowState()
  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
    ...(saved === undefined ? {} : { x: saved.x, y: saved.y }),
    minWidth: 800,
    minHeight: 600,
    // frameless 模式移除系统标题栏，改由自绘标题栏（shell-titlebar-preload）接管。
    frame: !prefs.frameless,
    opacity: prefs.opacity,
    alwaysOnTop: prefs.alwaysOnTop,
    title: 'DSH Desktop',
    autoHideMenuBar: true,
    // Used by window chrome on win/linux; ignored on macOS (dock icon is set
    // separately at startup).
    icon: devIcon(),
    webPreferences: {
      // Capability-scoped preload (src/preload.ts): no generic shell/fs/url
      // surface reaches the renderer。shell-titlebar-preload 通过 preload.ts
      // 顶部的 `import './shell-titlebar-preload.js'` 并入（Electron 单窗口仅
      // 支持一个 preload 文件）。contextIsolation 保持开启；sandbox 关闭仅因
      // preload 桥依赖主进程模块。
      preload: preloadPath(),
      contextIsolation: true,
      sandbox: false,
    },
  })
  if (saved?.maximized) win.maximize()
  // Persist geometry (debounced — resize/move fire in bursts) so the next
  // launch reopens where the user left it.
  let saveTimer: NodeJS.Timeout | undefined
  const persist = (): void => {
    if (saveTimer !== undefined) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      if (!win.isDestroyed()) saveWindowState(win)
    }, 300)
  }
  win.on('resize', persist)
  win.on('move', persist)
  // Closing the window hides it to the tray instead of quitting, so long
  // agent tasks keep running in the background (issue #3). Real exit only
  // happens via the tray menu / Cmd+Q, which flips `quitting` first.
  win.on('close', (event) => {
    if (quitting || recreating) return
    event.preventDefault()
    win.hide()
  })
  // Window-level navigation + permission guards (replaces the inline
  // setWindowOpenHandler/will-navigate; adds webview block + trusted
  // clipboard write). Foolgry stays single-window: external links always
  // go to the system browser.
  secureWindow(win)
  installContextMenu(win, isZhLocale)
  // First successful Harness render = this machine's GPU survived boot. After
  // enough clean launches at a degraded level, planStableLaunch probes one
  // level back up.
  win.webContents.on('did-finish-load', () => {
    if (harnessRendered) return
    harnessRendered = true
    const next = planStableLaunch(gpuFallbackState)
    if (!gpuFallbackStateEquals(next, gpuFallbackState)) {
      gpuFallbackState = next
      saveGpuFallbackState(gpuFallbackState)
      appendFileSync(logFile(), `\n=== gpu fallback stable launch probe: level -> ${gpuFallbackState.level} ===\n`)
    }
  })
  // 外壳控制：UI 就绪后把 frameless 状态推给渲染进程，自绘标题栏据此注入/移除。
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('shell:frameless', prefs.frameless)
  })
  // 转发原生最大化态到渲染进程（自绘标题栏按钮同步态）。
  win.on('maximize', () => win.webContents.send('shell:maximized', true))
  win.on('unmaximize', () => win.webContents.send('shell:maximized', false))
  // Renderer/GPU process loss: take over Electron's default black-screen.
  win.webContents.on('render-process-gone', (event, details) => {
    const reason = details?.reason ?? 'unknown'
    if (!isGpuLossFatal(reason)) {
      reloadMainWindowAfterRendererLoss(win)
      return
    }
    event.preventDefault()
    appendFileSync(logFile(), `\n=== render-process-gone: reason=${reason} exitCode=${details?.exitCode ?? -1} harnessRendered=${harnessRendered} ===\n`)
    const plan = planGpuFallbackResponse({ state: gpuFallbackState, harnessRendered })
    gpuFallbackState = plan.state
    saveGpuFallbackState(gpuFallbackState)
    if (plan.relaunch) {
      appendFileSync(logFile(), `\n=== gpu fallback: relaunching at level ${gpuFallbackState.level} ===\n`)
      quitting = true
      tray?.destroy()
      if (dshChild && dshChild.exitCode === null) dshChild.kill()
      app.relaunch()
      app.exit(0)
    }
  })
  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame) return
    // A local Harness reachability failure is usually the renderer dropping,
    // not a real network error.
    appendFileSync(logFile(), `\n=== did-fail-load: errorCode=${errorCode} description=${errorDescription} ===\n`)
    reloadMainWindowAfterRendererLoss(win)
  })
  win.webContents.on('unresponsive', () => {
    appendFileSync(logFile(), `\n=== main window webContents unresponsive ===\n`)
  })
  win.webContents.on('responsive', () => {
    appendFileSync(logFile(), `\n=== main window webContents responsive again ===\n`)
  })
  void win.loadURL(authenticatedRootUrl(port))
  return win
}

/**
 * 按新外壳偏好重建主窗口（无边框切换时由 shell-control 的 /api/shell/frameless
 * 回调触发）。销毁前先落盘几何以保留位置/大小，重建后恢复自定义图标。`recreating`
 * 标志绕过 close-to-tray，避免重建过程中窗口被隐藏到托盘。
 * @param prefs - 新的外壳偏好
 */
function recreateWindow(prefs: ShellPrefs): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow(serverPort, prefs)
    ensureShellIconFromMain(mainWindow)
    return
  }
  saveWindowState(mainWindow)
  recreating = true
  mainWindow.destroy()
  recreating = false
  mainWindow = createWindow(serverPort, prefs)
  ensureShellIconFromMain(mainWindow)
}

/**
 * 外壳控制 IPC 桥：渲染进程里的自绘标题栏（shell-titlebar-preload）通过
 * `shell:window`（send，无返回）触发 minimize/toggle-maximize/close，通过
 * `shell:get-state`（invoke，有返回）查询窗口状态。与既有 capability IPC
 * （window.dshDesktop）互不冲突，仅新增 shell 命名空间。
 */
function registerShellIpc(): void {
  ipcMain.on('shell:window', (_event, msg: unknown) => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return
    const action = msg && typeof msg === 'object' ? (msg as { action?: unknown }).action : undefined
    if (action === 'minimize') {
      win.minimize()
    } else if (action === 'toggle-maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (action === 'close') {
      // close 走既有 close-to-tray 拦截（非 quitting 时隐藏到托盘）。
      win.close()
    }
  })
  ipcMain.handle('shell:get-state', () => {
    const win = mainWindow
    if (!win || win.isDestroyed()) return { ok: false, error: 'window unavailable' }
    return {
      bounds: win.getBounds(),
      maximized: win.isMaximized(),
      minimized: win.isMinimized(),
      fullscreen: win.isFullScreen(),
      alwaysOnTop: win.isAlwaysOnTop(),
      opacity: win.getOpacity(),
      frameless: loadPrefs().frameless,
    }
  })
}

/**
 * Show the main window again (tray click, dock click, second instance).
 * Recreates it if it was somehow destroyed.
 * @param port - port the server bound
 */
function showWindow(port: number, intent: WindowFocusIntent = 'automatic'): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createWindow(port)
    return
  }
  raiseWindowWithoutStealingFocus(mainWindow, process.platform, () => app.isActive(), intent)
}

/** Splash shown from app-ready until the dsh server answers; without it the
 * dock icon appears but nothing responds for the whole boot (worst case:
 * minutes of silent safe-mode retries). */
let splashWindow: BrowserWindow | undefined

/**
 * Small frameless "starting" window. The dsh child may legitimately take tens
 * of seconds (plugin tree, cold disk, recovery retries); this keeps the app
 * visibly alive until the real window can load a live server.
 */
function createSplash(): void {
  const zh = isZhLocale()
  const text = zh ? '正在启动 DSH Desktop…' : 'Starting DSH Desktop…'
  const hint = zh ? '首次启动或插件较多时需要一点时间' : 'First launch or many plugins can take a moment'
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;
background:#fff;color:#333;font:14px -apple-system,"Segoe UI",sans-serif;user-select:none}
@media (prefers-color-scheme:dark){html,body{background:#1e1e1e;color:#ddd}}
.wrap{text-align:center;line-height:1.8}
.spin{width:28px;height:28px;margin:0 auto 14px;border:3px solid #4d6bfe33;
border-top-color:#4d6bfe;border-radius:50%;animation:r .9s linear infinite}
@keyframes r{to{transform:rotate(360deg)}}
small{font-size:12px;opacity:.55}
</style></head><body><div class="wrap"><div class="spin"></div>${text}<br><small>${hint}</small></div></body></html>`
  splashWindow = new BrowserWindow({
    width: 360,
    height: 200,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    title: 'DSH Desktop',
    icon: devIcon(),
  })
  void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  lockZoomFactor(splashWindow.webContents)
}

/** Tear the splash down once its job (covering the boot) is done. */
function destroySplash(): void {
  splashWindow?.destroy()
  splashWindow = undefined
}

/**
 * Explicit failure window, shown after three consecutive child exits. Unlike
 * the splash (which spins indefinitely while recovery dialogs stack), this
 * states the failure plainly and offers bounded actions — retry (resets the
 * counter and re-enters boot), view the log, or quit. Actions are routed via
 * `dsh-desktop:` pseudo-URLs intercepted in `will-navigate`, so the window
 * needs no preload of its own.
 */
function createFailureWindow(attempt: number): void {
  destroySplash()
  const zh = isZhLocale()
  const title = zh ? '启动失败' : 'Startup Failed'
  const msg = zh ? `DSH 已连续 ${attempt} 次启动后立即退出。` : `DSH exited immediately ${attempt} times in a row.`
  const hint = zh
    ? '可能是插件或安装损坏。可重试、查看日志或退出。'
    : 'A plugin or the install may be broken. Retry, view the log, or quit.'
  const retry = zh ? '重试' : 'Retry'
  const logs = zh ? '查看日志' : 'View log'
  const quit = zh ? '退出' : 'Quit'
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;display:flex;align-items:center;justify-content:center;
background:#fff;color:#333;font:14px -apple-system,"Segoe UI",sans-serif;user-select:none}
@media (prefers-color-scheme:dark){html,body{background:#1e1e1e;color:#ddd}}
.wrap{text-align:center;line-height:1.8;max-width:320px}
h1{font-size:16px;margin:0 0 8px}
p{margin:0 0 18px;opacity:.7;font-size:13px}
a{display:inline-block;margin:0 6px;padding:8px 16px;border-radius:6px;text-decoration:none;
color:#fff;background:#4d6bfe;font-size:13px}
a.log{background:#6b7280}
a.quit{background:#ef4444}
</style></head><body><div class="wrap"><h1>${title}</h1><p>${msg}<br>${hint}</p>
<a href="dsh-desktop:retry">${retry}</a><a class="log" href="dsh-desktop:logs">${logs}</a><a class="quit" href="dsh-desktop:quit">${quit}</a>
</div></body></html>`
  failureWindow = new BrowserWindow({
    width: 420,
    height: 240,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    title: 'DSH Desktop',
    icon: devIcon(),
  })
  secureWindow(failureWindow)
  void failureWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  failureWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    const action = url.replace('dsh-desktop:', '')
    if (action === 'retry') {
      failureWindow?.destroy()
      failureWindow = undefined
      void retryBoot()
    } else if (action === 'logs') {
      shell.showItemInFolder(logFile())
    } else if (action === 'quit') {
      quitting = true
      app.quit()
    }
  })
}

/**
 * Re-enter boot after an explicit failure-retry. Resets the consecutive-exit
 * counter, recreates the splash, and runs boot again; a second failure simply
 * re-shows the failure window, so the loop stays bounded and user-driven.
 */
async function retryBoot(): Promise<void> {
  consecutiveExitFailures = 0
  createSplash()
  try {
    await boot()
  } catch (error) {
    destroySplash()
    dialog.showErrorBox(
      'DSH Desktop 启动失败',
      `${error instanceof Error ? error.message : String(error)}\n\n日志：${logFile()}`,
    )
    app.quit()
  }
}

/**
 * External-tools settings window: lists configured Codex / Claude Code
 * connections and their connected state, with add / remove / connect /
 * disconnect. It reuses the capability-scoped preload (externalTools bridge),
 * so every action is one of the whitelisted channels — no shell/fs passthrough.
 */
function createExternalToolsWindow(): void {
  const zh = isZhLocale()
  const title = zh ? '外部工具' : 'External Tools'
  const name = zh ? '名称' : 'Name'
  const cmd = zh ? '命令' : 'Command'
  const kind = zh ? '类型' : 'Kind'
  const status = zh ? '状态' : 'Status'
  const actions = zh ? '操作' : 'Actions'
  const connect = zh ? '连接' : 'Connect'
  const disconnect = zh ? '断开' : 'Disconnect'
  const remove = zh ? '移除' : 'Remove'
  const add = zh ? '添加' : 'Add'
  const codex = zh ? '已连接' : 'Connected'
  const offline = zh ? '未连接' : 'Offline'
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;padding:16px;font:14px -apple-system,"Segoe UI",sans-serif;color:#333;background:#fff}
@media (prefers-color-scheme:dark){body{background:#1e1e1e;color:#ddd}}
table{width:100%;border-collapse:collapse;margin-bottom:12px}
th,td{border:1px solid #4443;padding:6px 8px;text-align:left;font-size:13px}
th{background:#0000000a}
button{padding:4px 10px;margin-right:4px;border:1px solid #888;border-radius:4px;background:#fff;cursor:pointer;font-size:12px}
@media (prefers-color-scheme:dark){button{background:#2a2a2a;color:#ddd;border-color:#555}}
.row{display:flex;gap:8px;margin-bottom:12px}
input,select{padding:5px 8px;border:1px solid #888;border-radius:4px;font-size:13px}
input[name=name]{width:120px} input[name=command]{flex:1}
</style></head><body><h2 style="font-size:16px">${title}</h2>
<div class="row"><input name="name" placeholder="${name}"/>
<select name="kind"><option value="codex">codex</option><option value="claude-code">claude-code</option></select>
<input name="command" placeholder="${cmd}"/><button id="add">${add}</button></div>
<table><thead><tr><th>${name}</th><th>${kind}</th><th>${cmd}</th><th>${status}</th><th>${actions}</th></tr></thead>
<tbody id="rows"></tbody></table>
<script>
var api = window.dshDesktop && window.dshDesktop.externalTools;
var rows = document.getElementById('rows');
var addBtn = document.getElementById('add');
function esc(s){return String(s).replace(/[&<>]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;'}[c];});}
async function render(){
  if(!api){rows.innerHTML='<tr><td colspan="5">bridge unavailable</td></tr>';return;}
  var tools = await api.list();
  var html = tools.length ? tools.map(function(t){
    var toggle = t.connected ? '${disconnect}' : '${connect}';
    var st = t.connected ? '${codex}' : '${offline}';
    return '<tr><td>'+esc(t.name)+'</td><td>'+esc(t.kind)+'</td><td>'+esc(t.command)+'</td>'
      + '<td>'+st+'</td>'
      + '<td><button data-id="'+esc(t.id)+'" data-act="toggle">'+toggle+'</button> '
      + '<button data-id="'+esc(t.id)+'" data-act="remove">${remove}</button></td></tr>';
  }).join('') : '<tr><td colspan="5" style="opacity:.6">no tools configured</td></tr>';
  rows.innerHTML = html;
}
rows.addEventListener('click', async function(e){
  var b = e.target.closest('button'); if(!b) return;
  var id = b.dataset.id;
  if(b.dataset.act==='remove') await api.remove(id);
  else if(b.dataset.act==='toggle') await (b.textContent.indexOf('${disconnect}')>=0 ? api.disconnect(id) : api.connect(id));
  render();
});
addBtn.addEventListener('click', async function(){
  var name = document.querySelector('input[name=name]').value.trim();
  var command = document.querySelector('input[name=command]').value.trim();
  var k = document.querySelector('select[name=kind]').value;
  if(!name || !command) return;
  await api.add({name:name, kind:k, command:command});
  document.querySelector('input[name=name]').value='';
  document.querySelector('input[name=command]').value='';
  render();
});
render();
</script></body></html>`
  const win = new BrowserWindow({
    width: 560,
    height: 440,
    title,
    webPreferences: { preload: preloadPath(), contextIsolation: true, sandbox: false },
  })
  secureWindow(win)
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

/**
 * Create the system-tray icon with a show/quit menu. The tray owns the app
 * lifecycle once the window is hidden: left-click restores the window,
 * "Quit" is the only path that tears down the dsh child.
 * @param port - port the server bound
 */
function createTray(port: number): void {
  // Declare the 36px PNG as a @2x representation so its logical size is
  // 18pt — status-item images are laid out in points, and a 1x image would
  // be clipped to the menu-bar height and look oversized.
  const icon = nativeImage.createEmpty()
  icon.addRepresentation({ scaleFactor: 2, dataURL: TRAY_ICON_DATA_URL })
  // macOS menu bar: render as an adaptive monochrome silhouette so the whale
  // stays visible on both light and dark menu bars. Windows keeps the color
  // icon in the notification area.
  if (process.platform === 'darwin') icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('DSH Desktop')
  // Menu labels follow the OS locale; the rest of the app's dialogs remain
  // Chinese-first for now.
  const zh = isZhLocale()
  const labels = zh
    ? { show: '显示 DSH Desktop', update: '检查更新…', tools: '外部工具…', logs: '打开日志', data: '打开数据目录', restore: '恢复被禁用的插件并重启', quit: '退出 DSH Desktop' }
    : { show: 'Show DSH Desktop', update: 'Check for Updates…', tools: 'External Tools…', logs: 'Open log', data: 'Open data folder', restore: 'Restore disabled plugins and restart', quit: 'Quit DSH Desktop' }
  // Recovery actions survive the crash that triggered them, so the restore
  // item is offered whenever the record is non-empty — not only right after
  // a safe-mode boot.
  const recovery = loadRecoveryActions(safeModeStateFile()).length > 0
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.show, click: () => showWindow(port, 'user') },
      { label: labels.update, click: () => void manualUpdateCheck() },
      // Troubleshooting entries: the log is the first place to look when the
      // UI misbehaves, and the data dir holds profiles/sessions/plugins.
      { label: labels.logs, click: () => shell.showItemInFolder(logFile()) },
      { label: labels.data, click: () => void shell.openPath(dshHome()) },
      { label: labels.tools, click: () => createExternalToolsWindow() },
      ...(recovery
        ? ([
            { type: 'separator' },
            { label: labels.restore, click: () => restorePluginsAndRelaunch() },
          ] as const)
        : []),
      { label: isZhLocale() ? '回滚到上次良好状态' : 'Restore last good state', click: () => void restoreLastGoodAndRelaunch() },
      {
        label: isZhLocale() ? '档案' : 'Profile',
        submenu: PROFILES.map((p) => ({
          label: p,
          type: 'radio' as const,
          checked: p === activeProfile(),
          click: () => {
            if (p === activeProfile()) return
            setActiveProfile(p as ProfileName)
            quitting = true
            tray?.destroy()
            if (dshChild && dshChild.exitCode === null) dshChild.kill()
            app.relaunch()
            app.exit(0)
          },
        })),
      },
      { type: 'separator' },
      {
        label: labels.quit,
        click: () => {
          quitting = true
          app.quit()
        },
      },
    ]),
  )
  tray.on('click', () => showWindow(port, 'user'))
}

/** Homebrew cask token for installs that came from the community tap. */
const BREW_CASK = 'dsh-desktop'
/** Absolute brew locations — GUI apps inherit no shell PATH. */
const BREW_BINS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew']

function brewBin(): string | undefined {
  return BREW_BINS.find((bin) => existsSync(bin))
}

/** Whether this installation is managed by Homebrew (the cask is installed). */
function isBrewManaged(): boolean {
  const brew = brewBin()
  if (!brew) return false
  try {
    return spawnSync(brew, ['list', '--cask', BREW_CASK], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

/** Path of the .app bundle this process runs from (the `xattr -cr` target). */
function appBundlePath(): string {
  const marker = '.app/'
  const idx = process.execPath.indexOf(marker)
  return idx === -1 ? process.execPath : process.execPath.slice(0, idx + marker.length - 1)
}

/**
 * Proxy environment for update subprocesses. GUI launches inherit a bare
 * launchd env with no proxy variables, so brew/curl go direct to GitHub's
 * asset CDN — which for users behind a proxy crawls and then dies with
 * curl(56). Read macOS's system proxy via scutil and translate it into the
 * standard *_PROXY variables brew and curl honor.
 */
function systemProxyEnv(): NodeJS.ProcessEnv {
  if (process.platform !== 'darwin') return {}
  try {
    const out = spawnSync('/usr/sbin/scutil', ['--proxy'], { encoding: 'utf8' }).stdout ?? ''
    const get = (key: string): string | undefined =>
      out.match(new RegExp(`^\\s*${key}\\s*:\\s*(\\S+)`, 'm'))?.[1]
    if (get('HTTPSEnable') === '1' && get('HTTPSProxy') !== undefined) {
      const server = `http://${get('HTTPSProxy')}:${get('HTTPSPort') ?? '443'}`
      return { HTTPS_PROXY: server, HTTP_PROXY: server, ALL_PROXY: server }
    }
    if (get('HTTPEnable') === '1' && get('HTTPProxy') !== undefined) {
      const server = `http://${get('HTTPProxy')}:${get('HTTPPort') ?? '80'}`
      return { HTTPS_PROXY: server, HTTP_PROXY: server, ALL_PROXY: server }
    }
    if (get('SOCKSEnable') === '1' && get('SOCKSProxy') !== undefined) {
      return { ALL_PROXY: `socks5://${get('SOCKSProxy')}:${get('SOCKSPort') ?? '1080'}` }
    }
  } catch {
    // no proxy info readable; fall back to a direct connection
  }
  return {}
}

/** Run a command with output appended to the dsh log; resolves the exit code. */
function runLogged(command: string, args: string[]): Promise<number | null> {
  return new Promise((resolve) => {
    appendFileSync(logFile(), `\n=== update: ${command} ${args.join(' ')} ===\n`)
    const child = spawn(command, args, { env: { ...process.env, ...systemProxyEnv() } })
    child.stdout?.on('data', (chunk: Buffer) => appendFileSync(logFile(), chunk))
    child.stderr?.on('data', (chunk: Buffer) => appendFileSync(logFile(), chunk))
    child.on('error', () => resolve(null))
    child.on('exit', (code) => resolve(code))
  })
}

/**
 * macOS update path for Homebrew-managed installs: `brew upgrade --cask`,
 * clear the quarantine attribute the unsigned build trips over, then offer an
 * immediate relaunch. Failures fall back to the manual releases page.
 */
async function runBrewUpdate(): Promise<void> {
  const brew = brewBin()
  if (!brew) return
  const code = await runLogged(brew, ['upgrade', '--cask', BREW_CASK])
  if (code !== 0) {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      title: '更新失败',
      message: '通过 Homebrew 升级没有完成。',
      detail: `brew 的输出见日志：${logFile()}\n也可以从发布页手动下载最新版本安装。`,
      buttons: ['打开发布页', '稍后'],
    })
    if (response === 0) void shell.openExternal(RELEASES_URL)
    return
  }
  await runLogged('/usr/bin/xattr', ['-cr', appBundlePath()])
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '更新已安装',
    message: '新版本已通过 Homebrew 安装完成。',
    detail: '现在重启 DSH Desktop 以使用新版本吗？',
    buttons: ['重启', '稍后'],
  })
  if (response !== 0) return
  // app.exit() skips will-quit, so tear down the tray and dsh child here —
  // an orphaned dsh server would otherwise keep holding its port.
  quitting = true
  tray?.destroy()
  if (dshChild && dshChild.exitCode === null) dshChild.kill()
  app.relaunch()
  app.exit(0)
}

/**
 * macOS update prompt: unsigned builds cannot update themselves, so offer the
 * Homebrew path when the cask manages this install, else point at the
 * releases page for a manual download.
 */
async function promptMacUpdate(version: string): Promise<void> {
  const brewManaged = isBrewManaged()
  const { response } = await dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `DSH Desktop ${version} 已发布。`,
    detail: brewManaged
      ? '当前安装由 Homebrew 管理，可以原地升级，完成后应用会自动重启。'
      : 'macOS 版本未签名，无法自动更新。请从发布页下载最新安装包。',
    buttons: brewManaged ? ['通过 Homebrew 更新', '从 GitHub 下载', '稍后'] : ['打开发布页', '稍后'],
  })
  if (brewManaged && response === 0) await runBrewUpdate()
  else if (response === (brewManaged ? 1 : 0)) void shell.openExternal(RELEASES_URL)
}

/** Version already prompted for this run, so 4-hourly checks don't re-nag. */
let promptedVersion: string | undefined
/** Set once a background download starts; gates the error dialog to real
 * download failures instead of transient network errors from checkForUpdates. */
let downloadInFlight = false
/** The wired updater, set once the dynamic import in setupAutoUpdate lands. */
let updater: AppUpdater | undefined
/** Re-entrancy guard for the menu-triggered check; also routes the outcome. */
let manualCheckInFlight = false
/** Whether the in-flight manual check found an update (set by the event). */
let manualSawUpdate = false

/**
 * Menu/tray-triggered update check. Unlike the silent 4-hourly poll, a manual
 * click always reports back: re-prompts even for an already-nagged version,
 * says so when already current, and surfaces network failures.
 */
async function manualUpdateCheck(): Promise<void> {
  if (manualCheckInFlight) return
  const zh = isZhLocale()
  if (!app.isPackaged || !updater) {
    await dialog.showMessageBox({
      type: 'info',
      title: zh ? '检查更新' : 'Check for Updates',
      message: zh ? '开发模式不检查更新。' : 'Update checks are disabled in development mode.',
    })
    return
  }
  manualCheckInFlight = true
  manualSawUpdate = false
  promptedVersion = undefined
  try {
    await updater.checkForUpdates()
  } catch {
    // the error event already logged the detail
    await dialog.showMessageBox({
      type: 'error',
      title: zh ? '检查更新失败' : 'Update Check Failed',
      message: zh ? '无法连接到更新服务器，请检查网络后重试。' : 'Could not reach the update server. Check your network and retry.',
    })
    return
  } finally {
    manualCheckInFlight = false
  }
  if (manualSawUpdate) {
    // macOS already shows its prompt from the update-available handler.
    if (process.platform !== 'darwin') {
      await dialog.showMessageBox({
        type: 'info',
        title: zh ? '发现新版本' : 'Update Available',
        message: zh ? '发现新版本，正在后台下载，完成后会提示你重启。' : 'A new version is downloading in the background; you will be prompted to restart.',
      })
    }
    return
  }
  await dialog.showMessageBox({
    type: 'info',
    title: zh ? '检查更新' : 'Check for Updates',
    message: zh ? `当前已是最新版本（${app.getVersion()}）。` : `You are on the latest version (${app.getVersion()}).`,
  })
}

/**
 * Application menu with a manual "Check for Updates" entry. Every visible
 * label is set explicitly — Electron's composite roles (fileMenu/editMenu/…)
 * hardcode English labels, which left the menu mixed-language next to the
 * localized tray. Roles stay attached so behaviors and accelerators (macOS
 * copy/paste especially) keep working.
 */
/** About dialog showing both the desktop version and the bundled Harness version. */
async function showAbout(): Promise<void> {
  const zh = isZhLocale()
  await dialog.showMessageBox({
    type: 'info',
    title: zh ? '关于 DSH Desktop' : 'About DSH Desktop',
    message: 'DeepSeek Harness',
    detail: aboutDetail(app.getVersion(), bundledHarnessVersion(app.getAppPath()), zh ? 'zh' : 'en'),
    buttons: ['确定'],
  })
}

function setupAppMenu(): void {
  const zh = isZhLocale()
  const t = zh
    ? {
        about: '关于 DSH Desktop', services: '服务', hide: '隐藏 DSH Desktop', hideOthers: '隐藏其他', unhide: '显示全部',
        quit: '退出 DSH Desktop', file: '文件', close: '关闭窗口',
        edit: '编辑', undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
        view: '查看', reload: '重新加载', devtools: '切换开发者工具', resetZoom: '实际大小', zoomIn: '放大', zoomOut: '缩小', fullscreen: '切换全屏',
        window: '窗口', minimize: '最小化', zoom: '缩放', help: '帮助',
      }
    : {
        about: 'About DSH Desktop', services: 'Services', hide: 'Hide DSH Desktop', hideOthers: 'Hide Others', unhide: 'Show All',
        quit: 'Quit DSH Desktop', file: 'File', close: 'Close Window',
        edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
        view: 'View', reload: 'Reload', devtools: 'Toggle Developer Tools', resetZoom: 'Actual Size', zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullscreen: 'Toggle Full Screen',
        window: 'Window', minimize: 'Minimize', zoom: 'Zoom', help: 'Help',
      }
  const checkItem: Electron.MenuItemConstructorOptions = {
    label: zh ? '检查更新…' : 'Check for Updates…',
    click: () => void manualUpdateCheck(),
  }
  const editMenu: Electron.MenuItemConstructorOptions = {
    label: t.edit,
    submenu: [
      { role: 'undo', label: t.undo },
      { role: 'redo', label: t.redo },
      { type: 'separator' },
      { role: 'cut', label: t.cut },
      { role: 'copy', label: t.copy },
      { role: 'paste', label: t.paste },
      { role: 'selectAll', label: t.selectAll },
    ],
  }
  const viewMenu: Electron.MenuItemConstructorOptions = {
    label: t.view,
    submenu: [
      { role: 'reload', label: t.reload },
      { role: 'toggleDevTools', label: t.devtools },
      { type: 'separator' },
      { role: 'resetZoom', label: t.resetZoom },
      { role: 'zoomIn', label: t.zoomIn },
      { role: 'zoomOut', label: t.zoomOut },
      { type: 'separator' },
      { role: 'togglefullscreen', label: t.fullscreen },
    ],
  }
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: app.name,
          submenu: [
            { label: t.about, click: () => void showAbout() },
            { type: 'separator' },
            checkItem,
            { type: 'separator' },
            { role: 'services', label: t.services },
            { type: 'separator' },
            { role: 'hide', label: t.hide },
            { role: 'hideOthers', label: t.hideOthers },
            { role: 'unhide', label: t.unhide },
            { type: 'separator' },
            { role: 'quit', label: t.quit },
          ],
        },
        { label: t.file, submenu: [{ role: 'close', label: t.close }] },
        editMenu,
        viewMenu,
        {
          label: t.window,
          submenu: [
            { role: 'minimize', label: t.minimize },
            { role: 'zoom', label: t.zoom },
          ],
        },
      ]),
    )
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: t.file, submenu: [{ role: 'quit', label: t.quit }] },
      editMenu,
      viewMenu,
      {
        label: t.help,
        submenu: [checkItem, { type: 'separator' }, { label: t.about, click: () => void showAbout() }],
      },
    ]),
  )
}

/**
 * Wire electron-updater: check on start and then every 4 hours. Windows
 * downloads in the background and offers a restart-to-update dialog; macOS
 * skips the doomed self-update (unsigned builds) and goes straight to the
 * Homebrew / manual-download prompt.
 */
function setupAutoUpdate(): void {
  if (!app.isPackaged) return
  // electron-updater is CJS and exposes autoUpdater via an Object.defineProperty
  // getter, which cjs-module-lexer cannot see — under NodeNext ESM the named
  // import is undefined and only `default` (module.exports) carries it.
  void import('electron-updater').then((mod) => {
    const { autoUpdater } = (mod as unknown as { default?: typeof mod }).default ?? mod
    updater = autoUpdater
    autoUpdater.autoDownload = process.platform !== 'darwin'
    autoUpdater.on('update-available', (info) => {
      if (manualCheckInFlight) manualSawUpdate = true
      if (process.platform === 'darwin') {
        if (info.version === promptedVersion) return
        promptedVersion = info.version
        void promptMacUpdate(info.version)
      } else {
        downloadInFlight = true
      }
    })
    autoUpdater.on('update-downloaded', (info) => {
      downloadInFlight = false
      void dialog
        .showMessageBox({
          type: 'info',
          title: '更新已就绪',
          message: `DSH Desktop ${info.version} 已下载完成。`,
          detail: '现在重启以应用更新。不重启的话，下次退出应用时也会自动安装。',
          buttons: ['重启并更新', '稍后'],
        })
        .then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall(true, true)
        })
    })
    autoUpdater.on('error', (error) => {
      appendFileSync(logFile(), `\n=== auto-update error: ${error.message} ===\n`)
      if (!downloadInFlight) return
      downloadInFlight = false
      void dialog
        .showMessageBox({
          type: 'info',
          title: '发现新版本',
          message: '有新版本可用，但无法自动安装。',
          detail: '请从发布页下载最新安装包。',
          buttons: ['打开发布页', '稍后'],
        })
        .then(({ response }) => {
          if (response === 0) void shell.openExternal(RELEASES_URL)
        })
    })
    const check = (): void => {
      autoUpdater.checkForUpdates().catch(() => {
        // transient network failure; the next scheduled check retries
      })
    }
    check()
    setInterval(check, 4 * 60 * 60 * 1000)
  }).catch((error: Error) => {
    appendFileSync(logFile(), `\n=== auto-update setup failed: ${error.message} ===\n`)
  })
}

let dshChild: ChildProcess | undefined
let mainWindow: BrowserWindow | undefined
let tray: Tray | undefined
/** Port the dsh server bound; kept so hidden-window restores can recreate the window. */
let serverPort = 0
/**
 * Authenticated Web URL for the current boot. dsh 0.1.2-alpha serves every
 * request a minimal 401 except the root path carrying its launch token
 * (`GET /?token=<launchToken>`), which mints the signed session cookie. The
 * shell parses this URL off the child's stdout and uses it both for the
 * readiness probe and as the window's load target. Resets each boot attempt.
 */
let dshAuthUrl: string | undefined
/**
 * Session cookie learned from the process-token exchange. Node's fetch does
 * not carry a cookie jar, so the readiness probe mints the signed cookie from
 * the token URL's 303 `Set-Cookie` once, then reuses it across probes (the
 * window itself uses Chromium's real jar and needs no help). Reset per boot.
 */
let dshReadyCookie: string | undefined
/** Set only by an explicit quit (tray menu, Cmd+Q); guards the close-to-tray interception. */
let quitting = false
/** Set during a shell-control-driven window rebuild, so the old window's close
 * handler lets it be destroyed instead of hiding to the tray. */
let recreating = false
/** Set once the server is ready and the window/tray exist; `activate` before
 * that point would otherwise create a window pointed at a dead port. */
let booted = false
/** Consecutive times the dsh child exited before readiness. 3 => explicit failure. */
let consecutiveExitFailures = 0
/** Explicit failure window shown after 3 consecutive exits, replacing the splash. */
let failureWindow: BrowserWindow | undefined
/** GPU 沙箱降级状态：启动前从 userData 读入，崩溃时改写。 */
let gpuFallbackState: GpuFallbackState = defaultGpuFallbackState
/** 本机这次启动的 Harness 是否已成功渲染过（决定 GPU 丢失是否致命）。 */
let harnessRendered = false
/** 主窗口渲染器崩溃重载限流的计数与上次时间。 */
let mainWindowRecoveryReloadAt = 0
let mainWindowRecoveryReloadCount = 0

/**
 * Ask the user about one recovery step. "View log" reveals the log in the
 * file manager and re-shows the same dialog; anything else resolves the
 * final choice.
 * @param options - dialog text; `confirm` is the recovery button label
 * @returns whether the user approved the recovery action
 */
async function confirmRecovery(options: { title: string; message: string; detail: string; confirm: string }): Promise<boolean> {
  for (;;) {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: options.title,
      message: options.message,
      detail: `${options.detail}\n\n日志：${logFile()}`,
      buttons: [options.confirm, '查看日志', '退出'],
      defaultId: 0,
      cancelId: 2,
    })
    if (response === 1) {
      shell.showItemInFolder(logFile())
      continue
    }
    return response === 0
  }
}

/**
 * Decide the next recovery step after a failed boot attempt, escalating one
 * rung at a time: silent retry → disable the blamed plugin entry → remove an
 * unloadable bundle → full safe mode (every self-installed plugin off). Each
 * rung is tried at most once per session (`tried`) and every mutation goes
 * through the confirmation dialog before being recorded for the tray's
 * restore item.
 * @param attempt - 1-based count of the attempt that just failed
 * @param tried - recovery rungs already applied this session
 * @returns whether to retry booting after the applied fix
 */
async function proposeRecovery(attempt: number, tried: Set<string>): Promise<boolean> {
  // First failure may be transient (port race, slow disk): retry silently.
  if (attempt === 1) return true
  const culprit = findCulprit(readLastAttemptLog(logFile()))
  const profileDir = webProfileDir()
  if (culprit?.kind === 'apply' && !tried.has(`entry:${culprit.entryId}`)) {
    tried.add(`entry:${culprit.entryId}`)
    const approved = await confirmRecovery({
      title: '插件加载失败',
      message: `插件「${culprit.packageName}」导致 DSH 无法启动。`,
      detail:
        '是否只禁用这个插件并重试？之后可以随时在插件市场重新启用。' +
        '如果问题持续存在，请向插件作者反馈。',
      confirm: '禁用插件并重试',
    })
    if (!approved) return false
    const block = disableEntry(join(profileDir, 'cordis.patch.yml'), culprit.entryId)
    if (block !== undefined) {
      recordRecoveryAction(safeModeStateFile(), { type: 'disable-entry', entryId: culprit.entryId, block })
      appendFileSync(logFile(), `\n=== safe mode: disabled plugin entry "${culprit.entryId}" (${culprit.packageName}) ===\n`)
    } else {
      appendFileSync(logFile(), `\n=== safe mode: plugin entry "${culprit.entryId}" was already disabled ===\n`)
    }
    return true
  }
  if (!tried.has('snapshot') && culprit !== undefined && attempt >= 2) {
    tried.add('snapshot')
    const snapshot = latestSnapshot(dshHome(), activeProfile())
    if (snapshot !== undefined) {
      const approved = await confirmRecovery({
        title: '启动失败',
        message: '检测到插件安装前的备份快照，是否回滚到最后一次良好状态？',
        detail: '回滚将把 profile 的插件 bundles 恢复到最近一次安装操作之前的状态。',
        confirm: '回滚并重试',
      })
      if (!approved) return false
      const hint = restoreSnapshot(dshHome(), activeProfile(), snapshot)
      appendFileSync(logFile(), `\n=== safe mode: rolled back to snapshot ${snapshot.id} (${hint}) ===\n`)
      recordRecoveryAction(safeModeStateFile(), { type: 'snapshot-restore', id: snapshot.id })
      return true
    }
  }
  if (culprit?.kind === 'unresolvable' && !tried.has(`bundle:${culprit.packageName}`)) {
    tried.add(`bundle:${culprit.packageName}`)
    const approved = await confirmRecovery({
      title: '插件文件缺失',
      message: `插件「${culprit.packageName}」无法加载，它的文件缺失或不完整。`,
      detail:
        '是否把它从启动列表中移除并重试？插件本体仍然保留，之后可以通过托盘菜单' +
        '「恢复被禁用的插件」还原，或在插件市场重新安装。',
      confirm: '移除插件并重试',
    })
    if (!approved) return false
    removeBundle(join(profileDir, 'package.json'), culprit.packageName)
    recordRecoveryAction(safeModeStateFile(), { type: 'remove-bundle', packageName: culprit.packageName })
    appendFileSync(logFile(), `\n=== safe mode: removed bundle "${culprit.packageName}" from the profile ===\n`)
    return true
  }
  if (culprit?.kind === 'slot-conflict' && !tried.has(`slot:${culprit.slotName}`)) {
    tried.add(`slot:${culprit.slotName}`)
    const approved = await confirmRecovery({
      title: '插件插槽冲突',
      message: `检测到插件插槽冲突（插槽：${culprit.slotName}），导致 DSH 无法启动。`,
      detail:
        '是否以安全模式启动？所有自行安装的插件都会被禁用（内置功能不受影响），' +
        '启动成功后可通过托盘菜单「恢复被禁用的插件」一键还原。插槽冲突通常无法定位到' +
        '单个插件，故采用整体禁用再逐个恢复的方式。',
      confirm: '以安全模式启动',
    })
    if (!approved) return false
    const action = enterFullSafeMode(dshHome(), profileDir, WEB_PROFILE_TEMPLATE)
    recordRecoveryAction(safeModeStateFile(), action)
    appendFileSync(logFile(), `\n=== safe mode: slot conflict "${culprit.slotName}" -> full plugin strip, removed bundles: ${action.removedBundles.join(', ') || '(none)'} ===\n`)
    return true
  }
  if (!tried.has('full')) {
    tried.add('full')
    const approved = await confirmRecovery({
      title: '启动失败',
      message: 'DSH 多次启动失败，且无法定位到具体某个插件。',
      detail:
        '是否以安全模式启动？所有自行安装的插件都会被禁用（内置功能不受影响）。' +
        '启动成功后，可通过托盘菜单「恢复被禁用的插件」一键还原。\n\n' +
        '如果安全模式也起不来，多半是安装本身坏了——请重新下载安装最新版本。',
      confirm: '以安全模式启动',
    })
    if (!approved) return false
    const action = enterFullSafeMode(dshHome(), profileDir, WEB_PROFILE_TEMPLATE)
    recordRecoveryAction(safeModeStateFile(), action)
    appendFileSync(logFile(), `\n=== safe mode: full plugin strip, removed bundles: ${action.removedBundles.join(', ') || '(none)'} ===\n`)
    return true
  }
  return false
}

/**
 * Tray-menu restore: undo every recorded safe-mode mutation and relaunch so
 * the profile boots with the restored plugins. Uses `app.exit` like the
 * Homebrew update path, so the child and tray are torn down manually first.
 */
function restorePluginsAndRelaunch(): void {
  restoreAll(safeModeStateFile(), dshHome(), webProfileDir())
  appendFileSync(logFile(), `\n=== safe mode: all recovery actions restored, relaunching ===\n`)
  quitting = true
  tray?.destroy()
  if (dshChild && dshChild.exitCode === null) dshChild.kill()
  app.relaunch()
  app.exit(0)
}

async function restoreLastGoodAndRelaunch(): Promise<void> {
  const snap = latestSnapshot(dshHome(), activeProfile())
  if (!snap) {
    await dialog.showMessageBox({ type: 'info', message: isZhLocale() ? '没有可用的备份快照。' : 'No snapshot available.' })
    return
  }
  const { response } = await dialog.showMessageBox({
    type: 'warning',
    title: isZhLocale() ? '回滚快照' : 'Restore snapshot',
    message: isZhLocale() ? `回滚到 ${snap.exportedAt} 的状态？` : `Restore to ${snap.exportedAt}?`,
    buttons: [isZhLocale() ? '回滚并重启' : 'Restore & Relaunch', isZhLocale() ? '取消' : 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  })
  if (response !== 0) return
  restoreSnapshot(dshHome(), activeProfile(), snap)
  appendFileSync(logFile(), `\n=== safe mode: manual snapshot restore ${snap.id} from tray ===\n`)
  quitting = true
  tray?.destroy()
  if (dshChild && dshChild.exitCode === null) dshChild.kill()
  app.relaunch()
  app.exit(0)
}

/**
 * Boot the dsh server with the safe-mode recovery ladder: retry on failure,
 * and when the loader's error names a plugin, offer to neutralize just that
 * plugin before escalating to a full plugin-free boot. Throws only when the
 * user declines recovery or every rung has been exhausted.
 */
async function boot(): Promise<void> {
  ensureProfileSeed(activeProfile())
  presetBundledPlugins()
  preheatProfileNodeModules()
  const tried = new Set<string>()
  let attempt = 0
  for (;;) {
    attempt++
    const port = await pickPort()
    serverPort = port
    dshChild = startDsh(port)
    try {
      await waitReady(port, dshChild)
      consecutiveExitFailures = 0
      destroySplash()
      const prefs = loadPrefs()
      mainWindow = createWindow(port, prefs)
      ensureShellIconFromMain(mainWindow)
      void startShellControl(() => mainWindow, recreateWindow)
      createTray(port)
      booted = true
      if (attempt > 1) appendFileSync(logFile(), `\n=== boot succeeded after ${attempt - 1} failed attempt(s) ===\n`)
      return
    } catch (error) {
      appendFileSync(
        logFile(),
        `\n=== boot attempt ${attempt} failed: ${error instanceof Error ? error.message : String(error)} ===\n`,
      )
      // A child that exits before readiness (non-null exit code) counts toward
      // the consecutive-failure threshold; a hung child (readiness timeout
      // without exit) does not, since it never got far enough to "fail fast".
      const exitedImmediately = dshChild.exitCode !== null
      if (exitedImmediately) {
        consecutiveExitFailures++
        appendFileSync(logFile(), `=== consecutive exit failures: ${consecutiveExitFailures} ===\n`)
        if (consecutiveExitFailures >= 3) {
          appendFileSync(logFile(), `=== giving up the recovery loop after ${consecutiveExitFailures} consecutive exits; showing failure window ===\n`)
          createFailureWindow(consecutiveExitFailures)
          return
        }
      }
      // A hung child (readiness timeout without exit) still holds its port.
      if (dshChild.exitCode === null) dshChild.kill()
      if (!(await proposeRecovery(attempt, tried))) throw error
    }
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  // GPU sandbox degradation switches must be applied before Chromium starts
  // (no effect after ready). Loaded from userData; default level = no switches.
  // getPath may be unavailable this early on some builds, so degrade safely to
  // the default level (first-launch behaviour) rather than crash startup.
  try {
    gpuFallbackState = loadGpuFallbackState()
  } catch {
    gpuFallbackState = defaultGpuFallbackState
  }
  for (const sw of gpuFallbackSwitches(gpuFallbackState.level)) {
    app.commandLine.appendSwitch(sw)
  }
  try {
    appendFileSync(logFile(), `\n=== gpu fallback level: ${gpuFallbackState.level} ===\n`)
  } catch {
    // 日志在 ready 前可能不可用，忽略
  }

  app.on('second-instance', (_event, argv) => {
    // A rogue LaunchAgent daemonising this binary, or a synthetic launch
    // carrying a script argument, is not a user focus request — ignore both.
    if (isDaemonLaunch(process.env, process.platform)) {
      try {
        appendFileSync(logFile(), `\n=== second-instance ignored: daemon launch (LaunchAgent guard) ===\n`)
      } catch { /* 忽略 */ }
      return
    }
    if (!isUserInitiatedInstance(argv)) {
      try {
        appendFileSync(logFile(), `\n=== second-instance ignored: synthetic launch (script argument) ===\n`)
      } catch { /* 忽略 */ }
      return
    }
    // Re-launching the app while it lives in the tray brings the window back
    // without stealing focus from the user's current app (macOS).
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      raiseWindowWithoutStealingFocus(win, process.platform, () => app.isActive(), 'automatic')
    }
  })

  app.whenReady().then(async () => {
    // Dev mode only: replace Electron's default dock icon with the whale.
    const icon = devIcon()
    if (icon && process.platform === 'darwin') app.dock?.setIcon(icon)
    setupAppMenu()
    setupAutoUpdate()
    // Capability-scoped IPC bridges: register before the window/preload load,
    // so the renderer's `window.dshDesktop` surface is live on first paint.
    registerCapabilityIpcHandlers()
    // 外壳控制 IPC 桥（自绘标题栏 send/invoke），与 capability 桥共存。
    registerShellIpc()
    createSplash()
    try {
      await boot()
    } catch (error) {
      destroySplash()
      dialog.showErrorBox(
        'DSH Desktop 启动失败',
        `${error instanceof Error ? error.message : String(error)}\n\n日志：${logFile()}`,
      )
      app.quit()
    }
  })

  // Explicit quit paths (tray "Quit", Cmd+Q, boot-failure quit) flip this so
  // the window's close handler lets the window actually close.
  app.on('before-quit', () => {
    quitting = true
    // Flush any debounced geometry save: quitting from a visible window never
    // passes through the close handler that normally persists it.
    if (mainWindow && !mainWindow.isDestroyed()) saveWindowState(mainWindow)
  })
  // The app lives in the tray once the window is closed; never quit just
  // because no window is open (issue #3).
  app.on('window-all-closed', () => {})
  // macOS dock click while running in the tray reopens the window. Guarded
  // by `booted`: macOS can fire activate during launch, and creating the
  // window then would point it at a port the server hasn't bound yet.
  app.on('activate', () => {
    if (booted && serverPort && !mainWindow?.isVisible()) showWindow(serverPort, 'automatic')
  })
  app.on('will-quit', () => {
    tray?.destroy()
    stopShellControl()
    if (dshChild && dshChild.exitCode === null) dshChild.kill()
  })
}
