import { TextDecoder, TextEncoder } from 'node:util';
import { SaxesParser } from 'saxes';
import { Check, pyRepr as repr } from './checks.js';
import { cleanText, pythonDigitPattern } from './feed-text.js';
import { decodeUtf8, listLike, pyError, required, typeName } from './feed-python.js';
import { pythonNumericText } from '../common/numbers.js';
import type { Context } from './context.js';

interface Element {
  name: string;
  attrs: Record<string, string>;
  text: string | null;
  children: Element[];
}
const atom = 'http://www.w3.org/2005/Atom';
const baseDefault = 'https://budget-na-svetlo.example/';
function parseXml(text: string): Element {
  const stack: Element[] = [];
  let root: Element | undefined;
  const p = new SaxesParser({ xmlns: true });
  p.on('doctype', () => {
    throw new Error('DTD and external entities are forbidden');
  });
  p.on('opentag', (node) => {
    const attrs: Record<string, string> = {};
    for (const a of Object.values(node.attributes))
      if (!a.uri || a.uri !== 'http://www.w3.org/2000/xmlns/')
        attrs[a.uri ? `{${a.uri}}${a.local}` : a.local] = a.value;
    const item: Element = {
      name: node.uri ? `{${node.uri}}${node.local}` : node.local,
      attrs,
      text: null,
      children: [],
    };
    const parent = stack.at(-1);
    if (parent) parent.children.push(item);
    else root = item;
    stack.push(item);
  });
  const onText = (value: string) => {
    const parent = stack.at(-1);
    if (parent && !parent.children.length) parent.text = (parent.text ?? '') + value;
  };
  p.on('text', onText);
  p.on('cdata', onText);
  p.on('closetag', () => {
    stack.pop();
  });
  p.write(text).close();
  if (!root) throw new Error('empty document');
  return root;
}
const find = (e: Element, name: string) => e.children.find((x) => x.name === name);
const txt = (e: Element, name: string) => find(e, name)?.text ?? null;
function rfcDate(s: string): string {
  if (typeof s !== 'string')
    pyError('AttributeError', `'${typeName(s)}' object has no attribute 'split'`);
  const parts = s.split('-');
  if (parts.length !== 3)
    pyError(
      'ValueError',
      parts.length < 3
        ? `not enough values to unpack (expected 3, got ${parts.length})`
        : 'too many values to unpack (expected 3)',
    );
  const space =
    '[\\u0009-\\u000d\\u001c-\\u0020\\u0085\\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';
  const digit = new RegExp(`^${space}*[+]?${pythonDigitPattern}+${space}*$`, 'u');
  const values = parts.map((part) => {
    if (!digit.test(part))
      pyError('ValueError', `invalid literal for int() with base 10: ${repr(part)}`);
    return Number(pythonNumericText(part));
  });
  const [year, month, day] = values as [number, number, number];
  if (year < 1 || year > 9999) pyError('ValueError', `year ${year} is out of range`);
  if (month < 1 || month > 12) pyError('ValueError', 'month must be in 1..12');
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (day < 1 || day > days[month - 1]!) pyError('ValueError', 'day is out of range for month');
  const d = new Date(0);
  d.setUTCFullYear(year, month - 1, day);
  d.setUTCHours(12, 0, 0, 0);
  return d.toUTCString().replace('GMT', '+0000');
}

export function feedXml(
  c: Check,
  f: any,
  ctx: Context,
  siteUrl = process.env.BNS_SITE_URL ?? baseDefault,
): void {
  let root: Element;
  let raw: string;
  try {
    raw = ctx.text('feed.xml');
  } catch (error) {
    decodeUtf8(ctx.bytes('feed.xml'));
    throw error;
  }
  const declaration = /^<\?xml\s+[^?]*encoding\s*=\s*['"]([^'"]+)['"]/i.exec(raw);
  let decoded = raw;
  if (declaration && !/^utf-?8$/i.test(declaration[1]!)) {
    const encoding = declaration[1]!;
    if (/^utf-?16(?:le|be)?$/i.test(encoding)) {
      c.fail(
        `feed.xml is not well-formed XML: encoding specified in XML declaration is incorrect: line 1, column ${raw.indexOf(encoding)}`,
      );
      return;
    }
    if (/^(?:us-)?ascii$/i.test(encoding)) {
      const offset = raw.search(/[^\x00-\x7f]/u);
      if (offset >= 0) {
        const before = raw.slice(0, offset).split('\n');
        c.fail(
          `feed.xml is not well-formed XML: not well-formed (invalid token): line ${before.length}, column ${before.at(-1)!.length}`,
        );
        return;
      }
    } else if (/^iso-?8859-?1$/i.test(encoding))
      decoded = Buffer.from(raw, 'utf8').toString('latin1');
    else {
      let decoder: TextDecoder;
      try {
        decoder = new TextDecoder(encoding, { fatal: true });
      } catch {
        pyError('LookupError', `unknown encoding: ${encoding}`);
      }
      decoded = decoder!.decode(new TextEncoder().encode(raw));
    }
  }
  try {
    root = parseXml(decoded);
  } catch (e) {
    let msg = e instanceof Error ? e.message : String(e);
    if (decoded.lastIndexOf('<![CDATA[') > decoded.lastIndexOf(']]>')) {
      const lines = decoded.split('\n');
      msg = `unclosed CDATA section: line ${lines.length}, column ${Array.from(lines.at(-1)!).length}`;
    }
    const match = /^(\d+):(\d+): (unexpected close tag|undefined entity)\./.exec(msg);
    if (match) {
      const line = Number(match[1]),
        col = Number(match[2]),
        part = decoded.split('\n')[line - 1]!.slice(0, col);
      const pos =
        match[3] === 'undefined entity' ? part.lastIndexOf('&') : part.lastIndexOf('</') + 2;
      msg = `${match[3] === 'undefined entity' ? 'undefined entity' : 'mismatched tag'}: line ${line}, column ${pos}`;
    }
    c.fail(`feed.xml is not well-formed XML: ${msg}`);
    return;
  }
  const ch = find(root, 'channel');
  c.ok(
    root.name === 'rss' && root.attrs.version === '2.0' && !!ch,
    'feed.xml must be an RSS 2.0 document',
  );
  if (!ch) return;
  const base = siteUrl.endsWith('/') ? siteUrl : siteUrl + '/';
  if (base === baseDefault) c.fact(`feed.xml uses the placeholder address ${base}`);
  else c.warn(`feed.xml uses the address from BNS_SITE_URL: ${base}`);
  const link = txt(ch, 'link') || '',
    language = txt(ch, 'language') || '';
  c.ok(
    link === base && language === 'bg',
    `feed.xml channel link / language: ${repr(link)} ${repr(language)}`,
  );
  for (const tag of ['title', 'description'])
    cleanText(c, `feed.xml channel ${tag}`, txt(ch, tag) || '');
  const lb = txt(ch, 'lastBuildDate') || '';
  c.ok(lb === rfcDate(ctx.buildDate), `feed.xml lastBuildDate ${repr(lb)} vs the build day`);
  const a = find(ch, `{${atom}}link`);
  c.ok(
    !!a && a.attrs.href === base + 'data/feed.xml' && a.attrs.rel === 'self',
    'feed.xml atom:link rel=self',
  );
  const items = ch.children.filter((x) => x.name === 'item'),
    events = f.events.slice(0, 30);
  c.ok(
    items.length === events.length,
    `feed.xml has ${items.length} items, feed.json ${events.length} events`,
  );
  const labels = new Map<string, string>(
    listLike(f.kinds).map((k: any) => [required(k, 'id'), required(k, 'label')]),
  );
  for (let i = 0; i < Math.min(items.length, events.length); i++) {
    const it = items[i]!,
      e = events[i],
      eid = e.id,
      g = find(it, 'guid');
    c.ok(!!g && g.text === eid && g.attrs.isPermaLink === 'false', `feed.xml item ${eid}: guid`);
    c.ok(
      txt(it, 'title') === required(e, 'title'),
      `feed.xml item ${eid}: title differs from feed.json`,
    );
    const href = required(e, 'href');
    if (typeof href !== 'string')
      pyError('TypeError', `can only concatenate str (not "${typeName(href)}") to str`);
    c.ok(txt(it, 'link') === base + href, `feed.xml item ${eid}: link ${repr(txt(it, 'link'))}`);
    c.ok(
      txt(it, 'pubDate') === rfcDate(required(e, 'date')),
      `feed.xml item ${eid}: pubDate ${repr(txt(it, 'pubDate'))} vs ${e.date}`,
    );
    c.ok(txt(it, 'category') === (labels.get(e.kind) ?? null), `feed.xml item ${eid}: category`);
    c.ok(
      (txt(it, 'description') || '') === (e.text === undefined ? '' : e.text),
      `feed.xml item ${eid}: description differs from the text`,
    );
  }
  c.ok(!raw.toLowerCase().includes('private channel'), 'feed.xml mentions a private channel');
}
