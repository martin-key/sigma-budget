import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadError, PendingError } from '../../client/data.js';
import { TOOLS, call } from './tools';
import { resetParsed } from './data';
import { resetIndexes } from './search';
import { diskCtx, diskRelease, ORIGIN } from './disk-release';

type Out = Record<string, any>;
const ctx = diskCtx();
const run = async (name: string, args: Record<string, unknown> = {}, c = ctx) => {
  const res = await call(c, name, args);
  return { res, out: res.structuredContent as Out };
};
const fails = async (name: string, args: Record<string, unknown>, message: RegExp) => {
  const { res } = await run(name, args);
  expect(res.isError, name).toBe(true);
  expect(res.structuredContent).toBeUndefined();
  expect(res.content[0]!.text).toMatch(message);
};

afterEach(() => {
  vi.restoreAllMocks();
});

it('defines read-only tools with titles, input and output schemas', () => {
  expect(TOOLS.map((t) => t.name)).toEqual([
    'search',
    'fetch',
    'list_datasets',
    'describe_dataset',
    'get_data',
    'explain_number',
    'about_data',
  ]);
  for (const t of TOOLS) {
    expect(t.name.length).toBeLessThanOrEqual(64);
    expect(t.title).toBeTruthy();
    expect(t.annotations).toMatchObject({
      title: t.title,
      readOnlyHint: true,
      destructiveHint: false,
    });
    expect(t.inputSchema.type).toBe('object');
    expect(t.outputSchema.type).toBe('object');
  }
});

it('answers with structured content and the same JSON as text', async () => {
  const { res, out } = await run('about_data');
  expect(JSON.parse(res.content[0]!.text)).toEqual(out);
  expect(out.release_id).toBe('disk');
  expect(out.build.eurRate).toBe(1.95583);
  expect(out.traps.map((t: Out) => t.id)).toContain('eur-bgn');
  expect(out.methodology.map((t: Out) => t.id)).toContain('statuses');
  expect(out.catalog_url).toBe(ORIGIN + '/danni');
});

describe('search and fetch', () => {
  it('finds figures, terms and notes, one result per id, with page addresses', async () => {
    const { out } = await run('search', { query: 'ДДС' });
    const ids = out.results.map((r: Out) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.some((id: string) => id.startsWith('term:'))).toBe(true);
    for (const r of out.results) expect(r.url.startsWith(ORIGIN + '/')).toBe(true);
    const trap = await run('search', { query: 'евро лева курс' });
    expect(trap.out.results.map((r: Out) => r.id)).toContain('trap:eur-bgn');
    expect((await run('search', { query: 'а' })).out.results).toEqual([]);
    const near = await run('search', { query: 'дефецит' });
    expect(near.out.note).toMatch(/най-близките/);
  });
  it('rejects a query that is missing or too long', async () => {
    await fails('search', {}, /Липсва „query“/);
    await fails('search', { query: 'а'.repeat(121) }, /120 знака/);
    await fails('search', { query: 5 }, /текст/);
  });
  it('opens every kind of result', async () => {
    const term = (await run('fetch', { id: 'term:byudzhet' })).out;
    expect(term).toMatchObject({
      id: 'term:byudzhet',
      title: 'Бюджет',
      url: ORIGIN + '/rechnik/byudzhet',
    });
    expect(term.text).toMatch(/^План за това/);
    const set = (await run('fetch', { id: 'dataset:execution' })).out;
    expect(set.metadata).toMatchObject({
      kind: 'dataset',
      unit: 'млн. €',
      file_url: ORIGIN + '/data/execution.json',
    });
    expect(set.text).toMatch(/\/data\/<година>/);
    const pending = (await run('fetch', { id: 'dataset:p02' })).out;
    expect(pending.text).toMatch(/не са в текущото издание/);
    const trap = (await run('fetch', { id: 'trap:eur-bgn' })).out;
    expect(trap.url).toBe(ORIGIN + '/danni?to=s24-t-eur-bgn');
    expect((await run('fetch', { id: 'method:statuses' })).out.url).toBe(
      ORIGIN + '/danni?to=s24-m-statuses',
    );
    const hit = (await run('search', { query: 'Пловдив' })).out.results.find((r: Out) =>
      r.id.startsWith('page:/obshtina/'),
    );
    const page = (await run('fetch', { id: hit.id })).out;
    expect(page.text).toMatch(/Пловдив/);
    expect(page.metadata.datasets).toContain('municipalities');
    const screen = (await run('fetch', { id: 'page:/izpalnenie' })).out;
    expect(screen.metadata.screen).toBe('S15');
    expect(screen.metadata.datasets).toContain('execution');
  });
  it('says which ids exist', async () => {
    await fails('fetch', { id: 'term:nyama' }, /Няма понятие/);
    await fails('fetch', { id: 'trap:nyama' }, /Няма бележка/);
    await fails('fetch', { id: 'page:/nyama/takava' }, /Няма страница/);
    await fails('fetch', { id: 'dataset:nyama' }, /Няма набор „nyama“/);
    await fails('fetch', { id: 'other' }, /Непознат id/);
  });
});

describe('the catalog', () => {
  it('lists the sets, with what is pending and why', async () => {
    const all = (await run('list_datasets')).out;
    const execution = all.datasets.find((s: Out) => s.slug === 'execution');
    expect(execution).toMatchObject({
      status: 'real',
      unit: 'млн. €',
      file_url: ORIGIN + '/data/execution.json',
      page_url: ORIGIN + '/danni/execution',
    });
    expect(execution.pending.map((p: Out) => p.id)).toEqual(expect.arrayContaining(['P02']));
    const pending = (await run('list_datasets', { group: 'pending' })).out.datasets;
    expect(pending.length).toBeGreaterThan(0);
    for (const s of pending)
      expect(s).toMatchObject({ status: 'pending', reason: expect.any(String) });
    await fails('list_datasets', { group: 'nyama' }, /Групите са/);
  });
  it('describes a set: keys, how to read it, sources, traps', async () => {
    const d = (await run('describe_dataset', { slug: 'execution' })).out;
    expect(d.meta.unit).toBe('млн. €');
    expect(d.examples.map((e: Out) => e.path)).toContain('/data/2026/kfp/rev');
    expect(d.sources[0]).toMatchObject({ id: 'kfp', url: expect.stringMatching(/^https:/) });
    expect(d.keys.map((k: Out) => k.key)).toContain('rows');
    const parts = (await run('describe_dataset', { slug: 'ministries-programs' })).out.parts;
    expect(parts.find((p: Out) => p.code === '0100')).toEqual({
      code: '0100',
      name: 'Народно събрание',
    });
    const generic = (await run('describe_dataset', { slug: 'core' })).out;
    expect(generic.how_to_read[0]).toMatch(/`get_data` без `path`/);
    const pending = (await run('describe_dataset', { slug: 'p02' })).out;
    expect(pending).toMatchObject({ status: 'pending', note: expect.stringMatching(/не са нули/) });
    expect(pending.meta).toBeUndefined();
    await fails('describe_dataset', { slug: 'nyama' }, /Наборите са/);
  });
  it('describes the parts without the names when ministries.json is not in the release', async () => {
    const data = diskRelease({
      releaseId: 'no-ministries',
      async load(name) {
        if (name === 'ministries') throw new PendingError(name);
        return diskRelease().load(name);
      },
    });
    const parts = (await run('describe_dataset', { slug: 'ministries-programs' }, diskCtx(data)))
      .out.parts;
    expect(parts[0]).toEqual({ code: '0100' });
  });
});

describe('get_data', () => {
  it('reads a path and keeps the published decimal strings', async () => {
    const { out } = await run('get_data', { slug: 'execution', path: '/data/2026/kfp/rev' });
    expect(out.value.every((v: unknown) => typeof v === 'string')).toBe(true);
    expect(out.meta).toMatchObject({ unit: 'млн. €', status: 'real' });
    expect(out.sources[0].id).toBe('kfp');
    expect(out).toMatchObject({
      path: '/data/2026/kfp/rev',
      truncated: false,
      file_url: ORIGIN + '/data/execution.json',
    });
  });
  it('cites the publication of a period, not the meta of the file', async () => {
    const { out } = await run('get_data', {
      slug: 'outlook',
      path: '/byPeriod/2027.draft/series/balance',
    });
    expect(out.period).toMatchObject({ key: '2027.draft', year: 2027, status: 'draft' });
    expect(out.sources.map((s: Out) => s.id)).toEqual(['budget2027']);
    expect(out.value).toMatchObject({ unit: 'млн. €', provenance: expect.any(String) });
    const whole = (await run('get_data', { slug: 'outlook', path: '/years' })).out;
    expect(whole.period).toBeUndefined();
    expect(whole.sources.map((s: Out) => s.id)).toEqual(whole.meta.source);
  });
  it('pages an array', async () => {
    const first = (await run('get_data', { slug: 'execution', path: '/rows', limit: 5 })).out;
    expect(first.value).toHaveLength(5);
    expect(first.page).toMatchObject({ offset: 0, limit: 5, next: 5 });
    const next = (await run('get_data', { slug: 'execution', path: '/rows', offset: 5, limit: 5 }))
      .out;
    expect(next.value[0].id).not.toBe(first.value[0].id);
  });
  it('gives the outline of a part bigger than the cap', async () => {
    const { res, out } = await run('get_data', { slug: 'budget2027' });
    expect(out.truncated).toBe(true);
    expect(out.value.type).toBe('object');
    expect(out.note).toMatch(/по-тесен път/);
    expect(res.content[0]!.text.length).toBeLessThan(40_000);
  });
  it('reads one part of a set of files', async () => {
    const { out } = await run('get_data', {
      slug: 'ministries-programs',
      part: '0100',
      path: '/cols',
    });
    expect(out).toMatchObject({ part: '0100', file_url: ORIGIN + '/data/ministries/0100.json' });
    expect(out.value).toHaveLength(9);
    await fails('get_data', { slug: 'ministries-programs' }, /дай „part“/);
    await fails('get_data', { slug: 'ministries-programs', part: '9999' }, /Няма част/);
    await fails('get_data', { slug: 'execution', part: '0100' }, /няма части/);
  });
  it('says pending, never zero', async () => {
    const { out } = await run('get_data', { slug: 'p02' });
    expect(out).toMatchObject({
      status: 'pending',
      value: null,
      note: expect.stringMatching(/не са нули/),
    });
    const missing = diskRelease({
      releaseId: 'no-debt',
      async load(name) {
        if (name === 'debt') throw new PendingError(name);
        return diskRelease().load(name);
      },
    });
    expect((await run('get_data', { slug: 'debt' }, diskCtx(missing))).out).toMatchObject({
      status: 'pending',
      value: null,
    });
  });
  it('explains a wrong argument', async () => {
    await fails('get_data', { slug: 'execution', path: '/nope' }, /Ключовете на файла са: meta/);
    await fails('get_data', { slug: 'execution', limit: 0 }, /от 1 до 200/);
    await fails('get_data', { slug: 'execution', offset: 1.5 }, /цяло число/);
    await fails('get_data', { slug: 'feed-rss' }, /не е JSON файл/);
  });
});

describe('explain_number', () => {
  it('finds the cell of a monthly value and checks its original against the manifest', async () => {
    const { out } = await run('explain_number', { record: 'data/2026-09/kfp/rev' });
    expect(out).toMatchObject({ verified: true, sheet: 'стартова', cell: 'B11', unit: 'млн. €' });
    expect(typeof out.value).toBe('string');
    expect(out.original).toMatchObject({
      asOf: '2026-09-30',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(out.source).toMatchObject({
      path: expect.stringMatching(/^data\/originals\//),
      page: expect.stringMatching(/^https:\/\//),
    });
    const monthly = (await run('explain_number', { record: 'monthly/2026-09/kfp/rev' })).out;
    expect(monthly.rule).toBeTruthy();
    expect(monthly.from).toEqual(['data/2026-09/kfp/rev', 'data/2026-08/kfp/rev']);
    expect(monthly.cell).toBeUndefined();
  });
  it('finds the page of a cell of the bill and its archive in the manifest', async () => {
    const id = '7a83fb6508cd980457389efa'; // budget2027.json /budgets/bill/1/rows/0/cell
    const { out } = await run('explain_number', { record: 'budget2027/' + id });
    expect(out).toMatchObject({
      verified: true,
      value: 30942719.3,
      unit: 'хил. €',
      provenance: id,
    });
    expect(out.page).toBeDefined();
    expect(out.document).toMatchObject({ archive: expect.any(String) });
    expect(out.source.path).toBe(out.document.archive);
  });
  it('says unverified when the release has no manifest', async () => {
    const bare = diskRelease({
      releaseId: 'no-manifest',
      async load(name) {
        if (name === 'release/manifest') throw new PendingError(name);
        return diskRelease().load(name);
      },
    });
    const { out } = await run('explain_number', { record: 'data/2026-09/kfp/rev' }, diskCtx(bare));
    expect(out).toMatchObject({ verified: false, cell: 'B11', source: null });
  });
  it('explains a record that is not one', async () => {
    await fails('explain_number', { record: 'rev' }, /data\/2026-09\/kfp\/rev/);
    await fails('explain_number', { record: 'budget2027/' + '0'.repeat(24) }, /Няма такъв запис/);
    await fails('explain_number', { record: 'data/2026-12/kfp/rev' }, /няма в изпълнението/);
  });
});

it('says a release that cannot be read is unavailable, and logs no argument', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  resetParsed();
  resetIndexes();
  const broken = diskRelease({
    releaseId: 'broken',
    async load(name) {
      throw new LoadError(name, 'R2 down');
    },
  });
  const res = await call(diskCtx(broken), 'search', { query: 'тайна-заявка-42' });
  expect(res.isError).toBe(true);
  expect(res.content[0]!.text).toMatch(/не могат да бъдат прочетени/);
  expect(error).toHaveBeenCalledWith('mcp_tool_failed', 'search', 'LoadError');
  expect(JSON.stringify(error.mock.calls)).not.toContain('тайна-заявка-42');
});
