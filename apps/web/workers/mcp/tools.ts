// The tools of the MCP server (apps/web/workers/mcp/handler.ts). All of them only read the current release. `search` and `fetch` have the
// shapes ChatGPT expects for deep research ({results:[{id,title,url}]} and {id,title,text,url,metadata}); the others read the catalog, a part
// of a file and the provenance of a number. Every answer names the release and links to the page and the file it comes from.
import { screenOf, MAX_QUERY } from '../../client/searchlib.js';
import { PendingError } from '../../client/data.js';
import {
  catalog,
  core,
  fileName,
  fileUrl,
  load,
  metaOf,
  pageUrl,
  screenUrl,
  sources,
  type CatalogSet,
  type Ctx,
} from './data';
import datasetScreens from '../../app/lib/dataset-screens.json' with { type: 'json' };
import { FORMATS, GENERIC } from './formats';

/** the screens a set appears on: the site's own mapping (app/lib/dataset-screens.json, as client/catalog.js), else an older catalogue's */
const screensOf = (s: CatalogSet): string[] =>
  (datasetScreens as Record<string, string[]>)[s.slug] ?? s.screens ?? [];
import { entriesOf, search } from './search';
import { fit, resolve, ArgError, DEFAULT_LIMIT, MAX_LIMIT } from './slice';

type Args = Record<string, unknown>;
type Json = Record<string, unknown>;

/* ------------------------------------------------------------------ arguments */
function text(args: Args, key: string, o: { max: number; required?: boolean }): string {
  const v = args[key];
  if (v === undefined || v === null || v === '') {
    if (o.required) throw new ArgError(`Липсва „${key}“.`);
    return '';
  }
  if (typeof v !== 'string') throw new ArgError(`„${key}“ трябва да е текст.`);
  if (v.length > o.max) throw new ArgError(`„${key}“ е по-дълъг от ${o.max} знака.`);
  return v;
}
function integer(args: Args, key: string, o: { min: number; max: number; fallback: number }) {
  const v = args[key];
  if (v === undefined || v === null) return o.fallback;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < o.min || v > o.max)
    throw new ArgError(`„${key}“ трябва да е цяло число от ${o.min} до ${o.max}.`);
  return v;
}

async function setOf(ctx: Ctx, slug: string): Promise<CatalogSet> {
  const cat = await catalog(ctx);
  const want = slug.trim().toLowerCase();
  const set = cat.datasets.find((s) => s.slug === want);
  if (!set)
    throw new ArgError(
      `Няма набор „${slug}“. Наборите са: ${cat.datasets.map((s) => s.slug).join(', ')}.`,
    );
  return set;
}

/** the pending parts of a set (P02…), with what is missing and where it is expected */
async function pendingOf(ctx: Ctx, ids: unknown) {
  if (!Array.isArray(ids) || !ids.length) return undefined;
  const c = await core(ctx);
  return ids
    .filter((id): id is string => typeof id === 'string')
    .map((id) => {
      const p = c.pending[id];
      return p ? { id, title: p.title, reason: p.reason, expected: p.expected } : { id };
    });
}

const pendingNote =
  'Тези данни не са в текущото издание: числа няма, а не са нули. Причината и къде се очакват са в `reason` и `expected`.';

/* ------------------------------------------------------------------ the tools */

async function searchTool(ctx: Ctx, args: Args) {
  const query = text(args, 'query', { max: MAX_QUERY, required: true });
  const { results, fuzzy } = await search(ctx, query);
  return {
    results,
    ...(fuzzy ? { note: 'Точно съвпадение няма: това са най-близките резултати.' } : {}),
  };
}

async function fetchTool(ctx: Ctx, args: Args) {
  const id = text(args, 'id', { max: 400, required: true });
  const [kind, ...rest] = id.split(':');
  const key = rest.join(':');
  const rid = ctx.data.releaseId;
  const c = await core(ctx);
  if (kind === 'term') {
    const glossary = await load<{ meta?: Json; terms?: Json[] }>(ctx, 'glossary');
    const t = (glossary.terms || []).find((x) => x.slug === key);
    if (!t) throw new ArgError(`Няма понятие „${key}“ в речника.`);
    const related = Array.isArray(t.related)
      ? (t.related as { slug: string }[]).map((r) => r.slug)
      : [];
    return {
      id,
      title: String(t.title),
      text: [
        t.def,
        t.example ? `Пример: ${t.example}` : '',
        Array.isArray(t.aliases) && t.aliases.length ? `Още: ${t.aliases.join(', ')}` : '',
        related.length ? `Свързани понятия: ${related.map((s) => 'term:' + s).join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      url: screenUrl(ctx, 'S03', { term: key }),
      metadata: {
        release_id: rid,
        kind: 'term',
        source: sources(c, glossary.meta?.source),
        asOf: glossary.meta?.asOf,
      },
    };
  }
  if (kind === 'dataset') {
    const set = await setOf(ctx, key);
    const format = FORMATS[set.slug] || GENERIC;
    const name = fileName(set);
    return {
      id,
      title: set.title,
      text: [
        set.description,
        [
          set.period && `Период: ${set.period}.`,
          set.asOf && `Към дата: ${set.asOf}.`,
          set.unit && `Единица: ${set.unit}.`,
          `Статус: ${set.status}.`,
        ]
          .filter(Boolean)
          .join(' '),
        set.status === 'pending' ? `${pendingNote} Очаква се: ${set.expected || '—'}.` : '',
        ...format.read,
      ]
        .filter(Boolean)
        .join('\n\n'),
      url: screenUrl(ctx, 'S24', { set: set.slug }),
      metadata: {
        release_id: rid,
        kind: 'dataset',
        status: set.status,
        asOf: set.asOf,
        unit: set.unit,
        source: sources(c, set.source),
        file_url: name ? fileUrl(ctx, name) : null,
      },
    };
  }
  if (kind === 'trap' || kind === 'method') {
    const cat = await catalog(ctx);
    const note = (kind === 'trap' ? cat.traps : cat.methodology).find((n) => n.id === key);
    if (!note) throw new ArgError(`Няма бележка „${id}“.`);
    return {
      id,
      title: note.title,
      text: note.text,
      url: screenUrl(ctx, 'S24', {}, { to: (kind === 'trap' ? 's24-t-' : 's24-m-') + key }),
      metadata: { release_id: rid, kind, related: note.related || [] },
    };
  }
  if (kind === 'page' && key.startsWith('/')) {
    const entries = await entriesOf(ctx, id);
    const route = screenOf(key) as { id: string; title: string; desc?: string } | null;
    if (!entries.length && !route) throw new ArgError(`Няма страница „${key}“.`);
    const cat = await catalog(ctx);
    const sets = route
      ? cat.datasets.filter((s) => screensOf(s).includes(route.id)).map((s) => s.slug)
      : [];
    return {
      id,
      title: route?.title || entries[0]!.title,
      text: [
        route?.desc || '',
        ...entries.map((e) => {
          const line = [e.sub, e.stage || e.period].filter(Boolean).join(' · ');
          return `• ${e.title}${e.value ? ': ' + e.value : ''}${line ? ' (' + line + ')' : ''}`;
        }),
        sets.length
          ? `Данните на страницата са в наборите: ${sets.join(', ')} (за точните числа: describe_dataset и get_data).`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      url: pageUrl(ctx, key),
      metadata: { release_id: rid, kind: 'page', screen: route?.id, datasets: sets },
    };
  }
  throw new ArgError(
    `Непознат id „${id}“. Id идва от search: term:<slug>, dataset:<slug>, trap:<id>, method:<id> или page:<адрес>.`,
  );
}

async function listDatasets(ctx: Ctx, args: Args) {
  const group = text(args, 'group', { max: 40 });
  const cat = await catalog(ctx);
  if (group && !cat.groups.some((g) => g.id === group))
    throw new ArgError(
      `Няма група „${group}“. Групите са: ${cat.groups.map((g) => g.id).join(', ')}.`,
    );
  const sets = cat.datasets.filter((s) => !group || s.group === group);
  return {
    release_id: ctx.data.releaseId,
    groups: cat.groups,
    datasets: await Promise.all(
      sets.map(async (s) => {
        const name = fileName(s);
        return {
          slug: s.slug,
          title: s.title,
          group: s.group,
          status: s.status,
          ...(s.period ? { period: s.period } : {}),
          ...(s.asOf ? { asOf: s.asOf } : {}),
          ...(s.unit ? { unit: s.unit } : {}),
          ...(s.bytes ? { bytes: s.bytes } : {}),
          ...(s.parts?.length ? { parts: s.parts.length } : {}),
          ...(s.status === 'pending' ? { reason: s.description, expected: s.expected } : {}),
          ...(s.pending?.length ? { pending: await pendingOf(ctx, s.pending) } : {}),
          page_url: screenUrl(ctx, 'S24', { set: s.slug }),
          ...(name ? { file_url: fileUrl(ctx, name) } : {}),
        };
      }),
    ),
  };
}

async function describeDataset(ctx: Ctx, args: Args) {
  const set = await setOf(ctx, text(args, 'slug', { max: 80, required: true }));
  const [cat, c] = await Promise.all([catalog(ctx), core(ctx)]);
  const related = (notes: typeof cat.traps) =>
    (notes || [])
      .filter((n) => n.related?.includes(set.slug))
      .map((n) => ({ id: n.id, title: n.title, text: n.text }));
  const base = {
    release_id: ctx.data.releaseId,
    slug: set.slug,
    title: set.title,
    description: set.description,
    status: set.status,
    sources: sources(c, set.source),
    page_url: screenUrl(ctx, 'S24', { set: set.slug }),
  };
  if (set.status === 'pending')
    return { ...base, note: pendingNote, reason: set.description, expected: set.expected };
  const format = FORMATS[set.slug] || GENERIC;
  const name = fileName(set);
  let parts: { code: string; name?: string }[] | undefined;
  if (set.parts?.length) {
    const names = new Map<string, string>();
    try {
      const m = await load<{ items?: { id: string; name: string }[] }>(ctx, 'ministries');
      for (const i of m.items || []) names.set(i.id, i.name);
    } catch (e) {
      if (!(e instanceof PendingError)) throw e;
    }
    parts = set.parts.map((p) => ({
      code: p.code,
      ...(names.has(p.code) ? { name: names.get(p.code) } : {}),
    }));
  }
  return {
    ...base,
    ...(set.period ? { period: set.period } : {}),
    ...(set.asOf ? { asOf: set.asOf } : {}),
    ...(set.unit ? { unit: set.unit } : {}),
    ...(name ? { meta: metaOf(await load(ctx, name)), file_url: fileUrl(ctx, name) } : {}),
    keys: set.schema || [],
    how_to_read: format.read,
    examples: format.examples,
    ...(parts ? { parts } : {}),
    ...(set.pending?.length ? { pending: await pendingOf(ctx, set.pending) } : {}),
    traps: related(cat.traps),
    methodology: related(cat.methodology),
  };
}

async function getData(ctx: Ctx, args: Args) {
  const set = await setOf(ctx, text(args, 'slug', { max: 80, required: true }));
  const path = text(args, 'path', { max: 400 });
  const part = text(args, 'part', { max: 20 });
  const offset = integer(args, 'offset', { min: 0, max: 1_000_000, fallback: 0 });
  const limit = integer(args, 'limit', { min: 1, max: MAX_LIMIT, fallback: DEFAULT_LIMIT });
  const c = await core(ctx);
  const head = {
    release_id: ctx.data.releaseId,
    slug: set.slug,
    page_url: screenUrl(ctx, 'S24', { set: set.slug }),
  };
  if (set.status === 'pending')
    return {
      ...head,
      status: 'pending',
      value: null,
      note: pendingNote,
      reason: set.description,
      expected: set.expected,
    };
  let name: string | null;
  if (set.parts?.length) {
    if (!part)
      throw new ArgError(
        `Наборът „${set.slug}“ е по един файл на ведомство: дай „part“ с кода, например ${set.parts[0]!.code}. Кодовете са в describe_dataset.`,
      );
    const p = set.parts.find((x) => x.code === part);
    if (!p)
      throw new ArgError(`Няма част „${part}“ в „${set.slug}“. Кодовете са в describe_dataset.`);
    name = p.file.replace(/^data\//, '').replace(/\.json$/, '');
  } else {
    if (part) throw new ArgError(`Наборът „${set.slug}“ няма части: махни „part“.`);
    name = fileName(set);
  }
  if (!name)
    throw new ArgError(
      `Наборът „${set.slug}“ не е JSON файл, а ${set.mediaType || 'друг формат'}.`,
    );
  let file: unknown;
  try {
    file = await load(ctx, name);
  } catch (e) {
    if (e instanceof PendingError)
      return { ...head, status: 'pending', value: null, note: pendingNote };
    throw e;
  }
  const meta = metaOf(file);
  const value = resolve(file, path);
  // a period of byPeriod (outlook, revenue, expenditure) has its own publication: its numbers come from sourceRefs, not from the file's meta
  const periodKey = /^\/byPeriod\/([^/]+)/.exec(path)?.[1]?.replace(/~1/g, '/').replace(/~0/g, '~');
  const period = periodKey
    ? ((file as { byPeriod?: Record<string, Json> }).byPeriod?.[periodKey] ?? null)
    : null;
  const cited = period?.sourceRefs ?? meta.source;
  return fit(value, offset, limit, (p) => ({
    ...head,
    ...(part ? { part } : {}),
    path: path || '/',
    meta,
    ...(period
      ? {
          period: {
            key: period.periodKey ?? periodKey,
            year: period.year,
            status: period.status,
            publication: period.publication,
          },
        }
      : {}),
    sources: sources(c, cited),
    file_url: fileUrl(ctx, name!),
    value: p.value,
    ...(p.page ? { page: p.page } : {}),
  }));
}

const BUDGET_RECORD = /^budget2027\/([0-9a-f]{24})$/;
const EXECUTION_RECORD = /^(data|monthly)\/(\d{4})-(\d{2})\/(kfp|nat|eu)\/([a-z.]+)$/;
const recordHelp =
  'Записът е `budget2027/<номер>` (полето `provenance` на клетка) или `<data|monthly>/<ГГГГ-ММ>/<kfp|nat|eu>/<ред>`, например data/2026-09/kfp/rev.';

type ManifestInput = { path: string; sha256: string; url?: string; page?: string; source?: string };
/** the inputs of the release's manifest by SHA-256: an original is verified when the release lists it with the same hash */
async function inputsOf(ctx: Ctx): Promise<Map<string, ManifestInput>> {
  try {
    const m = await load<{ inputs?: ManifestInput[] }>(ctx, 'release/manifest');
    return new Map((m.inputs || []).map((i) => [i.sha256, i]));
  } catch (e) {
    if (e instanceof PendingError) return new Map();
    throw e;
  }
}
/** where an original comes from: its path in the release and the official address (the site does not serve the originals) */
const sourceOf = (i: ManifestInput | undefined) =>
  i
    ? { path: i.path, ...(i.url ? { url: i.url } : {}), ...(i.page ? { page: i.page } : {}) }
    : null;

/** the provenance of a number from the provenance files of the release packaged with the site, each original checked against its manifest */
async function explainNumber(ctx: Ctx, args: Args) {
  const record = text(args, 'record', { max: 120, required: true });
  if (!BUDGET_RECORD.test(record) && !EXECUTION_RECORD.test(record)) throw new ArgError(recordHelp);
  const rid = ctx.data.releaseId;
  const inputs = await inputsOf(ctx);
  const b = BUDGET_RECORD.exec(record);
  if (b) {
    const p = await load<{ documents?: Record<string, Json>; entries?: Record<string, Json> }>(
      ctx,
      'budget2027-provenance',
    );
    const entry = p.entries?.[b[1]!];
    if (!entry) throw new ArgError('Няма такъв запис в произхода на законопроекта.');
    const [file, pointer] = String(entry.output || '').split('#');
    let cell: unknown;
    try {
      cell = resolve(await load(ctx, String(file).replace(/\.json$/, '')), pointer || '');
    } catch {
      cell = undefined;
    }
    const document = p.documents?.[String(entry.document)];
    const archive = inputs.get(String(document?.archiveSha256 ?? ''));
    return {
      release_id: rid,
      record,
      verified: !!archive && archive.path === document?.archive,
      ...(cell && typeof cell === 'object' ? (cell as Json) : {}),
      ...entry,
      document,
      source: sourceOf(archive),
    };
  }
  const [, block, y, mm, col, row] = EXECUTION_RECORD.exec(record)!;
  const [p, ex] = await Promise.all([
    load<{
      sheet?: string;
      columns?: Record<string, string>;
      rows?: Record<string, number>;
      originals?: Record<string, Json>;
      rules?: Record<string, unknown>;
    }>(ctx, 'execution-provenance'),
    load<Json & { contract?: { money?: { unit?: string } } }>(ctx, 'execution'),
  ]);
  const series = (
    ex[block!] as Record<string, Record<string, Record<string, unknown[]>>> | undefined
  )?.[y!]?.[col!]?.[row!];
  const value = series?.[Number(mm) - 1];
  if (value === undefined)
    throw new ArgError('Тази стойност я няма в изпълнението на това издание.');
  if (block === 'monthly')
    return {
      release_id: rid,
      record,
      value,
      unit: ex.contract?.money?.unit,
      rule: p.rules?.monthly,
      from: [
        `data/${y}-${mm}/${col}/${row}`,
        Number(mm) > 1
          ? `data/${y}-${String(Number(mm) - 1).padStart(2, '0')}/${col}/${row}`
          : null,
      ].filter(Boolean),
    };
  const original = p.originals?.[`${y}-${mm}`];
  const input = inputs.get(String(original?.sha256 ?? ''));
  return {
    release_id: rid,
    record,
    verified: !!input,
    value,
    unit: ex.contract?.money?.unit,
    sheet: p.sheet,
    cell: p.columns?.[col!] && p.rows?.[row!] ? p.columns[col!]! + p.rows[row!] : null,
    original,
    source: sourceOf(input),
  };
}

async function aboutData(ctx: Ctx) {
  const [cat, c] = await Promise.all([catalog(ctx), core(ctx)]);
  return {
    release_id: ctx.data.releaseId,
    site: ctx.origin,
    build: c.build,
    how_to_cite:
      'Цитирай числото с набора, източника (`sources`), датата (`asOf`) и адреса (`page_url` или `file_url`). Произходът до документа и клетката дава `explain_number`.',
    statuses:
      'real: официални данни; forecast: прогноза; partial: непълни; pending: още не са публикувани (числа няма); mock: примерни, не са реални.',
    traps: cat.traps.map((n) => ({ id: n.id, title: n.title, text: n.text })),
    methodology: cat.methodology.map((n) => ({ id: n.id, title: n.title, text: n.text })),
    catalog_url: screenUrl(ctx, 'S24'),
    api_url: screenUrl(ctx, 'S25'),
  };
}

/* ------------------------------------------------------------------ the definitions */

const ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const object = (properties: Json, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});
const anything = (properties: Json, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});
const str = (description: string, extra: Json = {}) => ({ type: 'string', description, ...extra });

export const TOOLS = [
  {
    name: 'search',
    title: 'Търсене в данните',
    description:
      'Търси в СИГМА Бюджет: показатели (приходи, разходи, салдо, дълг), ведомства, програми, общини, мерки, понятия от речника, наборите от данни и бележките към тях. Връща до 10 резултата с id за `fetch` и адреса на страницата. Заявката е на български или на латиница, например „ДДС 2027“, „МОН“, „Пловдив“.',
    inputSchema: object(
      { query: str('Какво се търси, до 120 знака.', { minLength: 1, maxLength: MAX_QUERY }) },
      ['query'],
    ),
    outputSchema: anything(
      {
        results: {
          type: 'array',
          items: anything(
            { id: { type: 'string' }, title: { type: 'string' }, url: { type: 'string' } },
            ['id', 'title', 'url'],
          ),
        },
        note: { type: 'string' },
      },
      ['results'],
    ),
    annotations: { title: 'Търсене в данните', ...ANNOTATIONS },
  },
  {
    name: 'fetch',
    title: 'Отваряне на резултат',
    description:
      'Връща пълния текст на резултат от `search` по неговия id: определение на понятие, описание на набор, бележка за данните или числата на страница от сайта. Всеки отговор има адрес и източник за цитиране.',
    inputSchema: object(
      { id: str('Id от `search`, например term:byudzhet или dataset:execution.') },
      ['id'],
    ),
    outputSchema: anything(
      {
        id: { type: 'string' },
        title: { type: 'string' },
        text: { type: 'string' },
        url: { type: 'string' },
        metadata: { type: 'object' },
      },
      ['id', 'title', 'text', 'url'],
    ),
    annotations: { title: 'Отваряне на резултат', ...ANNOTATIONS },
  },
  {
    name: 'list_datasets',
    title: 'Наборите от данни',
    description:
      'Наборите в текущото издание: заглавие, статус, период, към коя дата са, мерна единица и размер. Набор със статус pending още няма данни; при него са причината и къде се очакват.',
    inputSchema: object({
      group: str('По избор: само една група (budget, execution, local, text, service, pending).'),
    }),
    outputSchema: anything({ release_id: { type: 'string' }, datasets: { type: 'array' } }, [
      'release_id',
      'datasets',
    ]),
    annotations: { title: 'Наборите от данни', ...ANNOTATIONS },
  },
  {
    name: 'describe_dataset',
    title: 'Описание на набор',
    description:
      'Как се чете един набор: описание, източници с адреси, ключовете на файла, по какво се търси ред, мерната единица, примерни пътища за `get_data` и капаните при сравнение. Полезно преди `get_data`.',
    inputSchema: object({ slug: str('Slug на набора от `list_datasets`, например execution.') }, [
      'slug',
    ]),
    outputSchema: anything({ release_id: { type: 'string' }, slug: { type: 'string' } }, [
      'release_id',
      'slug',
    ]),
    annotations: { title: 'Описание на набор', ...ANNOTATIONS },
  },
  {
    name: 'get_data',
    title: 'Част от набор',
    description:
      'Част от файла на набор по JSON Pointer (`path`, например /data/2026/kfp/rev). Масивите и големите обекти са на страници (`offset`, `limit`). Отговор над 32 KB се връща като структура, за да се поиска по-тесен път. Всеки отговор има `meta` (източник, към дата, единица) и адреса на файла. `null` е празна клетка, не нула.',
    inputSchema: object(
      {
        slug: str('Slug на набора.'),
        path: str('JSON Pointer в файла; празен е целият файл.', { maxLength: 400 }),
        part: str('Кодът на ведомство за набора ministries-programs, например 0100.'),
        offset: { type: 'integer', minimum: 0, description: 'От кой елемент започва страницата.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIMIT,
          description: `Колко елемента, по подразбиране ${DEFAULT_LIMIT}.`,
        },
      },
      ['slug'],
    ),
    outputSchema: anything(
      { release_id: { type: 'string' }, slug: { type: 'string' }, value: {} },
      ['release_id', 'slug'],
    ),
    annotations: { title: 'Част от набор', ...ANNOTATIONS },
  },
  {
    name: 'explain_number',
    title: 'Произход на число',
    description:
      'Откъде е едно число: оригиналният документ, страницата или листът, клетката, отпечатаната стойност и контролната сума. Записът е `budget2027/<номер>` (полето `provenance` на клетка от законопроекта) или `data/<ГГГГ-ММ>/<kfp|nat|eu>/<ред>` за месечното изпълнение, например data/2026-09/kfp/rev.',
    inputSchema: object({ record: str('Записът на числото.', { maxLength: 120 }) }, ['record']),
    outputSchema: anything({ release_id: { type: 'string' }, record: { type: 'string' } }, [
      'release_id',
      'record',
    ]),
    annotations: { title: 'Произход на число', ...ANNOTATIONS },
  },
  {
    name: 'about_data',
    title: 'За данните',
    description:
      'Текущото издание на данните, последният месечен отчет, курсът на еврото, как се цитира, какво значат статусите, капаните при сравнение и методиката.',
    inputSchema: object({}),
    outputSchema: anything({ release_id: { type: 'string' } }, ['release_id']),
    annotations: { title: 'За данните', ...ANNOTATIONS },
  },
] as const;

const HANDLERS: Record<string, (ctx: Ctx, args: Args) => Promise<Json>> = {
  search: searchTool,
  fetch: fetchTool,
  list_datasets: listDatasets,
  describe_dataset: describeDataset,
  get_data: getData,
  explain_number: explainNumber,
  about_data: aboutData,
};
export const TOOL_NAMES = new Set(Object.keys(HANDLERS));

export interface ToolResult {
  content: { type: 'text'; text: string }[];
  structuredContent?: Json;
  isError?: boolean;
}
const failure = (message: string): ToolResult => ({
  content: [{ type: 'text', text: message }],
  isError: true,
});

/** a tool call: the answer as structured content and as the same JSON in a text block; a mistake in the arguments is an error result the
 *  model can read and correct, a failure to read the release says so. Nothing of the arguments reaches the log. */
export async function call(ctx: Ctx, name: string, args: Args): Promise<ToolResult> {
  try {
    const out = await HANDLERS[name]!(ctx, args);
    return { content: [{ type: 'text', text: JSON.stringify(out) }], structuredContent: out };
  } catch (e) {
    if (e instanceof ArgError) return failure(e.message);
    if (e instanceof PendingError) return failure('Този файл не е в текущото издание.');
    console.error('mcp_tool_failed', name, e instanceof Error ? e.name : typeof e);
    return failure('Данните не могат да бъдат прочетени в момента. Опитай отново след малко.');
  }
}
