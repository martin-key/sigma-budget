/**
 * The data contracts a release built by this code declares in `compatibility` and the operator reads
 * (docs/approach-specification.md, section 10.1). tests/release/compat_check.mjs checks them against
 * the local code/data compatibility check. No imports and only erasable syntax: Node reads this file directly.
 */
export const RELEASE_COMPATIBILITY: { readonly execution: readonly string[] } = Object.freeze({
  execution: Object.freeze(['execution/1', 'execution/2']),
});
