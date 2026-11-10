/** Scoped Python JSON diagnostics, while retaining number token kinds for SEARCH. */
import { parsePythonJson } from '../common/numbers.js';
export function parseSearchJson(text: string): any {
  try {
    return parsePythonJson(text);
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
  }
  const chars = Array.from(text);
  let i = 0;
  const error = (message: string, at = i): never => {
    const before = chars.slice(0, at),
      line = before.filter((c) => c === '\n').length + 1,
      last = before.lastIndexOf('\n'),
      column = at - last;
    const e = new Error(`${message}: line ${line} column ${column} (char ${at})`);
    e.name = 'JSONDecodeError';
    throw e;
  };
  const ws = () => {
    while (i < chars.length && ' \t\r\n'.includes(chars[i]!)) i++;
  };
  const str = () => {
    const start = i++;
    while (i < chars.length) {
      const ch = chars[i++]!;
      if (ch === '"') return;
      if (ch === '\\') {
        const escaped = chars[i++];
        if (escaped === undefined) error('Unterminated string starting at', start);
        if (escaped === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(chars.slice(i, i + 4).join('')))
            error('Invalid \\uXXXX escape', i - 1);
          i += 4;
        } else if (!'"\\/bfnrt'.includes(escaped!)) error('Invalid \\escape', i - 2);
      } else if (ch.codePointAt(0)! < 32) error('Invalid control character at', i - 1);
    }
    error('Unterminated string starting at', start);
  };
  const value = (): void => {
    ws();
    const ch = chars[i];
    if (ch === '"') {
      str();
      return;
    }
    if (ch === '{') {
      i++;
      ws();
      if (chars[i] === '}') {
        i++;
        return;
      }
      while (true) {
        if (chars[i] !== '"') error('Expecting property name enclosed in double quotes');
        str();
        ws();
        if (chars[i] !== ':') error("Expecting ':' delimiter");
        i++;
        value();
        ws();
        if (chars[i] === '}') {
          i++;
          return;
        }
        if (chars[i] !== ',') error("Expecting ',' delimiter");
        i++;
        ws();
      }
    }
    if (ch === '[') {
      i++;
      ws();
      if (chars[i] === ']') {
        i++;
        return;
      }
      while (true) {
        value();
        ws();
        if (chars[i] === ']') {
          i++;
          return;
        }
        if (chars[i] !== ',') error("Expecting ',' delimiter");
        i++;
      }
    }
    const remaining = chars.slice(i, i + 9).join('');
    for (const token of ['NaN', 'Infinity', '-Infinity'])
      if (remaining.startsWith(token)) {
        const e = new Error(`non-finite number ${token} in JSON`);
        e.name = 'ValueError';
        throw e;
      }
    for (const token of ['true', 'false', 'null'])
      if (remaining.startsWith(token)) {
        i += token.length;
        return;
      }
    let end = i;
    while (end < chars.length && /[0-9eE.+-]/.test(chars[end]!)) end++;
    const number = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(
      chars.slice(i, end).join(''),
    );
    if (number) {
      i += number[0].length;
      return;
    }
    error('Expecting value');
  };
  value();
  ws();
  if (i !== chars.length) error('Extra data');
  return parsePythonJson(text);
}
