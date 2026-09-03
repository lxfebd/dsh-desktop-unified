# Installation

DSH Desktop is packaged as a ready-to-run desktop app. **This repository is not yet published** (no Releases, no Homebrew tap), so for now the only way to run it is from source. If you have the source (e.g. shared directly by the maintainer), the steps below are all you need.

## Prereqs

Node.js `^22.19 || >=24`, [pnpm](https://pnpm.io) (11.22.0), and [just](https://just.systems).

## From source

```sh
just install    # install dependencies (pnpm install)
just dev        # compile with tsc, then launch the Electron app from source
```

### macOS (Apple Silicon / M-series)

The same `just install` / `just dev` steps apply. To build a distributable:

```sh
just dist-mac   # produce dmg + zip into dist-installer/
```

The produced `.app` is **unsigned**, so on first launch:

- If macOS says it "cannot verify the developer": **right-click the app → Open**.
- If it says **"DSH Desktop is damaged and can't be opened"**: run `xattr -cr "/Applications/DSH Desktop.app"` once in **Terminal**.

### Windows (64-bit)

Run `just dev` from source for local development, or build a distributable:

```sh
just dist-win   # produce an nsis installer into dist-installer/
```

SmartScreen will warn about risk on an unsigned build — click **More info → Run anyway**.

## When the project is published

Once Releases exist, installers will be attached there and (on macOS) may be offered via a Homebrew tap. Downloads come with a `SHA256SUMS` manifest for verifying installer integrity. Until then, everything above is local.

## Updates

The app checks for new releases automatically every 4 hours after launch:

- **Windows**: the update downloads in the background; click "Restart and update" in the dialog to apply it, or it is installed automatically the next time the app quits.
- **macOS** (unsigned, so it cannot update itself): a dialog announces the new version. If the app was installed via Homebrew, "Update via Homebrew" runs `brew upgrade --cask dsh-desktop` + `xattr -cr` for you and restarts the app; otherwise a button opens the Releases page for a manual download.

::: tip
New desktop builds track the upstream `@deepseek-ai/dsh` npm package. A version like `0.1.0-rc.6.8` means "the 8th desktop build based on upstream `0.1.0-rc.6`".
:::