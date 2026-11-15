import { isPublishedDataset } from '@sigma-budget/dataset-schema';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { relative, join } from 'node:path';
import { Check, fmt, gzipSize, isnum, pattern, pyRepr as repr, walk } from './checks.js';
import { Context, files, safePath } from './context.js';

const SOURCE_KEYS = [
  'budget2027',
  'kfp',
  'asbp',
  'bill',
  'zdb',
  'zbdoo',
  'zbnzok',
  'prb',
  'parliament',
  'eurostat',
  'bnb',
  'nap',
  'sebra',
  'gisco',
  'dataeuropa',
  'minfin',
  'wg',
  'ec-oil',
  'excise-law',
  'customs-excise-law',
  'nsi-pack',
];
const STATUS = ['real', 'mock', 'pending'];
const PERIODS: Record<string, string> = {
  '2026.law': 'law',
  '2026.expected': 'expected',
  '2027.draft': 'draft',
  '2028.forecast': 'forecast',
  '2029.forecast': 'forecast',
};
const truth = (v: any): boolean =>
  !!v &&
  (!Array.isArray(v) || v.length > 0) &&
  (typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length > 0);
const dict = (v: unknown): v is Record<string, any> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

export function inputs(ctx: Context): Check {
  const c = new Check('INPUTS'),
    expected: Record<string, string> = Object.create(null),
    actual: Record<string, string> = Object.create(null);
  for (const line of readFileSync(safePath(ctx.root, 'data/originals.sha256'), 'utf8').split(
    '\n',
  )) {
    if (!line.trim()) continue;
    const m = /^([0-9a-f]{64})\s+(\S.*)$/.exec(line);
    if (!c.ok(m, `originals.sha256: unparsable line ${repr(line.slice(0, 60))}`)) continue;
    c.ok(!(m![2]! in expected), `originals.sha256: duplicate path ${m![2]}`);
    expected[m![2]!] = m![1]!;
  }
  for (const base of ['data/originals', 'data/inputs'])
    for (const f of files(ctx.root, base)) {
      const rel = `${base}/${f}`;
      actual[rel] = createHash('sha256')
        .update(readFileSync(safePath(ctx.root, rel)))
        .digest('hex');
    }
  const absent = Object.keys(expected)
    .filter((p) => !(p in actual) && p.startsWith('data/originals/'))
    .sort();
  const missing = Object.keys(expected)
    .filter((p) => !(p in actual) && !p.startsWith('data/originals/'))
    .sort();
  const extra = Object.keys(actual)
    .filter((p) => !(p in expected))
    .sort();
  if (absent.length)
    c.warn(
      `${absent.length} raw files of the manifest are not in the repository (data/originals, see docs/data-sources.md); the files that are present are compared`,
    );
  c.ok(!missing.length, `pinned input files missing: ${missing.slice(0, 5).join(', ')}`);
  c.ok(
    !extra.length,
    `Input directories have files not in the manifest: ${extra.slice(0, 5).join(', ')}`,
  );
  const changed = Object.keys(expected)
    .filter(
      (p) =>
        p in actual &&
        (ctx.generatedInputs.find((i) => i.path === p)?.sha256 ?? expected[p]) !== actual[p],
    )
    .sort();
  c.ok(!changed.length, `pinned input files changed: ${changed.slice(0, 5).join(', ')}`);
  if (ctx.generatedInputs.length) {
    for (const f of ctx.generatedInputs) {
      const bytes = readFileSync(safePath(ctx.root, f.path));
      c.ok(
        bytes.length === f.bytes && createHash('sha256').update(bytes).digest('hex') === f.sha256,
        'generated intermediate hash: ' + f.path,
      );
    }
    c.warn(
      `${ctx.generatedInputs.length} declared intermediates generated from actual raw sources in owned scratch; historical raw reconstruction remains unverified`,
    );
  }
  c.fact(
    ctx.generatedInputs.length
      ? `${Object.keys(expected).length} pinned declarations; generated intermediates are separately authenticated`
      : `${Object.keys(expected).length} files${missing.length || extra.length || changed.length ? '' : ', all sha256 equal'}`,
  );
  return c;
}

export function envelope(ctx: Context): Check {
  const c = new Check('ENVELOPE'),
    core = ctx.get('core.json'),
    srcs = new Set<string>(Object.keys(core.sources)),
    pend = new Set<string>(Object.keys(core.pending));
  const diff = [...new Set([...srcs, ...SOURCE_KEYS])]
    .filter((x) => srcs.has(x) !== SOURCE_KEYS.includes(x))
    .sort();
  c.ok(!diff.length, `core.sources keys differ from the registry: ${repr(diff)}`);
  const counts: Record<string, number> = { real: 0, mock: 0 };
  for (const f of ctx.jsonFiles()) {
    const d = ctx.get(f),
      m = dict(d) ? d.meta : null;
    if (!c.ok(dict(m), `${f}: no meta envelope`)) continue;
    for (const k of ['id', 'title', 'status', 'source', 'asOf', 'retrieved'])
      c.ok(
        m[k] !== null &&
          m[k] !== undefined &&
          m[k] !== '' &&
          !(Array.isArray(m[k]) && !m[k].length),
        `${f}: meta.${k} missing or empty`,
      );
    c.ok(STATUS.includes(m.status), `${f}: meta.status ${repr(m.status)}`);
    c.ok(m.mock === (m.status === 'mock'), `${f}: meta.mock must equal (status == 'mock')`);
    if (typeof m.status === 'string' && Object.hasOwn(counts, m.status)) counts[m.status]!++;
    for (const s of m.source || [])
      c.ok(srcs.has(s), `${f}: meta.source ${repr(s)} is not in core.sources`);
    for (const k of ['asOf', 'retrieved']) {
      const v = m[k];
      c.ok(
        typeof v === 'string' &&
          /^\p{Decimal_Number}{4}-\p{Decimal_Number}{2}-\p{Decimal_Number}{2}/u.test(v) &&
          v <= ctx.buildDate,
        `${f}: meta.${k} ${repr(v)} not an ISO date <= ${ctx.buildDate}`,
      );
    }
    for (const p of m.pending || [])
      c.ok(pend.has(p), `${f}: meta.pending ${repr(p)} is not in core.pending`);
    if (!f.startsWith('mock/'))
      for (const [p, v] of walk(d)) {
        if (p === '$.meta' || !dict(v) || !('status' in v)) continue;
        if (p.startsWith('$.byPeriod.')) {
          const bits = p.split('.');
          const key = `${bits[2]}.${bits[3]}`;
          c.ok(key in PERIODS && v.status === PERIODS[key], `${f} ${p}: period status`);
          continue;
        }
        c.ok(STATUS.includes(v.status), `${f} ${p}: status ${repr(v.status)}`);
        if (v.status === 'pending') {
          const nums = [...walk(v)].filter(([q, x]) => isnum(x) && !q.endsWith('.month'));
          c.ok(
            !nums.length,
            `${f} ${p}: a pending block carries numbers [${nums
              .slice(0, 2)
              .map(([q, x]) => `(${repr(q)}, ${repr(x)})`)
              .join(', ')}]`,
          );
        }
        if (Array.isArray(v.source))
          for (const s of v.source)
            c.ok(srcs.has(s), `${f} ${p}: source ${repr(s)} not in core.sources`);
      }
  }
  for (const [pid, b] of Object.entries(core.pending) as [string, any][]) {
    c.ok(b.status === 'pending' && b.id === pid, `core.pending.${pid}: bad status or id`);
    for (const k of ['title', 'reason', 'expected', 'source', 'screens'])
      c.ok(truth(b[k]), `core.pending.${pid}: ${k} missing`);
  }
  c.fact(`${ctx.jsonFiles().length} json files (${counts.real} real, ${counts.mock} mock)`);
  return c;
}

const NULL_OK: [string, RegExp][] = [
  ['catalog.json', /^\$\.datasets\[\]\.file$/],
  ['law.json', /^\$\.bills\[\]\.inForce\.exceptions\[\]\.from$/],
  ['law.json', /^\$\.budgets\[\]\.(bill|law|diff)\.(rev|transfers)$/],
  ['law.json', /^\$\.changes\[\]\.headline\.(balance|financing)\.(bill|diff)$/],
  ['law.json', /^\$\.changes\[\]\.lines\[\]\.(bill|diff)$/],
  ['rates.json', /^\$\.minInsurableIncome\.rows\[\]\.(from|until)\[\]$/],
];
const EMPTY_OK: [string, RegExp][] = [
  ['debt.json', /^\$\.quarterly\.eurostat\.flags\[\]$/],
  ['law.json', /^\$\.art1\.lines\[\]\.no$/],
  ['programs.json', /^\$\.items\[\]\[\]$/],
  ['rates.json', /^\$\.assumptions\[\](\.sub\[\])?\.unit$/],
  ['rates.json', /^\$\.minInsurableIncome\.rows\[\]\.code$/],
  ['search-index.json', /^\$\.items\[\]\[\]$/],
];
const NUMSTR_OK: [RegExp, RegExp][] = [
  [/.*/, /\.(id|code|no|n|eik|ministry|nap|period|name)$/],
  [/.*/, /\.(ministries|changedCodes)\[\]$/],
  [/^rates\.json$/, /^\$\.assumptions\[\](\.sub\[\])?\.years\.\d{4}$/],
  [/^(programs|search-index)\.json$/, /^\$\.items\[\]\[\]$/],
];
export function numeric(ctx: Context): Check {
  const c = new Check('NUMBERS');
  let nulls = 0,
    empties = 0,
    numstr = 0,
    noise = 0;
  for (const f of ctx.jsonFiles()) {
    const doc = ctx.get(f);
    const programmeContract =
      /^ministries\/(0100|1800|2300|7400)\.json$/.test(f) && isPublishedDataset(f, doc);
    const budgetContract =
      ['state-budget.json', 'kfp-subsectors.json'].includes(f) && isPublishedDataset(f, doc);
    const bad: Record<string, string[]> = {};
    const add = (k: string, p: string) => {
      (bad[k] ??= []).push(p);
    };
    for (const [p, v] of walk(ctx.get(f))) {
      const pat = pattern(p);
      if (v === null) {
        nulls++;
        if (
          !NULL_OK.some(([file, re]) => file === f && re.test(pat)) &&
          !(
            programmeContract &&
            (/^\$\.sourceAudit\.rows\[\]\.values\[\]$/.test(pat) ||
              /^\$\.(total|policies).*\.2026\[\]$/.test(pat))
          ) &&
          !(budgetContract && /^\$\.tables\[\]\.rows\[\]\.(source|eur)\[\]$/.test(pat))
        )
          add('null', p);
      } else if (v === '') {
        empties++;
        if (!EMPTY_OK.some(([file, re]) => file === f && re.test(pat))) add('empty string', p);
      } else if (
        typeof v === 'string' &&
        /^-?\p{Decimal_Number}+([.,]\p{Decimal_Number}+)?$/u.test(v)
      ) {
        numstr++;
        const printed =
          (f === 'budget2027-provenance.json' ||
            (f === 'execution-provenance.json' && p.startsWith('$.plan2026.kfp.rows.'))) &&
          p.endsWith('.printed');
        if (!printed && !NUMSTR_OK.some(([file, re]) => file.test(f) && re.test(pat)))
          add('number as string', p);
      } else if (isnum(v) && !Number.isInteger(v)) {
        const s = String(v),
          abs = Math.abs(v);
        if (abs >= 0.0001 && !s.includes('e') && (s.split('.')[1]?.length ?? 0) > 8) noise++;
      }
    }
    c.n++;
    for (const [kind, paths] of Object.entries(bad))
      c.fail(
        `${f}: ${paths.length} unexpected ${kind}, e.g. ${[...new Set(paths.map(pattern))].sort().slice(0, 3).join(', ')}`,
      );
  }
  c.ok(noise === 0, `${noise} floats with more than 8 decimals (binary noise)`);
  c.fact(
    `${nulls} documented nulls, ${empties} empty strings, ${numstr} code-like numeric strings`,
  );
  return c;
}

const kb = (n: number) =>
  `${fmt(n / 1024, 1)
    .replaceAll(' ', '')
    .replace(',', '.')} KB`;
function sizeLimit(f: string): number {
  return f === 'budget2027.json'
    ? 800
    : f === 'budget2027-provenance.json'
      ? 3000
      : f === 'core.json'
        ? 40
        : f === 'search-index.json'
          ? 250
          : f === 'geo/obshtini.json'
            ? 400
            : /^ministries\/\p{Decimal_Number}{4}\.json$/u.test(f)
              ? 80
              : 150;
}
export function sizes(ctx: Context): Check {
  const c = new Check('SIZES');
  let total = 0,
    worst = 0,
    description = '';
  for (const f of ctx.dataFiles()) {
    const n = ctx.bytes(f).length,
      lim = sizeLimit(f),
      ratio = n / (lim * 1024),
      desc = `${f} ${kb(n)} of ${lim} KB`;
    total += n;
    c.ok(n <= lim * 1024, `${f}: ${kb(n)} raw exceeds the ${lim} KB budget`);
    if (lim * 1000 < n && n <= lim * 1024)
      c.warn(`${f}: ${kb(n)} raw is within 2.4% of its ${lim} KB budget`);
    if (ratio > worst || (ratio === worst && desc > description)) {
      worst = ratio;
      description = desc;
    }
  }
  for (const [f, lim] of [
    ['core.json', 10],
    ['glossary.json', 60],
  ] as const) {
    const gz = gzipSize(ctx.bytes(f));
    c.ok(gz <= lim * 1024, `${f}: ${kb(gz)} gzip exceeds the ${lim} KB budget`);
    c.fact(`${f} ${kb(gz)} gz`);
  }
  c.fact(`${ctx.dataFiles().length} files, ${kb(total)} raw in total, tightest: ${description}`);
  return c;
}

const FORBIDDEN = [
  'private channel',
  'частен канал',
  '.secrets',
  'gdoc.txt',
  'lovable',
  'artifact-files',
  '/workspaces',
  'anthropic',
  'claude',
];
export function privacy(ctx: Context): Check {
  const c = new Check('PRIVACY');
  let scanned = 0;
  for (const f of ctx.dataFiles()) {
    const t = ctx.text(f),
      low = t.toLowerCase();
    scanned++;
    for (const w of FORBIDDEN) c.ok(!low.includes(w), `${f}: contains ${repr(w)}`);
    const m = /(?<![\p{L}\p{N}_.])\p{Decimal_Number}{17,20}(?![\p{L}\p{N}_.])/u.exec(t);
    c.ok(!m, `${f}: a 17-20 digit number (message id?) ${m?.[0] ?? ''}`);
  }
  for (const fl of ctx.get('catalog.json').files || [])
    for (const k of ['url', 'page']) {
      const u = fl[k] || '';
      c.ok(
        !u || u.toLowerCase().startsWith('https://'),
        `catalog.files[] ${k} ${repr(u.slice(0, 80))}`,
      );
    }
  const hits: string[] = [];
  for (const base of ['apps/web/public', 'apps/web/client'])
    for (const f of files(ctx.root, base)) {
      if (/\.(png|woff|woff2|ico|jpg|webp|gz)$/.test(f)) continue;
      try {
        const t = new TextDecoder('utf-8', { fatal: true })
          .decode(readFileSync(safePath(ctx.root, `${base}/${f}`)))
          .toLowerCase();
        if (t.includes('private channel') || t.includes('частен канал'))
          hits.push(
            relative(join(ctx.root, 'apps/web/public'), join(ctx.root, base, f)).replaceAll(
              '\\',
              '/',
            ),
          );
      } catch (e) {
        if (!(e instanceof TypeError)) throw e;
      }
    }
  if (hits.length)
    c.warn(`web assets outside data mentions a private channel: ${hits.slice(0, 5).join(', ')}`);
  c.fact(`${scanned} files scanned, 0 forbidden words`);
  return c;
}
export function glossary(ctx: Context): Check {
  const c = new Check('GLOSSARY'),
    g = ctx.get('glossary.json'),
    terms = g.terms,
    slugs = terms.map((t: any) => t.slug),
    have = new Set(slugs),
    cats = new Set(g.categories.map((x: any) => (dict(x) ? x.id : x)));
  c.ok(slugs.length === have.size, 'duplicate glossary slugs');
  c.ok(terms.length === 64, `glossary has ${terms.length} terms (the plan says 64)`);
  c.ok(
    terms.length === ctx.get('core.json').counts.terms,
    'core.counts.terms differs from glossary.json',
  );
  const routes = ctx.routes();
  for (const t of terms) {
    c.ok(truth(t.def), `term ${t.slug} has no definition`);
    c.ok(cats.has(t.cat), `term ${t.slug}: category ${repr(t.cat)} unknown`);
    for (const r of t.related || [])
      c.ok(have.has(r.slug), `term ${t.slug}: related slug ${repr(r.slug)} does not exist`);
    for (const r of t.see || [])
      c.ok(
        routes.match(r.href || '') !== null,
        `term ${t.slug}: see.href ${repr(r.href)} matches no route`,
      );
  }
  for (const r of g.relations || [])
    for (const slug of r.terms || [])
      c.ok(have.has(slug), `relations: slug ${repr(slug)} does not exist`);
  let used = 0;
  for (const [f, rows] of [
    ['revenue.json', ctx.get('revenue.json').groups],
    ['expenditure.json', ctx.get('expenditure.json').functions.items],
  ] as [string, any[]][])
    for (const row of rows)
      if (row.glossary) {
        used++;
        c.ok(
          have.has(row.glossary),
          `${f}: glossary slug ${repr(row.glossary)} (${row.id}) does not exist`,
        );
      }
  c.fact(`${terms.length} terms in ${cats.size} categories, ${used} slug references resolve`);
  return c;
}
