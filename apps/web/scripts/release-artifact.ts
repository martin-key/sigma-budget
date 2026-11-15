// The parts of the release build (build-release.ts) that need no browser: the address rules of the crawl, the checks of one screen, the
// files written into build/client after the crawl (sitemap.xml, robots.txt, llms.txt, llms-full.txt, _headers), the stamping of the copied
// files and the final check of the deploy artifact. The text rules follow the former Python build byte for byte (code points, line breaks,
// whitespace), so the same crawl gives the same files.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzip } from 'pako';
import { staticResponseHeaders } from '../app/lib/security.ts';

export const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

/** as FILE_EXT in apps/web/client/loc.js: /vedomstvo/0200/0200.01.00 is a screen */
const FILE_EXT = /\.[A-Za-z][A-Za-z0-9]{0,4}$/;
const UI_NOISE = new Set([
  'Сподели',
  'PNG',
  'Копирай',
  'Таблица',
  'Графика',
  'Източник',
  'Източници',
  'Покажи още',
  'Скрий',
  'Следва',
  'Виж още',
  'CSV',
  'JSON',
]);

/** What the crawl keeps of one screen: the snapshot of the hydrated page, its errors and the document the server sent. */
export interface ServerDocument {
  status?: number;
  view?: string;
  h1?: string;
  desc?: string;
  canonical?: string;
  error?: string;
}
export interface PageInfo {
  route: string;
  view: string;
  title: string;
  h1: string;
  desc: string;
  robots: string;
  canonical: string;
  ld: string;
  hashLinks: string[];
  links: string[];
  answer: string;
  lede: string;
  text: string;
  routes?: RouteMeta[] | null;
  html?: string;
  errors: string[];
  ssr?: ServerDocument;
}
export interface RouteMeta {
  id: string;
  pattern?: string | null;
  nav?: boolean;
}
export type Finding = ['fail' | 'warn', string];

// --- text as Python treats it -------------------------------------------------------------------------------------------------------

/** str.isspace(): the characters str.strip() and str.split() remove */
const PY_SPACE =
  '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_STRIP = new RegExp(`^[${PY_SPACE}]+|[${PY_SPACE}]+$`, 'g');
/** str.splitlines() */
const PY_LINE_BREAK = /\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/;

export const pyStrip = (s: string): string => s.replace(PY_STRIP, '');
const codePoints = (s: string): string[] => Array.from(s);
const pyLen = (s: string): number => codePoints(s).length;
/** s[:n] / s[-n:] of a Python str (code points, not UTF-16 units) */
export const pyHead = (s: string, n: number): string => codePoints(s).slice(0, n).join('');
export const pyTail = (s: string, n: number): string => codePoints(s).slice(-n).join('');
export function pySplitLines(s: string): string[] {
  const lines = s.split(PY_LINE_BREAK);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}
/** the order of sorted() on str: by code point */
export function pyCompare(a: string, b: string): number {
  const x = codePoints(a),
    y = codePoints(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = x[i]!.codePointAt(0)! - y[i]!.codePointAt(0)!;
    if (d) return d;
  }
  return x.length - y.length;
}
/** the truth value of a parsed JSON value in Python: empty lists, objects and strings are false */
export function pyTruthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return Boolean(v);
}
/** repr() of a str, for the messages */
export const pyRepr = (s: string | undefined | null): string =>
  s === undefined || s === null
    ? 'None'
    : s.includes("'") && !s.includes('"')
      ? `"${s}"`
      : `'${s}'`;
const count = (s: string, part: string): number => s.split(part).length - 1;

/** html.escape(s) */
export const htmlEscape = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#x27;');

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
};
/** html.unescape for what an attribute of the server document holds: numeric references and the common names */
export function htmlUnescape(s: string): string {
  return s.replace(/&(#[0-9]+|#[xX][0-9a-fA-F]+|[A-Za-z]+);/g, (all, ref: string) => {
    if (ref[0] !== '#') return NAMED[ref] ?? all;
    const code =
      ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
      ? String.fromCodePoint(code)
      : '\ufffd';
  });
}

/** urllib.parse.unquote: %XX runs decoded as UTF-8, a malformed sequence left as it is */
export function unquote(s: string): string {
  if (!s.includes('%')) return s;
  return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) =>
    new TextDecoder('utf-8').decode(
      Uint8Array.from(run.slice(1).split('%'), (h) => parseInt(h, 16)),
    ),
  );
}

/** read_text(encoding='utf-8'): strict UTF-8, a byte-order mark kept, universal newlines */
export function readText(path: string): string {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
    readFileSync(path),
  );
  return text.replace(/\r\n?/g, '\n');
}

// --- addresses ----------------------------------------------------------------------------------------------------------------------

/** '/razhodi/obrazovanie?per=x#y' -> '/razhodi/obrazovanie'; null for files, the embed view and anything else that is not a screen */
export function normPath(href: string): string | null {
  // urllib.parse.urlsplit(href).path: tabs and line breaks dropped, leading controls and spaces stripped, cut at the query or the fragment
  const url = href.replace(/[\t\r\n]/g, '').replace(/^[\x00-\x20]+/, '');
  const beforeQuery = url.split(/[?#]/, 1)[0]!;
  const authority = beforeQuery.startsWith('//') ? beforeQuery.slice(2).search(/\/|$/) + 2 : 0; // //host/path: the host is no part of the path
  let p = beforeQuery.slice(authority) || '/';
  if (p !== '/' && p.endsWith('/')) p = p.replace(/\/+$/, '');
  if (FILE_EXT.test(p) && !p.startsWith('/embed/')) return null;
  if (/^\/(data\/|api\/releases(\/|$))/.test(p)) return null; // the data files and the release API (as NOT_SCREENS in apps/web/client/loc.js)
  if (p.startsWith('/embed/')) return null;
  return p;
}

/** how long the crawl waits before it asks again for a document the Worker refused with 429 (the per-client limit on uncached renders,
 * workers/release-rate-limit.ts): the Retry-After of the answer, in milliseconds. null when the crawl does not ask again: the answer is not
 * 429, it names no whole number of seconds between 1 and 120, or the document was already asked for `tries` times. */
export function renderLimitWait(
  status: number,
  retryAfter: string | null | undefined,
  asked: number,
  tries = 3,
): number | null {
  if (status !== 429 || asked >= tries) return null;
  const text = (retryAfter ?? '').trim();
  if (!/^[0-9]{1,3}$/.test(text)) return null;
  const seconds = Number(text);
  return seconds >= 1 && seconds <= 120 ? seconds * 1000 : null;
}

/** the start page and the sample address of every route, as the paths the crawl starts from */
export function seedPaths(samples: readonly string[]): string[] {
  const seeds = new Set(
    samples.map((s) => normPath(unquote(s.replace(/^#+/, '')).split('?')[0]!) ?? '/'),
  );
  return ['/', ...[...seeds].sort(pyCompare)];
}

// --- the checks of one screen -------------------------------------------------------------------------------------------------------

export function checkPage(
  path: string,
  info: PageInfo,
  built: ReadonlySet<string | null>,
  origin: string,
): Finding[] {
  const out: Finding[] = [];
  const F = (m: string) => out.push(['fail', m]);
  const W = (m: string) => out.push(['warn', m]);
  if (info.view !== 'ready') F(`the screen is in the state "${info.view}"`);
  if (info.route === 'S30') F('the link leads to the 404 screen');
  for (const e of info.errors) F(e);
  if (info.hashLinks.length) F('old #/ links in the DOM: ' + info.hashLinks.join(', '));
  if (!info.desc) F('no meta description');
  else if (pyLen(info.desc) < 50) W(`short meta description (${pyLen(info.desc)} characters)`);
  const want = origin + (path === '/' ? '/' : path);
  if (info.canonical !== want) F(`canonical ${pyRepr(info.canonical)}, expected ${pyRepr(want)}`);
  if (!info.h1) F('no h1');
  if (info.robots.includes('noindex')) F('robots: ' + info.robots);
  let ld: unknown;
  try {
    ld = JSON.parse(info.ld || '{}');
  } catch (e) {
    F(`JSON-LD does not parse: ${(e as Error).message}`);
  }
  if (ld !== undefined && !pyTruthy((ld as Record<string, unknown> | null)?.['@graph']))
    F('no JSON-LD graph');
  for (const h of info.links) {
    const p = normPath(h);
    if (p && !built.has(p)) F(`links to ${h}, which was not built`);
  }
  const ssr = info.ssr ?? {}; // what a crawler without JavaScript reads
  if (ssr.error) F('the server document could not be read: ' + ssr.error);
  else {
    if (ssr.status !== 200) F(`the server answers ${ssr.status ?? 'None'}`);
    if (ssr.view !== 'ready')
      F(`the server document is not a finished screen (data-view="${ssr.view ?? 'None'}")`);
    if (!ssr.h1) F('the server document has no h1');
    if (!ssr.desc) F('the server document has no meta description');
    if (ssr.canonical !== want)
      F(`the server document has canonical ${pyRepr(ssr.canonical)}, expected ${pyRepr(want)}`);
  }
  return out;
}

/** the screen's text for llms-full.txt: without the button labels, single blank lines, at most `cap` characters */
export function cleanText(t: string, cap: number): string {
  const lines: string[] = [];
  let prev = '';
  for (const ln of pySplitLines(t).map(pyStrip)) {
    if (UI_NOISE.has(ln) || (pyLen(ln) < 2 && ln)) continue;
    if (!ln && !prev) continue;
    lines.push(ln);
    prev = ln;
  }
  const s = pyStrip(lines.join('\n'));
  if (pyLen(s) <= cap) return s;
  const head = pyHead(s, cap);
  const cut = head.lastIndexOf('\n');
  return (cut < 0 ? head : head.slice(0, cut)) + '\n…';
}

// --- the files written after the crawl ----------------------------------------------------------------------------------------------

export function writeExtras(
  out: string,
  pages: Record<string, PageInfo>,
  origin: string,
  lastmod: string,
  routes: readonly RouteMeta[],
  noindex = false,
): string[] {
  const idx: Record<string, PageInfo> = {};
  for (const [p, i] of Object.entries(pages)) if (!i.robots.includes('noindex')) idx[p] = i;
  const order = new Map(routes.map((r, n) => [r.id, n] as const));
  const rank = (p: string): number => order.get(idx[p]!.route) ?? 99;
  const paths = Object.keys(idx).sort(
    (a, b) => rank(a) - rank(b) || count(a, '/') - count(b, '/') || pyCompare(a, b),
  );
  const url = (p: string) => origin + (p === '/' ? '/' : p);

  const sm = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const p of paths)
    sm.push(
      `  <url><loc>${htmlEscape(url(p))}</loc>` +
        (lastmod ? `<lastmod>${lastmod}</lastmod>` : '') +
        '</url>',
    );
  sm.push('</urlset>');
  writeFileSync(join(out, 'sitemap.xml'), sm.join('\n') + '\n');

  writeFileSync(
    join(out, 'robots.txt'),
    noindex
      ? '# Тестова среда: не за индексиране.\nUser-agent: *\nDisallow: /\n'
      : '# СИГМА Бюджет: всички страници са отворени за търсачки и езикови модели.\n' +
          'User-agent: *\nAllow: /\nDisallow: /embed/\n\n' +
          `Sitemap: ${origin}/sitemap.xml\n`,
  );

  const title = (i: PageInfo) =>
    i.title.replace(/^СИГМА Бюджет\s+·\s+/, '').replace(/\s+·\s+СИГМА Бюджет(?=\n?$)/, '');
  const byRoute = new Map<string, string[]>();
  for (const p of paths) byRoute.set(idx[p]!.route, [...(byRoute.get(idx[p]!.route) ?? []), p]);
  const rmeta = new Map(routes.map((r) => [r.id, r] as const));
  const main = paths.filter((p) => {
    const r = rmeta.get(idx[p]!.route);
    if (!r?.pattern || !r.nav || count(p, '/') > 1) return false;
    const first = r.pattern.replace(/^\/+|\/+$/g, '').split('/')[0];
    return !(count(r.pattern, ':') && p !== '/' + first);
  });
  // (route, heading, with the description): the long lists (ministries, municipalities, terms) keep llms.txt an index, one line per page
  const childGroups: [string, string, boolean][] = [
    ['S08', 'Разходи по функции', true],
    ['S06', 'Приходи по източници', true],
    ['S12', 'Мерки в бюджета', false],
    ['S11', 'Ведомства', false],
    ['S21', 'Общини', false],
    ['S03', 'Речник', false],
    ['S24', 'Набори с данни', false],
  ];
  const L = [
    '# СИГМА Бюджет',
    '',
    '> Държавният бюджет на България за 2026 г. на разбираем език, по официални данни: откъде идват парите, къде отиват, изпълнява ли се планът, ' +
      'колко дължим и колко плаща всеки. Източниците са Министерството на финансите (месечни отчети по КФП, Закон за държавния бюджет, ' +
      'средносрочна прогноза), „Държавен вестник“, БНБ, НАП и Евростат. До всяко число стоят източникът, обхватът, статусът (проект, закон, отчет, прогноза) и датата.',
    '',
    'Сумите са в евро (България използва еврото от 1 януари 2026 г.).' +
      (lastmod ? ` Данните са към ${lastmod}.` : ''),
    '',
    '## Основни страници',
    '',
  ];
  for (const p of main) L.push(`- [${title(idx[p]!)}](${url(p)}): ${idx[p]!.desc}`);
  for (const [rid, label, withDesc] of childGroups) {
    const ps = (byRoute.get(rid) ?? []).filter((p) => !main.includes(p));
    if (!ps.length) continue;
    L.push('', `## ${label}`, '');
    L.push(
      ...ps.map((p) => `- [${title(idx[p]!)}](${url(p)})` + (withDesc ? `: ${idx[p]!.desc}` : '')),
    );
  }
  L.push(
    '',
    '## Данни',
    '',
    `- [Каталог на наборите (JSON)](${origin}/data/catalog.json): всички файлове с данни, с източник, период, обхват и статус`,
    `- [Отворени данни и API](${url('/api')}): как се четат файловете с код`,
    `- [Какво ново (RSS)](${origin}/data/feed.xml): последните отчети, решения и данни`,
    '',
    '## Optional',
    '',
    `- [Пълният текст на основните страници](${origin}/llms-full.txt)`,
    '',
  );
  writeFileSync(join(out, 'llms.txt'), L.join('\n'));

  const full = [
    '# СИГМА Бюджет: пълният текст на основните страници',
    '',
    `Източник: ${origin}/ · данни към ${lastmod || '—'} · всяка страница по-долу има адрес, кратък отговор (където има) и текста си, с таблиците.`,
    '',
  ];
  for (const p of [...main, ...(byRoute.get('S08') ?? []).filter((q) => !main.includes(q))]) {
    const i = idx[p]!;
    full.push('---', '', `## ${title(i)}`, '', `Адрес: ${url(p)}`, '');
    if (i.answer) full.push(`Накратко: ${i.answer}`, '');
    if (i.lede) full.push(i.lede, '');
    full.push(cleanText(i.text, 6000), '');
  }
  writeFileSync(join(out, 'llms-full.txt'), full.join('\n'));

  // Use exactly the Worker/Vite policy; only cache directives are build-specific. The line break after the shared block is the one the
  // former build got from printing it.
  const shared =
    staticResponseHeaders({ ENVIRONMENT: 'production', NOINDEX: noindex ? '1' : '' }) + '\n';
  writeFileSync(
    join(out, '_headers'),
    shared +
      '/js/chunks/*\n' +
      '  Cache-Control: public, max-age=31536000, immutable\n' +
      '/assets/*\n' +
      '  Cache-Control: public, max-age=31536000, immutable\n' +
      '/vendor/*\n' +
      '  Cache-Control: public, max-age=604800\n' +
      '/data/*\n' +
      '  Cache-Control: public, max-age=300, must-revalidate\n' +
      '/data/releases/current.json\n' + // the pointer to the current release (spec, section 9.2)
      '  ! Cache-Control\n' +
      '  Cache-Control: no-store\n' +
      '/llms*.txt\n' +
      '  Content-Type: text/plain; charset=utf-8\n',
  );
  return paths;
}

/** Fail closed if the deploy artifact loses its public metadata or cache policy. */
export function checkArtifact(out: string, noindex = false): void {
  const must = (ok: boolean, what: string) => {
    if (!ok) throw new Error(`the deploy artifact ${out}: ${what}`);
  };
  const robots = readText(join(out, 'robots.txt'));
  must(
    noindex
      ? robots.includes('Disallow: /\n')
      : robots.includes('Allow: /\n') && robots.includes('Sitemap:'),
    'robots.txt does not match the build (noindex ' + noindex + ')',
  );
  must(
    readText(join(out, 'sitemap.xml')).includes('<url><loc>https://'),
    'sitemap.xml lists no https address',
  );
  must(statSync(join(out, 'llms.txt')).size > 0, 'llms.txt is empty');
  const headers = readText(join(out, '_headers'));
  must(
    headers.includes('/js/chunks/*\n  Cache-Control: public, max-age=31536000, immutable'),
    '_headers lost the immutable cache of /js/chunks/*',
  );
  must(
    headers.split('/data/*')[0]!.includes('x-robots-tag: noindex') === noindex,
    '_headers: x-robots-tag does not match the build (noindex ' + noindex + ')',
  );
  must(
    /const CACHE = 'bns-.*-[0-9a-f]{12}';/.test(readText(join(out, 'sw.js'))),
    'sw.js has no stamped cache name',
  );
}

/** the gzip size the catalog gives: zlib level 9 as in Python, through pako as catalogGzipSize in packages/ingest/src/build/catalog-refresh.ts */
export const gzSize = (raw: Uint8Array): number => gzip(raw, { level: 9 }).length;

/** git rev-parse --short HEAD, or 'local' outside a checkout */
export function shortRevision(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return 'local';
  }
}

/** what in the copied files depends on this build: the RSS links (data/feed.xml was generated with a placeholder host and hash addresses)
 * and the cache name of the service worker (a new name per build: the worker of the previous build drops its copies on activate).
 * Runs before the crawl: the new links change the size of feed.xml, and data/catalog.json (and the catalog screen built from it) must give
 * the size of the file that is served */
export function stampFiles(
  out: string,
  origin: string,
  dataVersion: string,
  revision = shortRevision(),
): void {
  const feed = join(out, 'data', 'feed.xml');
  if (existsSync(feed) && statSync(feed).isFile()) {
    const x = readText(feed)
      .replace(/https?:\/\/budget-na-svetlo\.example\/(?:#\/)?/g, () => origin + '/')
      .replaceAll(origin + '/#/', origin + '/');
    writeFileSync(feed, x);
    const catFile = join(out, 'data', 'catalog.json');
    const cat = JSON.parse(readText(catFile)) as { datasets: Record<string, unknown>[] };
    const raw = readFileSync(feed);
    for (const d of cat.datasets)
      if (d.file === 'data/feed.xml') {
        d.bytes = raw.length;
        d.gzipBytes = gzSize(raw);
      }
    writeFileSync(catFile, JSON.stringify(cat));
  }
  const sw = join(out, 'sw.js');
  const source = readText(sw);
  const name = `bns-${dataVersion || 'data'}-${revision}-${randomBytes(6).toString('hex')}`;
  const cache = /const CACHE = '[^']*';/;
  if (cache.test(source))
    writeFileSync(
      sw,
      source.replace(cache, () => `const CACHE = '${name}';`),
    );
}
