/** Frozen CPython 3.12 Unicode 15.0.0 predicates and case folding for SEARCH. */
import { unicodeData as data } from './search-unicode-data.js';
export function inRanges(ch: string, ranges: number[][]): boolean {
  const cp = ch.codePointAt(0)!;
  let lo = 0,
    hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1,
      r = ranges[mid]!;
    if (cp < r[0]!) hi = mid;
    else if (cp > r[1]!) lo = mid + 1;
    else return true;
  }
  return false;
}
export const isLetterNumber = (ch: string) => inRanges(ch, data.letterNumber);
export const isSpace = (ch: string) => inRanges(ch, data.space);
export const isPrintable = (ch: string) => inRanges(ch, data.printable);
export const trim = (s: string) => {
  const chars = Array.from(s);
  let a = 0,
    b = chars.length;
  while (a < b && isSpace(chars[a]!)) a++;
  while (b > a && isSpace(chars[b - 1]!)) b--;
  return chars.slice(a, b).join('');
};
export function codepointCompare(a: string, b: string): number {
  const x = Array.from(a),
    y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}
/** Python lower() includes contextual final sigma; NFD must also reorder adjacent marks. */
export function fold(value: string): string {
  const chars = Array.from(value),
    out: string[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!,
      cp = ch.codePointAt(0)!;
    let lowered = data.lower[String(cp)] ?? ch;
    if (cp === 0x3a3) {
      let before = false,
        after = false;
      for (let j = i - 1; j >= 0; j--) {
        if (inRanges(chars[j]!, data.caseIgnorable)) continue;
        before = inRanges(chars[j]!, data.cased);
        break;
      }
      for (let j = i + 1; j < chars.length; j++) {
        if (inRanges(chars[j]!, data.caseIgnorable)) continue;
        after = inRanges(chars[j]!, data.cased);
        break;
      }
      lowered = before && !after ? 'ς' : 'σ';
    }
    for (const part of lowered) {
      const cc = data.combining[String(part.codePointAt(0)!)] ?? 0;
      let at = out.length;
      if (cc)
        while (at > 0) {
          const prev = data.combining[String(out[at - 1]!.codePointAt(0)!)] ?? 0;
          if (!prev || prev <= cc) break;
          at--;
        }
      out.splice(at, 0, part);
    }
  }
  return out
    .filter((ch) => {
      const cp = ch.codePointAt(0)!;
      return cp < 0x300 || cp > 0x36f;
    })
    .join('');
}
export function unicodeClass(ranges: number[][]): string {
  return (
    '[' +
    ranges
      .map(([a, b]) => `\\u{${a!.toString(16)}}${a === b ? '' : '-\\u{' + b!.toString(16) + '}'}`)
      .join('') +
    ']'
  );
}
export const digitClass = unicodeClass(data.decimal);
export const spaceClass = unicodeClass(data.space);
export const wordClass = unicodeClass(data.letterNumber).replace(/\]$/, '_]');
export function asciiDigits(s: string): string {
  return Array.from(s, (ch) => {
    const cp = ch.codePointAt(0)!;
    const range = data.decimal.find(([a, b]) => cp >= a! && cp <= b!);
    return range ? String((cp - range[0]!) % 10) : ch;
  }).join('');
}
