# DeepSeek Harness Desktop

English | [中文](README.md)

> **This is a community (unofficial) build.** The upstream [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) is open-sourced under the MIT license. This repository is an Electron desktop shell + automated packaging scripts + a set of self-developed preset plugins. The DeepSeek name and whale logo are trademarks of DeepSeek, used here only to identify the packaged upstream software.

---

## 🎯 What is DeepSeek Harness Desktop?

It wraps the official DeepSeek Harness (`@deepseek-ai/dsh`) into a desktop app you can download and run directly — **no system Node.js, npm, or terminal required**. Open the app, paste in your DeepSeek API key, and let the AI run tasks on your machine (read/write files, run commands, write code, automate operations, etc.).

## ✨ What makes this version different

- **Pull updates straight from GitHub**: new "Pull updates from GitHub…" tray/menu entry — queries the actual publishing repo's latest release (no reliance on electron-updater's signature or latest.yml), lists the changelog when a newer version exists, downloads the platform installer (Windows `setup.exe` / macOS `.dmg`), and opens it; `electron-builder.yml`'s `publish.owner` was corrected to the real repo `lxfebd/dsh-desktop-unified`, fixing the 4-hourly auto-update 404 against a stale repo.
- **6 built-in preset plugins** (ready to use out of the box):
  - `dshmarket` — the official plugin marketplace
  - `dsh-plugin-version-manager` — plugin version management
  - `dsh-shell-control` — terminal & command palette
  - `dsh-desktop-preset-transfer` — preset plugin transfer (consistent presets across machines)
  - `dsh-terminal` — system terminal (Shell)
  - `dsh-market-tools` — **self-developed AI tool plugin** (market list/install/uninstall/update via 4 `market_*` tools, all forwarding to the official `/dsh-market/*` routes)
- **AI can install/update/uninstall plugins itself**: fixed dshmarket's running-agent guard that blocked the originating agent (the caller is necessarily `running` mid-turn) — agent-initiated plugin mutations no longer 409 self-block, while other running agents are still blocked.
- **Preset protection**: built-in plugins (`link:`/`file:` specs) are hard-blocked from uninstall/update to keep the preset chain intact.
- **Multi-profile support**: manage multiple independent configurations (e.g. `web`, `web-desktop`) within one instance.
- **Safe mode with self-healing**: when a plugin crashes, the app enters safe mode and removes the culprit; on restart it automatically tries to re-attach dropped preset plugins (when their deps are still present), logging `preset bundle re-attached after safe-mode drop`.
- **Single-instance tray residency**: closing the window only minimizes to the system tray while background tasks keep running; the tray icon offers Show, Quit, Open log / Open data directory.
- **Full local development pipeline**: TypeScript ESM + pnpm 11.22 + Vitest, with `just` commands for install / dev / package.

## 🗒️ This release (v0.1.2-rc.1.202609041312)

- **New "Pull updates from GitHub…"** (tray + app menu): GitHub API latest-release lookup → semver compare (handles `-rc.x` prereleases) → platform installer pick → streaming download (progress notification) → open/reveal installer; network failures offer the releases page.
- **Fixes**: dshmarket's running-agent guard self-blocking AI-driven plugin installs; session-completion notifications firing for stale pre-start sessions; boot preheat deleting real package dirs under the profile; the shortcut-icon updater being rewritten from an invalid PowerShell script (parse error) to a correct target-filtered implementation; `preset-deps` misclassifying `~0.1.2` tilde semver ranges as local paths (breaking every market install); the shell-control restart timer not being cleared (possible second relaunch after quit) — 8 defects in total.
- **Auto-update 404 fixed**: `publish.owner` mismatched the actual publishing repo, so electron-updater polled a nonexistent repo every 4 hours; corrected (takes effect with the next packaged release).
- **Quality gates**: Vitest 9 files 62 cases + plugin node:test 5 cases all green; `tsc --noEmit` 0 errors.

## 📦 Installation

Latest installers from **GitHub Releases**: <https://github.com/lxfebd/dsh-desktop-unified/releases> (Windows `*-setup.exe` / macOS `*.dmg`).  
In-app auto-update: Windows checks in the background every 4 hours + manual tray "Check for Updates…"; macOS unsigned builds use the tray "Pull updates from GitHub…" or the Releases page directly.  
If you have the source (e.g. shared directly by the maintainer), the local development steps below are all you need.

## 🖥️ Usage

1. Unpack / clone the source locally
2. Follow the "Local development" steps to install dependencies and start
3. After launch, paste your [DeepSeek API Key](https://platform.deepseek.com/) in the tray icon or the settings page
4. Start a conversation: let the AI read/write files, run commands, write code, and more

### Where data and logs live

- **App data directory** (conversations, config, sessions, plugin state, etc.): the system-standard location; it does not pollute your user home directory
  - Windows: `%APPDATA%\DeepSeek Harness`
  - macOS: `~/Library/Application Support/DeepSeek Harness`
- **Diagnostic logs**: `logs/dsh.log` under the app data directory (first stop when troubleshooting)
- **Tray menu**: open "Open log" and "Open data directory" directly

## ⚙️ How it works

1. **Embedded Node runtime**: uses the Node.js bundled with Electron plus the officially published [`@deepseek-ai/dsh`](https://www.npmjs.com/package/@deepseek-ai/dsh) package — **it installs nothing on your system**; online marketplace installs are handled by a bundled standalone pnpm, so no system Node / npm is needed either.
2. **Local `dsh web` service**: on startup it launches `dsh web` on `127.0.0.1` (port 3080 by default; if occupied, it tries 3081, 3082...), listening only on the loopback address and never exposed externally.
3. **Native window**: an Electron `BrowserWindow` renders the local UI for a desktop-app feel, with a single-instance lock so only one window exists (a second launch focuses the existing one).
4. **System tray**: when the window is minimized to the tray, the background `dsh web` process and all tasks keep running; click the tray icon → "Show" to restore, "Quit" to truly exit (which also shuts down the child process).

## 🧱 Tech stack & toolchain

| Aspect | Choice | Notes |
|--------|--------|-------|
| Runtime | Electron 43 (embedded Node 22/24) | No system Node required |
| Language | TypeScript, ESM (`"type": "module"`) | `target: ES2022`, `moduleResolution: NodeNext`, `strict` |
| Package manager | **pnpm 11.22.0** (hoisted mode) | See key constraints; **never use npm**; version must align with `@pnpm/exe` |
| Task runner | **just** (`justfile`) | Prefer just for all commands |
| Packaging | electron-builder 26 | macOS (dmg+zip) and Windows (nsis) installers |
| Auto-update | electron-updater + GitHub Releases pull | When packaged: background check every 4h + manual menu/tray "Check for Updates…"; Windows downloads in background then prompts "Restart and update", macOS (unsigned) uses Homebrew (if brew-installed) or the tray "Pull updates from GitHub…" |
| Upstream sync | `scripts/sync-upstream.mjs` + GitHub Actions | Polls npm at 09/13/17 Beijing time daily (reads all dist-tags for the max semver; upstream rc publishes `next` first, then moves `latest`); a build ships when either upstream or this repo moves |

### Common just commands

```bash
just install    # install dependencies (pnpm install)
just dev        # compile and run the app from source
just build      # type-check and compile the main process into dist/
just sync       # check for a new @deepseek-ai/dsh version and bump it (no commit)
just dist-mac   # build the macOS installer into dist-installer/ (dmg + zip)
just dist-win   # build the Windows installer (nsis; run on Windows / CI)
```

The underlying equivalent commands live in `package.json` `scripts`: `build` / `dev` / `pack` / `dist:mac` / `dist:win`.

## 🔐 Key constraints (read before changing)

1. **Use pnpm, not npm.** The repo pins **pnpm 11.22.0**; do not switch to npm.
2. **`node_modules` must stay hoisted.** `pnpm-workspace.yaml` sets `nodeLinker: hoisted` so electron-builder can walk a flat dependency tree. **Do not change to pnpm's default virtual-store symlink layout**, or packaging will drop files.
3. **Peer-only runtime deps are maintained by script; don't delete them manually.** Some `@deepseek-ai/*` packages appear only in `peerDependencies`, and electron-builder's production collector **only reads `dependencies`/`optionalDependencies`**, missing pure-peer packages. `sync-upstream.mjs`'s `detectPeerOnlyRuntimeDeps()` pins them into `dependencies` on bump. By design it's **add-only** — keeping a package that later becomes a real dep is harmless, but deleting one may leave dangling references after a rename.
4. **Keep `minimumReleaseAgeExclude` as the `'@deepseek-ai/*'` wildcard**, don't pin per-package versions. pnpm's default 24h minimum-release-age check would conflict with this repo's hours-close upstream tracking, so the whole first-party scope is exempt. In the rc.6 era this was a ~190-line `name@version` list; after sync bumped to rc.7 the list went stale and every CI `pnpm install --frozen-lockfile` failed (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). A sync that pushed a tag but whose build failed leaves an orphaned tag with no release — CI now detects "latest tag has no release" and auto-forces a rebuild, so no manual `gh run rerun --failed` is needed, though the orphaned tag itself stays in the list.
5. **The entire `node_modules` must be `asarUnpack`'d.** `dsh web` is executed as a subprocess entry path, and paths inside the asar archive cannot be spawned. Hence `electron-builder.yml` sets `asarUnpack: node_modules/**`, and `dshBin()` rewrites the `app.asar` path to `app.asar.unpacked`.
6. **Don't hand-edit the version number.** The desktop version is computed by `nextVersion()`:
   - Upstream prerelease (e.g. `0.1.0-rc.6`) → append a UTC build timestamp: `0.1.0-rc.6.202508151030`. Fixed-width `YYYYMMDDHHMM` (12 digits) keeps tag lexicographic order equal to time order — a plain incrementing counter would put `rc.6.9` lexicographically before `rc.6.11` at the 9→10 carry.
   - Upstream stable (e.g. `0.1.0`) → a separate patch line `X.Y.(Z+1)`.
   - Must be strictly increasing and valid semver (required by electron-updater).
7. **macOS builds are unsigned / unnotarized.** CI sets `CSC_IDENTITY_AUTO_DISCOVERY=false`. Users first-open via right-click → Open; if it says "damaged and can't be opened", run `xattr -cr "/Applications/DSH Desktop.app"`. The Homebrew channel is provided by a separate repository (cask `dsh-desktop`, arm64 only) whose sync-cask tracks this repo's latest release daily; **when the artifact filename (`DSH-Desktop-<version>-mac-arm64.dmg`) changes you must sync the cask's `url`**. Artifact filenames must contain no spaces: a space in `${productName}` makes electron-builder write a hyphenated safeArtifactName into latest.yml while `gh release` uploads convert spaces to dots — the mismatch breaks update downloads (404).
8. **This is an ESM project; use NodeNext-style imports.** E.g. in `.mjs` scripts use `import.meta.url` + `createRequire`. `@deepseek-ai/dsh` has no `exports` map, so `dshBin()` does `require.resolve('@deepseek-ai/dsh/lib/bin.js')` directly.
9. **`@pnpm/exe` (the marketplace's embedded pnpm) has three pitfalls, read before changing.** ① Its npm tarball's SEA binary **carries no exec bit**, and setup.js's hardlink doesn't add one — the runtime `chmodSync` in `toolingPathPrefix()` is required; don't delete it. ② The SEA binary requires a `dist/pnpm.mjs` in the same directory, so PATH must point at the `@pnpm/exe` package directory, not the platform packages such as `@pnpm/macos-arm64`. ③ Its `bin` shadows corepack at `node_modules/.bin/pnpm`, and when electron-builder's dependency collector spawns pnpm it hits this — **the `packageManager` field must match the `@pnpm/exe` version** (currently 11.22.0) or the collector fails on a version mismatch. It also grows the dmg from ~153MB to ~237MB; watch the size on bumps.

## 📂 Repository structure

```
src/main.ts                 # Electron main process (the only runtime source, ~230 lines)
src/profiles.js             # Profile management (activeProfile, ensureProfileSeed, PROFILES, etc.)
src/safe-mode.ts            # Safe mode (plugin-crash removal & self-healing)
src/preset-deps.ts          # Preset plugin dep handling (presetDepSpec / migratePresetDepSpecs / repairPresetDepSpecs / adoptNewPresets / healDroppedPresetBundles)
src/github-releases.ts      # GitHub Releases update pull (latest lookup / semver compare / pick / download)
vendor/dshmarket/           # vendored dshmarket (running-agent guard self-exclusion patch, file: dep)
scripts/sync-upstream.mjs   # Upstream version detection + desktop version calc + peer-only dep pin
build/icon.{icns,ico,png}   # App icon
electron-builder.yml        # Packaging config (appId, target, asarUnpack, publish)
pnpm-workspace.yaml         # pnpm config (hoisted + allowBuilds whitelist)
.github/workflows/sync-and-release.yml  # 3-stage CI: sync → build(mac/win) → release
dist/                       # tsc output (gitignored)
dist-installer/             # electron-builder output (gitignored)
plugins/                    # Self-developed / built-in plugin source (e.g. dsh-market-tools, dsh-desktop-preset-transfer; dsh-plugin-market is a retired old self-made market fork, archived for reference only, not in the preset chain)
tests/                      # Vitest unit tests (dependency-safety, market-tools, preset-deps, github-releases, etc.)
```

## 🛡️ Plugin marketplace & preset protection

- The marketplace is provided by the built-in `@deepseek-ai/dshmarket`, reachable via the in-app marketplace panel or `http://127.0.0.1:<PORT>/dsh-market/*` (cookie + Origin auth required).
- **Preset plugins are injected into the profile via `link:`/`file:` specs** (e.g. `link:J:/.../node_modules/dsh-market-tools`); this is the official mechanism: **uninstalling or updating them breaks the preset chain** (uninstall re-triggers the self-heal on every launch; update has an unclear origin). So the `market_uninstall` / `market_update` tools hard-block locally:
  - When the target plugin's `spec` starts with `link:` or `file:` → immediately return `{ok:false, blocked:true}`, **no uninstall/update request is sent**
  - The tool descriptions also state explicitly: "preset plugins (spec starting with link:/file:) are rejected — do not try to uninstall or update them"
- This ensures the 6 built-in preset plugins (market, version manager, terminal control, preset transfer, terminal, market tools) can never be uninstalled or updated unless the user explicitly edits the profile and accepts the consequences.

## 🧪 Quality gates

- **Unit tests**: Vitest 9 files 62 cases (incl. `market-tools.*`, `github-releases`, `session-notifier`), all passing
- **Plugin self-tests**: node:test 5/5
- **Type check**: `tsc --noEmit` 0 errors
- **Architecture check**: deps=40 probed=38 failed=0
- **Build**: `pnpm build` succeeds
- **Smoke test**: ci-smoke authenticated ready

## 📄 License

- Desktop shell code: MIT
- Upstream DeepSeek Harness: MIT © DeepSeek
- Packaged third-party deps: see upstream `THIRD_PARTY_NOTICES.md`

## 🙋‍♂️ Local development

> Prereqs: Node.js `^22.19 || >=24`, [pnpm](https://pnpm.io) (11.22.0), [just](https://just.systems)

```bash
# 1. Install dependencies (first time or after a lockfile change)
just install          # equivalent to pnpm install

# 2. Run from source (recommended for debugging)
just dev              # compile with tsc, then launch the Electron app from source

# 3. Type-check only (fast feedback)
just build            # tsc compile, no launch

# 4. Check for a new upstream version (no commit)
just sync             # bumps the "@deepseek-ai/dsh" version in package.json if a new one exists

# 5. Build distributables (run on the matching platform)
just dist-mac         # on macOS: produce dmg + zip into dist-installer/
just dist-win         # on Windows or CI: produce an nsis installer into dist-installer/
```

### Common debugging tips

- App logs default to `logs/dsh.log` under the system app-data directory (**first stop when troubleshooting**)
- Stuck on a white screen → check the log tail for `dsh web started on port ...` or a child-process abnormal exit
- Marketplace install hangs → check the log the same way, or confirm the network can reach `https://awesome-dsh-plugin.com` (the marketplace catalog source)
- Single-instance behavior: a second launch focuses the existing window (even when minimized to the tray); the only true exit is the tray → "Quit"

---

> This README is the authoritative description of the current repository (`dsh-desktop-unified`). For the upstream DeepSeek Harness itself, see [https://github.com/deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness).