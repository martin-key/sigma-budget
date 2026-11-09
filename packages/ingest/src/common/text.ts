/** Python str.split()/str.strip() whitespace; intentionally distinct from numeric parsing. */
export function pythonTextSpace(value: string): string {
  return value
    .replace(
      /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu,
      ' ',
    )
    .replace(/^ | $/g, '');
}
