// Release postprocessing, independent of the browser crawl (build-release.ts).
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkArtifact,
  checkPublishedOutputs,
  preservePublishedOutputs,
  checkPage,
  cleanText,
  gzSize,
  normPath,
  renderLimitWait,
  seedPaths,
  stampFiles,
  writeExtras,
  type PageInfo,
} from './release-artifact.ts';

let out: string;
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'release-artifact-'));
});
afterEach(() => rmSync(out, { recursive: true, force: true }));
const read = (name: string) => readFileSync(join(out, name), 'utf8');

const page = (o: Partial<PageInfo> = {}): PageInfo => ({
  route: 'S01',
  view: 'ready',
  title: 'Начало',
  h1: 'Начало',
  desc: 'Описание',
  robots: '',
  canonical: 'https://example.test/',
  ld: '{"@graph":[{}]}',
  hashLinks: [],
  links: [],
  answer: '',
  lede: '',
  text: 'Текст',
  errors: [],
  ssr: {
    status: 200,
    view: 'ready',
    h1: 'Начало',
    desc: 'Описание',
    canonical: 'https://example.test/',
  },
  ...o,
});
const routes = [{ id: 'S01', pattern: '/', nav: true }];

describe('the deploy artifact', () => {
  it('rejects missing or changed output bytes and preserves omitted outputs in the archive', () => {
    const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
    const sebra = Buffer.from('{"rows":[]}\n');
    const core = Buffer.from('{"value":42}\n');
    const output = (path: string, bytes: Buffer) => ({ path, sha256: sha(bytes) });
    const manifest = JSON.stringify({
      outputs: [output('data/sebra.json', sebra), output('data/core.json', core)],
    });
    // the release id is the SHA-256 of its manifest
    const id = sha(manifest);
    const archive = join(out, 'data/releases', id);
    mkdirSync(archive, { recursive: true });
    writeFileSync(join(out, 'data/releases/current.json'), JSON.stringify({ release_id: id }));
    writeFileSync(join(archive, 'manifest.json'), manifest);
    writeFileSync(join(out, 'data/sebra.json'), sebra);
    writeFileSync(join(out, 'data/core.json'), core);
    preservePublishedOutputs(out);
    rmSync(join(out, 'data/sebra.json'));
    expect(() => checkPublishedOutputs(out)).not.toThrow();
    expect(readFileSync(join(archive, 'data/sebra.json'))).toEqual(sebra);
    writeFileSync(join(out, 'data/core.json'), 'changed');
    expect(() => checkPublishedOutputs(out)).toThrow('sha256 mismatch: data/core.json');
    rmSync(join(out, 'data/core.json'));
    expect(() => checkPublishedOutputs(out)).toThrow('missing: data/core.json');
    writeFileSync(join(out, 'data/core.json'), core);
    writeFileSync(join(archive, 'data/sebra.json'), 'changed archive');
    expect(() => checkPublishedOutputs(out)).toThrow('sha256 mismatch: data/sebra.json');
    // a release the Worker could not serve does not pass: no outputs, or a pointer it would not accept
    const empty = JSON.stringify({ outputs: [] });
    mkdirSync(join(out, 'data/releases', sha(empty)), { recursive: true });
    writeFileSync(join(out, 'data/releases', sha(empty), 'manifest.json'), empty);
    writeFileSync(
      join(out, 'data/releases/current.json'),
      JSON.stringify({ release_id: sha(empty) }),
    );
    expect(() => checkPublishedOutputs(out)).toThrow('lists no outputs');
    writeFileSync(
      join(out, 'data/releases/current.json'),
      JSON.stringify({ release_id: 'notahexid' }),
    );
    expect(() => checkPublishedOutputs(out)).toThrow('invalid release_id');
  });

  it('production and noindex', () => {
    const pages = { '/': page() };
    writeExtras(out, pages, 'https://example.test', '2026-11-11', routes);
    writeFileSync(join(out, 'sw.js'), "const CACHE = 'bns-source';");
    stampFiles(out, 'https://example.test', 'v1');
    checkArtifact(out);
    expect(read('robots.txt')).toContain('Allow: /');
    expect(read('sitemap.xml')).toContain('https://example.test/');
    expect(statSync(join(out, 'llms.txt')).size).toBeGreaterThan(0);
    expect(read('_headers')).toContain('max-age=31536000, immutable');
    writeExtras(out, pages, 'https://example.test', '', routes, true);
    checkArtifact(out, true);
    expect(read('robots.txt')).toContain('Disallow: /');
    expect(read('_headers')).toContain('x-robots-tag: noindex');
  });

  it('writes the files the former build wrote for the same screens', () => {
    const pages = {
      '/': page({
        title: 'СИГМА Бюджет · Начало',
        desc: 'Начална страница',
        answer: 'Кратко',
        lede: 'Увод',
      }),
      '/razhodi': page({
        route: 'S07',
        title: 'Разходи · СИГМА Бюджет',
        desc: 'Разходите',
        text: 'Ред\n\nСподели\n\n\nДруг ред\nx',
      }),
      '/razhodi/obrazovanie': page({
        route: 'S08',
        title: 'Образование · СИГМА Бюджет',
        desc: 'Образование',
      }),
      '/skrita': page({ route: 'S07', robots: 'noindex' }),
    };
    const meta = [
      ...routes,
      { id: 'S07', pattern: '/razhodi', nav: true },
      { id: 'S08', pattern: '/razhodi/:f', nav: false },
    ];
    const paths = writeExtras(out, pages, 'https://example.test', '2026-11-11', meta);
    expect(paths).toEqual(['/', '/razhodi', '/razhodi/obrazovanie']);
    expect(read('sitemap.xml')).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        '  <url><loc>https://example.test/</loc><lastmod>2026-11-11</lastmod></url>\n' +
        '  <url><loc>https://example.test/razhodi</loc><lastmod>2026-11-11</lastmod></url>\n' +
        '  <url><loc>https://example.test/razhodi/obrazovanie</loc><lastmod>2026-11-11</lastmod></url>\n</urlset>\n',
    );
    const llms = read('llms.txt');
    expect(llms).toContain(
      '## Основни страници\n\n- [Начало](https://example.test/): Начална страница\n- [Разходи](https://example.test/razhodi): Разходите\n',
    );
    expect(llms).toContain(
      '\n## Разходи по функции\n\n- [Образование](https://example.test/razhodi/obrazovanie): Образование\n',
    );
    expect(llms).toContain(' Данните са към 2026-11-11.');
    expect(llms.endsWith('(https://example.test/llms-full.txt)\n')).toBe(true);
    const full = read('llms-full.txt');
    expect(full).toContain(
      '## Начало\n\nАдрес: https://example.test/\n\nНакратко: Кратко\n\nУвод\n\nТекст\n',
    );
    expect(full).toContain(
      '## Разходи\n\nАдрес: https://example.test/razhodi\n\nРед\n\nДруг ред\n',
    );
    expect(full).toContain('## Образование\n\nАдрес: https://example.test/razhodi/obrazovanie\n');
    expect(full).not.toContain('skrita');
    expect(read('robots.txt')).toBe(
      '# СИГМА Бюджет: всички страници са отворени за търсачки и езикови модели.\nUser-agent: *\nAllow: /\nDisallow: /embed/\n\nSitemap: https://example.test/sitemap.xml\n',
    );
    // the shared policy block, then one blank line, then the cache rules of this build
    expect(read('_headers')).toMatch(
      /^\/\*\n(?: {2}.+\n)+[\s\S]*\n\n\/js\/chunks\/\*\n {2}Cache-Control: public, max-age=31536000, immutable\n/,
    );
    expect(
      read('_headers').endsWith('/llms*.txt\n  Content-Type: text/plain; charset=utf-8\n'),
    ).toBe(true);
  });

  it.each([
    ['robots.txt', 'User-agent: *\nDisallow: /\n', false],
    ['robots.txt', '# СИГМА Бюджет\nUser-agent: *\nAllow: /\n', false],
    ['sitemap.xml', '<urlset></urlset>\n', false],
    ['llms.txt', '', false],
    ['_headers', '/js/chunks/*\n  Cache-Control: no-store\n', false],
    [
      '_headers',
      '/*\n  x-robots-tag: noindex\n/data/*\n/js/chunks/*\n  Cache-Control: public, max-age=31536000, immutable\n',
      false,
    ],
    [
      '_headers',
      '/*\n/data/*\n  x-robots-tag: noindex\n/js/chunks/*\n  Cache-Control: public, max-age=31536000, immutable\n',
      true,
    ],
    ['sw.js', "const CACHE = 'bns-source';", false],
  ] as const)('fails closed when %s loses what the deploy needs (%j)', (name, content, noindex) => {
    writeExtras(out, { '/': page() }, 'https://example.test', '2026-11-11', routes, noindex);
    writeFileSync(join(out, 'sw.js'), "const CACHE = 'bns-source';");
    stampFiles(out, 'https://example.test', 'v1');
    checkArtifact(out, noindex);
    writeFileSync(join(out, name), content);
    expect(() => checkArtifact(out, noindex)).toThrow(/the deploy artifact/);
  });

  it('the service worker changes on each build', () => {
    writeFileSync(join(out, 'sw.js'), "const CACHE = 'bns-source';");
    stampFiles(out, 'https://example.test', 'v1');
    const first = read('sw.js');
    stampFiles(out, 'https://example.test', 'v1');
    expect(read('sw.js')).not.toBe(first);
    expect(first).toMatch(/^const CACHE = 'bns-v1-[^-]+-[0-9a-f]{12}';$/);
    stampFiles(out, 'https://example.test', '', 'abc1234');
    expect(read('sw.js')).toMatch(/^const CACHE = 'bns-data-abc1234-[0-9a-f]{12}';$/);
  });

  it('stamps the RSS links and gives the catalog the size of the served feed', () => {
    mkdirSync(join(out, 'data'));
    writeFileSync(join(out, 'sw.js'), 'self.x = 1;\n');
    writeFileSync(
      join(out, 'data', 'feed.xml'),
      '<rss>\r\n<link>https://budget-na-svetlo.example/#/razhodi</link><link>http://budget-na-svetlo.example/novo</link>' +
        '<link>https://example.test/#/dalg</link></rss>\n',
    );
    writeFileSync(
      join(out, 'data', 'catalog.json'),
      JSON.stringify(
        {
          datasets: [
            { file: 'data/feed.xml', bytes: 1, gzipBytes: 1 },
            { file: 'data/core.json', bytes: 7 },
          ],
        },
        null,
        1,
      ) + '\n',
    );
    const id = 'd'.repeat(64);
    mkdirSync(join(out, 'data/releases'), { recursive: true });
    writeFileSync(join(out, 'data/releases/current.json'), JSON.stringify({ release_id: id }));
    const originalFeed = read('data/feed.xml'),
      originalCatalog = read('data/catalog.json');
    stampFiles(out, 'https://example.test', 'v1', 'abc1234');
    const feed = read('data/feed.xml');
    expect(feed).toBe(
      '<rss>\n<link>https://example.test/razhodi</link><link>https://example.test/novo</link><link>https://example.test/dalg</link></rss>\n',
    );
    const raw = readFileSync(join(out, 'data', 'feed.xml'));
    expect(read('data/catalog.json')).toBe(
      `{"datasets":[{"file":"data/feed.xml","bytes":${raw.length},"gzipBytes":${gzSize(raw)}},{"file":"data/core.json","bytes":7}]}`,
    );
    expect(read(`data/releases/${id}/data/feed.xml`)).toBe(originalFeed);
    expect(read(`data/releases/${id}/data/catalog.json`)).toBe(originalCatalog);
    stampFiles(out, 'https://other.test', 'v2', 'def5678');
    expect(read(`data/releases/${id}/data/feed.xml`)).toBe(originalFeed);
    expect(read(`data/releases/${id}/data/catalog.json`)).toBe(originalCatalog);
    expect(read('sw.js')).toBe('self.x = 1;\n'); // nothing to stamp: the file is left as it is
  });

  it('measures gzip as zlib level 9 does', () => {
    // The expected size is frozen from Python's GzipFile(mtime=0, compresslevel=9), which wrote these numbers into the published
    // catalogs. zlib in Node may compress to another length, so it is not the reference.
    const raw = Buffer.from('<rss>' + 'бюджет '.repeat(500) + '</rss>');
    expect(gzSize(raw)).toBe(79);
    expect(gzSize(new Uint8Array())).toBe(20);
  });
});

describe('the crawl', () => {
  it('asks again for a document refused by the render limit only as the answer allows', () => {
    // the Worker answers 429 with Retry-After: 60 (workers/release-rate-limit.ts)
    expect(renderLimitWait(429, '60', 1)).toBe(60000);
    expect(renderLimitWait(429, ' 1 ', 2)).toBe(1000);
    expect(renderLimitWait(429, '120', 2)).toBe(120000);
    // the third answer counts whatever it is
    expect(renderLimitWait(429, '60', 3)).toBeNull();
    expect(renderLimitWait(429, '60', 1, 1)).toBeNull();
    // no other status is asked for again
    for (const status of [200, 301, 404, 500, 503])
      expect(renderLimitWait(status, '60', 1)).toBeNull();
    // without a usable Retry-After the refusal stands
    for (const header of [
      undefined,
      null,
      '',
      '0',
      '121',
      '1.5',
      '-1',
      '1e2',
      'Wed, 21 Oct 2026 07:28:00 GMT',
    ])
      expect(renderLimitWait(429, header, 1)).toBeNull();
  });
  it.each([
    ['/razhodi/obrazovanie?per=x#y', '/razhodi/obrazovanie'],
    ['/razhodi/', '/razhodi'],
    ['/', '/'],
    ['?q=1', '/'],
    ['/vedomstvo/0200/0200.01.00', '/vedomstvo/0200/0200.01.00'],
    ['/data/catalog.json', null],
    ['/og.png', null],
    ['/data/', '/data'],
    ['/api/releases', null],
    ['/api/releases/x', null],
    ['/api', '/api'],
    ['/embed/dalg.s17-eu', null],
    ['//other.example/razhodi', '/razhodi'],
  ])('normPath(%j) = %j', (href, want) => expect(normPath(href)).toBe(want));

  it('starts from the home page and every sample address', () => {
    expect(
      seedPaths([
        '/razhodi?po=vid',
        '#/dalg',
        '/data/catalog.json',
        '/obshtina/%D0%A1',
        '/razhodi',
      ]),
    ).toEqual(['/', '/', '/dalg', '/obshtina/С', '/razhodi']);
  });

  it('a ready screen passes; each broken part of it fails', () => {
    const built = new Set(['/', '/razhodi']);
    const desc = 'Описание на началната страница, достатъчно дълго за търсачките.';
    const ok = page({ desc, links: ['/razhodi?per=1', '/data/catalog.json'] });
    expect(checkPage('/', ok, built, 'https://example.test')).toEqual([]);
    const fails = (o: Partial<PageInfo>, path = '/') =>
      checkPage(path, page({ ...o }), built, 'https://example.test')
        .filter(([level]) => level === 'fail')
        .map(([, m]) => m);
    expect(fails({ view: 'error' })).toEqual(['the screen is in the state "error"']);
    expect(fails({ route: 'S30' })).toEqual(['the link leads to the 404 screen']);
    expect(fails({ errors: ['console: boom'] })).toEqual(['console: boom']);
    expect(fails({ hashLinks: ['#/razhodi'] })).toEqual(['old #/ links in the DOM: #/razhodi']);
    expect(fails({ desc: '' })).toEqual(['no meta description']);
    expect(fails({ canonical: 'https://example.test/x' })).toEqual([
      "canonical 'https://example.test/x', expected 'https://example.test/'",
    ]);
    expect(fails({ h1: '' })).toEqual(['no h1']);
    expect(fails({ robots: 'noindex' })).toEqual(['robots: noindex']);
    expect(fails({ ld: '{"@graph":[]}' })).toEqual(['no JSON-LD graph']);
    expect(fails({ ld: '' })).toEqual(['no JSON-LD graph']);
    expect(fails({ ld: '{' })[0]).toMatch(/^JSON-LD does not parse: /);
    expect(fails({ links: ['/nyama'] })).toEqual(['links to /nyama, which was not built']);
    expect(fails({ ssr: { error: 'timeout' } })).toEqual([
      'the server document could not be read: timeout',
    ]);
    expect(fails({ ssr: { ...page().ssr, status: 500 } })).toEqual(['the server answers 500']);
    expect(fails({ ssr: { ...page().ssr, view: 'loading' } })).toEqual([
      'the server document is not a finished screen (data-view="loading")',
    ]);
    expect(fails({ ssr: { ...page().ssr, h1: '' } })).toEqual(['the server document has no h1']);
    expect(fails({ ssr: { ...page().ssr, desc: '' } })).toEqual([
      'the server document has no meta description',
    ]);
    expect(fails({ ssr: { ...page().ssr, canonical: '' } })).toEqual([
      "the server document has canonical '', expected 'https://example.test/'",
    ]);
    expect(fails({}, '/razhodi')).toEqual([
      "canonical 'https://example.test/', expected 'https://example.test/razhodi'",
      "the server document has canonical 'https://example.test/', expected 'https://example.test/razhodi'",
    ]);
    expect(checkPage('/', page({ desc: 'кратко' }), built, 'https://example.test')).toEqual([
      ['warn', 'short meta description (6 characters)'],
    ]);
  });

  it('keeps the text of a screen for llms-full.txt as the former build did', () => {
    expect(cleanText('  Заглавие \n\n\nСподели\nx\n\n Текст\u00a0\n', 100)).toBe(
      'Заглавие\n\nТекст',
    );
    expect(cleanText('първи ред\nвтори ред\nтрети ред', 15)).toBe('първи ред\n…');
    expect(cleanText('😀\nab', 100)).toBe('ab');
    expect(cleanText('a\u2028bb\x1ccc', 100)).toBe('bb\ncc');
  });
});
