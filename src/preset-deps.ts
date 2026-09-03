/**
 * Local-link dependency specs for the preset bundled plugins.
 *
 * Preset plugins ship inside the app bundle and mostly do NOT exist on the
 * npm registry (as of 2026-09: `dsh-plugin-version-manager`,
 * `dsh-shell-control` and `dsh-desktop-preset-transfer` 404 outright, while
 * `dsh-terminal` resolves to an unrelated third-party package). A registry
 * semver range for them in the profile manifest breaks EVERY market install:
 * `dsh plugin add <target>` runs `pnpm add <target>` in the profile
 * directory, and pnpm re-resolves the whole dependency graph — one
 * unresolvable preset name aborts the entire command (ERR_PNPM_FETCH_404),
 * so no plugin can be installed at all. `link:<bundled dir>` keeps
 * resolution local, mirroring the app's own `file:` preset dependencies.
 * @module dsh-desktop/preset-deps
 */

/** One preset plugin: name, the directory it ships in, and its version there. */
export interface PresetPlugin {
  name: string
  dir: string
  version: string
}

/**
 * Specs that resolve WITHOUT the npm registry: local links/paths, workspace
 * and npm-protocol aliases, and git/https sources. Anything else is treated
 * as a registry range (`^1.2.3`, `~0.1`, `1.0.0`, `latest`, …).
 */
const NON_REGISTRY_SPEC = /^(?:link:|file:|workspace:|npm:|catalog:|git|https?:|github:|\.{1,2}[/\\]|~|[A-Za-z]:[/\\])/

/**
 * The dependency spec the shell writes for a preset plugin: a local link to
 * the bundled directory. pnpm accepts `link:` with forward slashes on every
 * platform, which keeps the manifest portable across path styles.
 * @param plugin - the preset plugin to reference
 * @returns a `link:` spec pointing at the plugin's bundled directory
 */
export function presetDepSpec(plugin: PresetPlugin): string {
  return `link:${plugin.dir.replaceAll('\\', '/')}`
}

/**
 * Migrate a profile manifest's preset dependency entries to local links, in
 * place. Returns the plugin names it rewrote (empty when nothing changed).
 *
 * Rewrites exactly the cases that break installs:
 *  - registry ranges for a preset name — they 404 for unpublished plugins
 *    and can resolve a WRONG same-named package for published ones (the
 *    preset always tracks the version shipped with the app);
 *  - local `link:`/`file:` specs whose target no longer exists (the app
 *    moved — a new install directory after an update or a disk move).
 * Everything else (a git spec, a workspace alias) is the user's own entry
 * and is left untouched.
 *
 * @param dependencies - the manifest `dependencies` map to mutate
 * @param plugins - the preset plugins the shell bundles right now
 * @param dirHasManifest - whether a directory still holds a package.json
 *   (injected so this module stays free of `node:fs`)
 * @returns the names whose spec was rewritten
 */
export function migratePresetDepSpecs(
  dependencies: Record<string, string> | undefined,
  plugins: readonly PresetPlugin[],
  dirHasManifest: (dir: string) => boolean,
): string[] {
  if (dependencies === undefined) return []
  const changed: string[] = []
  for (const plugin of plugins) {
    const current = dependencies[plugin.name]
    if (typeof current !== 'string' || current === '') continue
    const isLocal = current.startsWith('link:') || current.startsWith('file:')
    if (isLocal) {
      // A local spec whose target is gone (app relocated) still poisons every
      // later pnpm resolution — re-point it at the current bundled directory.
      const target = current.slice(current.indexOf(':') + 1)
      if (!dirHasManifest(target.replace(/[\\/]+package\.json$/, ''))) {
        dependencies[plugin.name] = presetDepSpec(plugin)
        changed.push(plugin.name)
      }
      continue
    }
    if (!NON_REGISTRY_SPEC.test(current)) {
      dependencies[plugin.name] = presetDepSpec(plugin)
      changed.push(plugin.name)
    }
  }
  return changed
}
