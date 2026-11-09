import { pythonFloat } from './context.js';

// Python 3.12 uses Unicode 15.0. Native Node character classes may add digits.
const digit =
  '[\\u{30}-\\u{39}\\u{660}-\\u{669}\\u{6F0}-\\u{6F9}\\u{7C0}-\\u{7C9}\\u{966}-\\u{96F}\\u{9E6}-\\u{9EF}\\u{A66}-\\u{A6F}\\u{AE6}-\\u{AEF}\\u{B66}-\\u{B6F}\\u{BE6}-\\u{BEF}\\u{C66}-\\u{C6F}\\u{CE6}-\\u{CEF}\\u{D66}-\\u{D6F}\\u{DE6}-\\u{DEF}\\u{E50}-\\u{E59}\\u{ED0}-\\u{ED9}\\u{F20}-\\u{F29}\\u{1040}-\\u{1049}\\u{1090}-\\u{1099}\\u{17E0}-\\u{17E9}\\u{1810}-\\u{1819}\\u{1946}-\\u{194F}\\u{19D0}-\\u{19D9}\\u{1A80}-\\u{1A89}\\u{1A90}-\\u{1A99}\\u{1B50}-\\u{1B59}\\u{1BB0}-\\u{1BB9}\\u{1C40}-\\u{1C49}\\u{1C50}-\\u{1C59}\\u{A620}-\\u{A629}\\u{A8D0}-\\u{A8D9}\\u{A900}-\\u{A909}\\u{A9D0}-\\u{A9D9}\\u{A9F0}-\\u{A9F9}\\u{AA50}-\\u{AA59}\\u{ABF0}-\\u{ABF9}\\u{FF10}-\\u{FF19}\\u{104A0}-\\u{104A9}\\u{10D30}-\\u{10D39}\\u{11066}-\\u{1106F}\\u{110F0}-\\u{110F9}\\u{11136}-\\u{1113F}\\u{111D0}-\\u{111D9}\\u{112F0}-\\u{112F9}\\u{11450}-\\u{11459}\\u{114D0}-\\u{114D9}\\u{11650}-\\u{11659}\\u{116C0}-\\u{116C9}\\u{11730}-\\u{11739}\\u{118E0}-\\u{118E9}\\u{11950}-\\u{11959}\\u{11C50}-\\u{11C59}\\u{11D50}-\\u{11D59}\\u{11DA0}-\\u{11DA9}\\u{11F50}-\\u{11F59}\\u{16A60}-\\u{16A69}\\u{16AC0}-\\u{16AC9}\\u{16B50}-\\u{16B59}\\u{1D7CE}-\\u{1D7FF}\\u{1E140}-\\u{1E149}\\u{1E2F0}-\\u{1E2F9}\\u{1E4F0}-\\u{1E4F9}\\u{1E950}-\\u{1E959}\\u{1FBF0}-\\u{1FBF9}]';
const number = '(' + digit + '+(?:,' + digit + '+)?)';
const amount = new RegExp(
  number +
    '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]+млрд\\. евро',
  'gu',
);
const prefix = new RegExp('^' + number, 'u');

export function debtProseMatches(text: string): RegExpMatchArray[] {
  return [...text.matchAll(amount)];
}
export function debtProseNumber(text: string): number | null {
  if (typeof text !== 'string') throw new Error('Invalid debt prose');
  const match = prefix.exec(text);
  return match ? pythonFloat(match[1]!.replace(',', '.')) : null;
}
