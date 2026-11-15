// Build the site for the host and check every screen (docs/adr/0002-react-router-ssr.md).
//
//     pnpm build:release                                          # = node apps/web/scripts/build-release.ts
//     pnpm build:release --origin https://preview.example.org     # the address the canonical links, the sitemap and llms.txt name
//     pnpm build:release --limit 40                               # a quick partial check (the link checks below still run)
//     pnpm build:release --env staging --noindex                  # staging: its Worker config (CLOUDFLARE_ENV), kept out of search engines
//
// Chromium is the one of the pinned Playwright (`pnpm exec playwright install chromium`; PLAYWRIGHT_BROWSERS_PATH is honoured).
//
// How it works. `react-router build` writes build/client (the files of web assets/, served as they are) and build/server (the Worker that
// draws every screen from the current release, apps/web/workers/app.ts). The files that depend on this build are stamped in build/client
// (the RSS links, the service worker's cache name). Then the built Worker runs under `wrangler dev` with an empty registry, so it draws the
// screens from the data built from git, and headless Chromium crawls it from the start page: every screen it reaches through a link is
// checked twice, as the server sends it (a finished screen in the HTML itself, for crawlers and the first paint: data-view="ready", an h1, a
// description, the canonical link) and as the browser shows it once the app has taken over. Last, sitemap.xml, robots.txt, llms.txt,
// llms-full.txt and _headers are written into build/client (release-artifact.ts).
//
// A screen that is not ready, shows an error, logs a console error, links to an address that is not a screen or still carries an old #/
// link, or lacks a title, description or canonical link fails the build (exit 1).
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Browser, type BrowserContext } from '@playwright/test';
import { ROUTES } from '../app/lib/routes.ts';
import {
  checkArtifact,
  checkPage,
  normPath,
  pyCompare,
  pyHead,
  pySplitLines,
  pyTail,
  readText,
  renderLimitWait,
  ROOT,
  seedPaths,
  stampFiles,
  writeExtras,
  htmlUnescape,
  type PageInfo,
  type RouteMeta,
  type ServerDocument,
} from './release-artifact.ts';

const SITE = join(ROOT, 'apps', 'web', 'public');
const NOT_FOUND_PROBE = '/nyama-takava-stranitsa';
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
const firstLine = (e: unknown) =>
  pyHead(pySplitLines(e instanceof Error ? e.message : String(e))[0] ?? '', 200);

/** Run in the page once the screen is ready: what the build needs to know, and the document as the file should hold it. */
function snapshot() {
  const art = document.querySelector<HTMLElement>('article.page');
  const m = (n: string) =>
    document.querySelector<HTMLMetaElement>(`meta[name="${n}"]`)?.content || '';
  const info = {
    route: art?.dataset.route || '',
    view: art?.dataset.view || '',
    title: document.title,
    h1: (art?.querySelector('h1')?.textContent || '').trim(),
    desc: m('description'),
    robots: m('robots'),
    canonical: document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || '',
    ld: document.getElementById('ld-page')?.textContent || '',
    hashLinks: [...document.querySelectorAll('a[href^="#/"]')]
      .map((a) => a.getAttribute('href'))
      .slice(0, 5),
    links: [
      ...new Set(
        [...document.querySelectorAll('a[href]')]
          .map((a) => a.getAttribute('href'))
          .filter((h) => h && h.startsWith('/') && !h.startsWith('//')),
      ),
    ],
    answer: ((document.querySelector('#view .answer') as HTMLElement | null)?.innerText || '')
      .replace(/^Накратко\s*/, '')
      .trim(),
    lede: ((art?.querySelector(':scope > .lede') as HTMLElement | null)?.innerText || '').trim(),
    text: (art?.querySelector('.page-body') as HTMLElement | null)?.innerText || '',
    routes:
      location.pathname === '/' ? (window as unknown as { __ROUTES__: unknown }).__ROUTES__ : null,
    html: '',
  };
  const doc = document.documentElement.cloneNode(true) as HTMLElement;
  doc.removeAttribute('class');
  doc.setAttribute('data-prerendered', location.pathname + location.search); // the address this HTML is the screen of (js/router.js compares it)
  for (const el of doc.querySelectorAll('[_echarts_instance_]')) {
    el.replaceChildren(); // a canvas has no content in HTML: the app draws it again
    el.removeAttribute('_echarts_instance_');
  }
  // vendor/echarts.min.js (1 MB), added by js/charts.js: in the file it would block the first paint; the app loads it again.
  for (const el of doc.querySelectorAll<HTMLScriptElement>('script[src]'))
    if (el.type !== 'module' && !el.hasAttribute('data-keep')) el.remove();
  for (const el of doc.querySelectorAll('svg.map-svg')) el.replaceChildren(); // 265 municipality outlines are ~280 KB of HTML: the app draws the map again
  for (const el of doc.querySelectorAll('[data-hydrated]')) el.removeAttribute('data-hydrated');
  for (const el of doc.querySelectorAll('#toasts, #live')) el.replaceChildren();
  // the same HTML from every build: the „има непрочетено“ dot is the visitor's own state (js/shell.js checkNews sets it again), and the page
  // styles land in <head> wherever their module happened to finish loading (js/router.js loadStyle): they go after the shared styles, by name
  for (const dot of doc.querySelectorAll<HTMLElement>('[data-news-dot]')) {
    dot.hidden = true;
    delete dot.dataset.latest;
    dot.parentElement?.removeAttribute('aria-label');
  }
  const shared = [...doc.querySelectorAll('head > link[rel="stylesheet"]:not([data-page])')].pop();
  const css = [...doc.querySelectorAll<HTMLElement>('link[data-page]')].sort((x, y) =>
    x.dataset.page! < y.dataset.page! ? -1 : 1,
  );
  // (the DOM after(), not the HTMLRewriter Element of @cloudflare/workers-types)
  if (shared) (shared as unknown as { after(...nodes: Node[]): void }).after(...css);
  for (const el of doc.querySelectorAll('dialog, .popover')) el.remove();
  doc.querySelector('#view')?.removeAttribute('aria-busy');
  const o = location.origin;
  for (const el of doc.querySelectorAll('[href],[src]'))
    for (const a of ['href', 'src']) {
      const v = el.getAttribute(a);
      if (v && v.startsWith(o + '/')) el.setAttribute(a, v.slice(o.length)); // the file is served from the root of the host, whatever its name
    }
  info.html = '<!doctype html>\n' + doc.outerHTML;
  return info;
}

class Crawl {
  readonly queue: string[] = [];
  readonly seen = new Set<string>();
  readonly pages: Record<string, PageInfo> = {};
  readonly fails: [string, string][] = [];
  readonly warns: [string, string][] = [];
  notFound: PageInfo | null = null;
  private busy = 0;
  private limited = 0;
  private refused = false;
  private readonly base: string;
  private readonly jobs: number;
  private readonly limit: number;

  constructor(base: string, jobs: number, limit: number) {
    this.base = base;
    this.jobs = jobs;
    this.limit = limit;
  }

  add(path: string | null): void {
    if (path && !this.seen.has(path) && (!this.limit || this.seen.size < this.limit)) {
      this.seen.add(path);
      this.queue.push(path);
    }
  }

  /** build one screen; a page that fails or logs a failed request is built once more (a network change in the middle of a build is not a
   * fault of the page), and the second result is the one that counts */
  async visit(ctx: BrowserContext, path: string): Promise<PageInfo | null> {
    for (const attempt of [1, 2]) {
      const [info, err] = await this.visitOnce(ctx, path);
      if (info !== null && !info.errors.length) return info;
      if (attempt === 2) {
        if (info === null) this.fails.push([path, err]);
        return info;
      }
    }
    return null;
  }

  async visitOnce(ctx: BrowserContext, path: string): Promise<[PageInfo, ''] | [null, string]> {
    const page = await ctx.newPage();
    const errs: string[] = [];
    const address = this.base.replace(/\/+$/, '') + path;
    let ssr: ServerDocument;
    try {
      // the document as the server sends it, before any script runs
      let raw = await page.request.get(address, { maxRedirects: 0 });
      // the Worker limits the uncached renders of one client per minute and the crawl is one client: on 429 it waits as long as the answer
      // says and asks again, at most three requests in one attempt at a screen. A document that is still refused after that is reported
      // like any other status, and from then on the crawl does not wait again: a limit that never lets go ends in FAIL lines, not in the
      // time limit of the job
      for (let asked = 1; !this.refused; asked += 1) {
        const wait = renderLimitWait(raw.status(), raw.headers()['retry-after'], asked);
        if (wait === null) {
          if (raw.status() === 429) this.refused = true;
          break;
        }
        this.limited += 1;
        if (this.limited === 1 || this.limited % 25 === 0)
          console.log(
            `  the render limit of the Worker: waiting ${wait / 1000} s (${this.limited} so far)`,
          );
        await sleep(wait);
        raw = await page.request.get(address, { maxRedirects: 0 });
      }
      const doc = await raw.text();
      const m = (rx: RegExp) => rx.exec(doc)?.[1] ?? '';
      ssr = {
        status: raw.status(),
        view: m(/<article class="page[^"]*"[^>]*data-view="([^"]*)"/s),
        h1: m(/<h1[^>]*>(.*?)<\/h1>/s)
          .replace(/<[^>]+>/g, '')
          .trim(),
        desc: htmlUnescape(m(/<meta name="description" content="([^"]*)"/s)),
        canonical: htmlUnescape(m(/<link rel="canonical" href="([^"]*)"/s)),
      };
    } catch (e) {
      ssr = { error: firstLine(e) };
    }
    page.on('console', (msg) => {
      if (msg.type() === 'error') errs.push('console: ' + pyHead(msg.text(), 200));
    });
    page.on('pageerror', (e) => errs.push('pageerror: ' + pyHead(e.message, 200)));
    page.on('requestfailed', (r) => {
      const failure = r.failure()?.errorText ?? 'None';
      if (!failure.includes('ERR_ABORTED'))
        errs.push(`request failed: ${pyTail(r.url(), 90)} (${failure})`);
    });
    let info: PageInfo;
    try {
      await page.goto(address, { waitUntil: 'domcontentloaded' });
      // data-ready="1": mounted, the glossary links applied (js/router.js); then every chart that is shown has drawn (a chart in a closed tab
      // or a hidden view stays data-ready="0" until it is shown). The same moment in every build: the same files.
      await page.waitForSelector('article.page[data-ready="1"]', { timeout: 45000 });
      await page.waitForFunction(
        () =>
          [...document.querySelectorAll<HTMLElement>('article.page .chart')].every(
            (b) => b.dataset.ready !== '0' || b.clientWidth < 10,
          ),
        undefined,
        { timeout: 20000 },
      );
      await page.waitForTimeout(150);
      info = (await page.evaluate(snapshot)) as unknown as PageInfo;
    } catch (e) {
      // every failure of one page is reported, the crawl goes on
      await page.close();
      return [null, `not built: ${firstLine(e)}`];
    }
    await page.close();
    info.errors = errs;
    info.ssr = ssr;
    return [info, ''];
  }

  async worker(browser: Browser): Promise<void> {
    const ctx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      locale: 'bg-BG',
      timezoneId: 'Europe/Sofia',
    });
    let idle = 0;
    for (;;) {
      if (!this.queue.length) {
        if (this.busy === 0 && idle > 2) break;
        idle += 1;
        await sleep(200);
        continue;
      }
      idle = 0;
      const path = this.queue.shift()!;
      this.busy += 1;
      const info = await this.visit(ctx, path);
      this.busy -= 1;
      if (info === null) continue;
      this.pages[path] = info;
      for (const h of info.links) this.add(normPath(h));
      const done = Object.keys(this.pages).length;
      if (done % 25 === 0) console.log(`  ${done} screens built, ${this.queue.length} waiting`);
    }
    await ctx.close();
  }

  async run(seeds: string[]): Promise<void> {
    for (const s of seeds) this.add(s);
    this.busy = 0;
    const browser = await chromium.launch();
    try {
      await Promise.all(Array.from({ length: this.jobs }, () => this.worker(browser)));
      const nfCtx = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      });
      this.notFound = await this.visit(nfCtx, NOT_FOUND_PROBE);
      await nfCtx.close();
    } finally {
      await browser.close();
    }
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** the built Worker under wrangler dev, with an empty registry (the screens come from the data built from git) */
async function startWorker(
  built: string,
  origin: string,
  sigmaUrl: string | undefined,
  state: string,
): Promise<[ChildProcess, string]> {
  const port = Number.parseInt(process.env.BUDGET_TEST_PORT || '8816', 10);
  const args = [
    'dev',
    '-c',
    built,
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--persist-to',
    state,
  ];
  args.push('--var', 'SITE_ORIGIN:' + origin, '--var', 'NOINDEX:');
  if (sigmaUrl) args.push('--var', 'SIGMA_URL:' + sigmaUrl);
  const log = openSync(join(state, 'wrangler.log'), 'w');
  const proc = spawn(join(ROOT, 'node_modules', '.bin', 'wrangler'), args, {
    cwd: ROOT,
    stdio: ['ignore', log, log],
  });
  closeSync(log);
  const base = `http://127.0.0.1:${port}/`;
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(base + 'robots.txt', { signal: AbortSignal.timeout(2000) });
      await res.arrayBuffer();
      if (res.ok) return [proc, base];
    } catch {
      // not listening yet
    }
    await sleep(1000);
  }
  proc.kill('SIGTERM');
  fail(`build: wrangler dev did not start (${join(state, 'wrangler.log')})`);
}

/** stop wrangler dev: SIGTERM, then SIGKILL after 20 s */
async function stopWorker(proc: ChildProcess): Promise<void> {
  if (proc.exitCode !== null || proc.signalCode !== null) return;
  const exited = new Promise<void>((done) => proc.once('exit', () => done()));
  proc.kill('SIGTERM');
  const timer = setTimeout(() => proc.kill('SIGKILL'), 20000);
  await exited;
  clearTimeout(timer);
}

const USAGE = `usage: pnpm build:release [--origin ORIGIN] [--sigma-url URL] [--env ENV] [--no-build] [--jobs N] [--limit N] [--noindex]

Build the site for the host and check every screen (docs/adr/0002-react-router-ssr.md).

  --origin ORIGIN   production address (default: <meta name="site-origin"> in apps/web/public/index.html)
  --sigma-url URL   address of the original СИГМА for the menu and the footer (default: the Worker config)
  --env ENV         the Worker environment of apps/web/wrangler.jsonc to build for (CLOUDFLARE_ENV), e.g. staging
  --no-build        check the build/ that is there (react-router build was run already)
  --jobs N          pages checked at the same time (default 6)
  --limit N         check at most N screens (a quick try; links to the others then fail the check)
  --noindex         a staging build: robots.txt disallows everything and every file says X-Robots-Tag: noindex`;

function parse(argv: string[]) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        origin: { type: 'string' },
        'sigma-url': { type: 'string' },
        env: { type: 'string', default: '' },
        'no-build': { type: 'boolean', default: false },
        jobs: { type: 'string', default: '6' },
        limit: { type: 'string', default: '0' },
        noindex: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (e) {
    console.error(USAGE + '\n\nbuild-release: error: ' + (e as Error).message);
    process.exit(2);
  }
  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }
  const int = (name: 'jobs' | 'limit') => {
    const v = values[name];
    if (!/^\s*[-+]?\d+\s*$/.test(v)) {
      console.error(
        `${USAGE}\n\nbuild-release: error: argument --${name}: invalid int value: '${v}'`,
      );
      process.exit(2);
    }
    return Number.parseInt(v, 10);
  };
  return {
    origin: values.origin,
    sigmaUrl: values['sigma-url'],
    env: values.env,
    noBuild: values['no-build'],
    jobs: int('jobs'),
    limit: int('limit'),
    noindex: values.noindex,
  };
}

async function main(): Promise<void> {
  const a = parse(process.argv.slice(2));
  a.env = a.env || process.env.CLOUDFLARE_ENV || '';
  a.noindex = a.noindex || Boolean(a.env && a.env !== 'production') || process.env.NOINDEX === '1';

  const template = readText(join(SITE, 'index.html'));
  const declared = /<meta name="site-origin" content="([^"]+)"/.exec(template)?.[1];
  const origin = (
    a.origin ||
    declared ||
    fail('build: no <meta name="site-origin"> in apps/web/public/index.html')
  ).replace(/\/+$/, '');
  if (a.sigmaUrl && !/^https:\/\/[^\s"<>]+$/.test(a.sigmaUrl))
    fail('--sigma-url must be an https address');
  if (!a.noBuild) {
    const r = spawnSync('pnpm', ['--filter', '@sigma-budget/web...', 'build'], {
      cwd: ROOT,
      env: { ...process.env, ...(a.env ? { CLOUDFLARE_ENV: a.env } : {}) },
      encoding: 'utf8',
      maxBuffer: 1 << 30,
    });
    if (r.status !== 0)
      fail(
        'build: workspace build failed:\n' +
          pyTail((r.stdout ?? '') + (r.stderr ?? '') || String(r.error ?? ''), 3000),
      );
  }
  const out = join(ROOT, 'apps', 'web', 'build', 'client');
  const built = join(ROOT, 'apps', 'web', 'build', 'server', 'wrangler.json');
  if (
    !existsSync(out) ||
    !statSync(out).isDirectory() ||
    !existsSync(built) ||
    !statSync(built).isFile()
  )
    fail('build: no build/ (run without --no-build)');
  const buildVars = (JSON.parse(readText(built)) as { vars?: Record<string, unknown> }).vars ?? {};
  const environment = 'ENVIRONMENT' in buildVars ? buildVars.ENVIRONMENT : 'production';
  a.noindex = a.noindex || environment !== 'production' || buildVars.NOINDEX === '1';
  // СЕБРА: on disk for phase 2, used by no screen and not in the catalog
  rmSync(join(out, 'data', 'sebra.json'), { force: true });

  const core = JSON.parse(readFileSync(join(ROOT, 'data', 'release', 'core.json'), 'utf8')) as {
    build?: { dataVersion?: string } | null;
  };
  const dv = core.build?.dataVersion || '';
  const lastmod = /^\d{4}-\d{2}-\d{2}/.test(dv)
    ? Array.from(dv).slice(0, 10).join('')
    : localDate();
  const seeds = seedPaths(ROUTES.flatMap((r) => r.samples));

  stampFiles(out, origin, dv);
  const t0 = Date.now();
  const state = mkdtempSync(join(tmpdir(), 'site-build-'));
  const [worker, base] = await startWorker(built, origin, a.sigmaUrl, state);
  console.log(
    `build: ${base} (build/server, ${a.env || 'top-level'} config) · origin ${origin} · ${a.jobs} pages at a time`,
  );
  const crawl = new Crawl(base, a.jobs, a.limit);
  try {
    await crawl.run(seeds);
  } finally {
    await stopWorker(worker);
    rmSync(state, { recursive: true, force: true });
  }

  const routes = (crawl.pages['/']?.routes as RouteMeta[] | null | undefined) || []; // window.__ROUTES__ (js/routes.js)

  const builtPaths = new Set<string | null>(Object.keys(crawl.pages));
  const known = a.limit
    ? new Set([...builtPaths, ...Object.values(crawl.pages).flatMap((i) => i.links.map(normPath))])
    : builtPaths;
  const fails = [...crawl.fails];
  const warns = [...crawl.warns];
  for (const path of Object.keys(crawl.pages).sort(pyCompare))
    for (const [level, msg] of checkPage(path, crawl.pages[path]!, known, origin))
      (level === 'fail' ? fails : warns).push([path, msg]);
  const titles = new Map<string, number>();
  for (const i of Object.values(crawl.pages)) titles.set(i.title, (titles.get(i.title) ?? 0) + 1);
  for (const [path, info] of Object.entries(crawl.pages))
    if (titles.get(info.title)! > 1)
      warns.push([path, `the title is shared by ${titles.get(info.title)} screens: ${info.title}`]);
  const nf = crawl.notFound;
  if (!nf || nf.route !== 'S30')
    fails.push([NOT_FOUND_PROBE, 'the 404 screen is not shown for an unknown address']);
  else if (nf.ssr?.status !== 404)
    fails.push([
      NOT_FOUND_PROBE,
      `an unknown address answers ${nf.ssr?.status ?? 'None'}, not 404`,
    ]);

  const paths = writeExtras(out, crawl.pages, origin, lastmod, routes, a.noindex);
  checkArtifact(out, a.noindex);
  const dt = (Date.now() - t0) / 1000;
  console.log(
    `\n${Object.keys(crawl.pages).length} screens checked (${paths.length} in the sitemap) in ${dt.toFixed(0)} s → ${out}`,
  );
  for (const [path, msg] of warns.slice(0, 40)) console.log(`  warn ${path}: ${msg}`);
  if (warns.length > 40) console.log(`  … ${warns.length - 40} more warnings`);
  for (const [path, msg] of fails.slice(0, 80)) console.log(`  FAIL ${path}: ${msg}`);
  console.log(
    `RESULT: ${fails.length ? 'FAIL' : 'PASS'} · failures ${fails.length} · warnings ${warns.length}`,
  );
  process.exit(fails.length ? 1 : 0);
}

/** datetime.date.today().isoformat(): the local date */
function localDate(): string {
  const d = new Date();
  return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
    .map((n, i) => String(n).padStart(i ? 2 : 4, '0'))
    .join('-');
}

await main();
