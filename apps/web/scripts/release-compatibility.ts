/** Published execution contracts understood by the site readers.
 * Kept with the consumer; no producer workspace is needed for compatibility checks. */
export const RELEASE_COMPATIBILITY: { readonly execution: readonly string[] } = Object.freeze({
  execution: Object.freeze(['execution/1', 'execution/2']),
});
