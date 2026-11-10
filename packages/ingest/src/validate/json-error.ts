/** Read JSON grammar to locate Python 3.12 decoder errors independently of V8 wording.
 * Positions count Unicode code points, while the scanner indexes JavaScript UTF-16.
 */
export function throwPythonJsonError(text: string): never {
  let at = 0;
  function fail(message: string, offset = at): never {
    const before = Array.from(text.slice(0, offset)),
      line = before.filter((ch) => ch === '\n').length + 1,
      column = before.length - before.lastIndexOf('\n');
    const error = new Error(
      message + ': line ' + line + ' column ' + column + ' (char ' + before.length + ')',
    );
    error.name = 'JSONDecodeError';
    throw error;
  }
  const space = () => {
    while (at < text.length && /[ \t\r\n]/.test(text[at]!)) at++;
  };
  function string(): void {
    const opening = at++;
    while (at < text.length) {
      const ch = text[at]!;
      if (ch === '"') {
        at++;
        return;
      }
      if (ch.charCodeAt(0) < 32) fail('Invalid control character at');
      if (ch === '\\') {
        const slash = at++;
        if (at === text.length) fail('Unterminated string starting at', opening);
        if (text[at] === 'u') {
          if (at + 5 >= text.length || !/^[0-9a-fA-F]{4}/.test(text.slice(at + 1)))
            fail('Invalid \\uXXXX escape');
          at += 5;
          continue;
        }
        if (!'"\\/bfnrt'.includes(text[at]!)) fail('Invalid \\escape', slash);
      }
      at++;
    }
    fail('Unterminated string starting at', opening);
  }
  function value(): void {
    space();
    const ch = text[at];
    if (ch === '"') return string();
    if (ch === '{') {
      at++;
      space();
      if (text[at] === '}') {
        at++;
        return;
      }
      while (true) {
        if (text[at] !== '"') fail('Expecting property name enclosed in double quotes');
        string();
        space();
        if (text[at] !== ':') fail("Expecting ':' delimiter");
        at++;
        value();
        space();
        if (text[at] === '}') {
          at++;
          return;
        }
        if (text[at] !== ',') fail("Expecting ',' delimiter");
        at++;
        space();
      }
    }
    if (ch === '[') {
      at++;
      space();
      if (text[at] === ']') {
        at++;
        return;
      }
      while (true) {
        value();
        space();
        if (text[at] === ']') {
          at++;
          return;
        }
        if (text[at] !== ',') fail("Expecting ',' delimiter");
        at++;
      }
    }
    const constant = /^(?:NaN|Infinity|-Infinity)/.exec(text.slice(at));
    if (constant) {
      const error = new Error('non-finite number ' + constant[0] + ' in JSON');
      error.name = 'ValueError';
      throw error;
    }
    const token = /^(?:null|true|false|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(
      text.slice(at),
    );
    if (!token) fail('Expecting value');
    at += token[0].length;
  }
  if (text[0] === '\uFEFF') fail('Unexpected UTF-8 BOM (decode using utf-8-sig)', 0);
  value();
  space();
  if (at !== text.length) fail('Extra data');
  throw new Error('JSON decoder rejected a grammatically valid document');
}
