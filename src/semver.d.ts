/**
 * Local type shim for the `semver` runtime package.
 *
 * `semver` (v7) ships no bundled `.d.ts`, and `@types/semver` is not yet
 * installed in this sandbox (pnpm is blocked here; install is deferred to a
 * later environment). This ambient declaration lets `tsc --noEmit` pass now.
 *
 * TODO(phase3): once `pnpm add -D @types/semver` has run, DELETE this file —
 * keeping both the real `@types/semver` and this shim causes
 * duplicate-declaration errors.
 */
declare module 'semver' {
  /** True when `range` is a parseable semver range. */
  export function validRange(range: string): string | null
  /** True when `version` satisfies `range`. */
  export function satisfies(version: string, range: string): boolean
  /** Lowest version covered by `range`, or null when unparseable. */
  export function minVersion(range: string): { version: string } | null
  const _default: {
    validRange: typeof validRange
    satisfies: typeof satisfies
    minVersion: typeof minVersion
  }
  export default _default
}
