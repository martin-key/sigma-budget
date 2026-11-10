import { Check, isnum, pyRepr as repr, pyTruth } from './checks.js';
import { amounts, cleanText, eurIn, moneyIn } from './feed-text.js';
import { denominator, MONTHS } from './feed-events.js';
import {
  contains,
  equal as same,
  feedOwner,
  greaterZero,
  hashable,
  iterable,
  length,
  listLike,
  mapping,
  monthId,
  near,
  numeric,
  pyError,
  required,
  sourceToken,
  typeName,
} from './feed-python.js';
import type { Context } from './context.js';

const sourceOrder = [
  'kfp',
  'budget2027',
  'parliament',
  'zdb',
  'zbdoo',
  'zbnzok',
  'nap',
  'eurostat',
  'sebra',
];
const kindOrder = ['report', 'law', 'plenary', 'rates', 'eurostat', 'data'];
const sortedKeys = (x: object) => Object.keys(x).sort();
const idMonth = monthId;
export function feedRest(c: Check, f: any, ctx: Context): void {
  const core = feedOwner(ctx, 'core.json'),
    ex = ctx.get('execution.json'),
    law = ctx.get('law.json'),
    basis = denominator(ex),
    rows = f.events,
    m = f.meta;
  c.ok(
    same(
      sortedKeys(m),
      ['id', 'title', 'status', 'source', 'sourceNote', 'asOf', 'retrieved', 'mock'].sort(),
    ),
    `meta keys ${repr(sortedKeys(m))}`,
  );
  c.ok(
    m.id === 'feed' && m.status === 'real' && m.mock === false && m.retrieved === ctx.buildDate,
    'meta id / status / mock / retrieved',
  );
  for (const e of rows) iterable(e.source === undefined ? [] : e.source);
  const used = new Set<string>(
    rows.flatMap((e: any) =>
      listLike(e.source === undefined ? [] : e.source).map((s: any) => {
        hashable(s);
        return s;
      }),
    ),
  );
  c.ok(
    same(
      m.source,
      sourceOrder.filter((s) => used.has(s)),
    ) && [...used].every((s) => sourceOrder.includes(s)),
    `meta.source ${repr(m.source)} vs the sources of the events ${repr([...used].sort())}`,
  );
  cleanText(c, 'meta.title', m.title);
  cleanText(c, 'meta.sourceNote', m.sourceNote, true);
  const kinds = listLike(required(f, 'kinds')),
    ids = kinds.map((x: any) => required(x, 'id')),
    eventKinds = new Set(
      rows.map((e: any) => {
        const k = required(e, 'kind');
        hashable(k);
        return k;
      }),
    );
  c.ok(
    kinds.every((x: any) => same(sortedKeys(x), ['id', 'label'])) &&
      new Set(ids).size === kinds.length,
    'kinds: shape',
  );
  c.ok(
    same([...new Set(ids)].sort(), [...eventKinds].sort()),
    `kinds ${repr(ids)} must be exactly the kinds used by the events`,
  );
  c.ok(
    same(
      ids,
      kindOrder.filter((i) => ids.includes(i)),
    ),
    'kinds are in the fixed order',
  );
  for (const x of kinds) cleanText(c, `kind ${x.id} label`, x.label);
  const dk = required(f, 'dateKinds');
  c.ok(
    same(sortedKeys(dk), ['occurred', 'asOf', 'published', 'effective'].sort()) &&
      rows.every((e: any) => contains(dk, required(e, 'dateKind'))),
    `dateKinds ${repr(sortedKeys(dk))}`,
  );
  if (Array.isArray(dk)) pyError('AttributeError', "'list' object has no attribute 'items'");
  for (const [key, label] of Object.entries(dk)) cleanText(c, `dateKind ${key}`, label);
  const lat = ex.latest,
    kf = lat.kfp,
    h = required(f, 'highlights');
  iterable(h);
  mapping(h);
  const want: Record<string, any> = {
    month: lat.month,
    asOf: lat.asOf,
    revenueMln: kf.rev.cum,
    revenueYoyPct: kf.rev.yoyPct,
    expenditureMln: kf['exp.total'].cum,
    expenditureYoyPct: kf['exp.total'].yoyPct,
    deficitMln: -kf.balance.cum,
    deficitPrevYearMln: -kf.balance.prevYearCum,
    capexPctPlan: kf['exp.capex'].pctPlan,
    planBasis: basis,
    newBorrowingMln: kf['fin.ext.markets'].cum,
    newBorrowingPrevYearMln: kf['fin.ext.markets'].prevYearCum,
  };
  c.ok(same(sortedKeys(h), sortedKeys(want)), `highlights keys ${repr(sortedKeys(h))}`);
  for (const [key, v] of Object.entries(want)) {
    if (isnum(v))
      near(
        c,
        h[key],
        v,
        1e-9,
        `highlights.${key} must equal the latest report of execution.json`,
        /[.eE]/.test(sourceToken(ctx.text('feed.json'), ['highlights', key]) ?? ''),
        key !== 'month',
      );
    else
      c.ok(
        same(h[key] ?? null, v),
        `highlights.${key} is ${repr(h[key] ?? null)}, execution.json says ${repr(v)}`,
      );
  }
  const kp = core.kpis;
  near(
    c,
    h.revenueMln,
    kp.revenue.execMln,
    1e-9,
    'highlights.revenueMln vs core.kpis.revenue.execMln',
  );
  near(
    c,
    h.expenditureMln,
    kp.expenditure.execMln,
    1e-9,
    'highlights.expenditureMln vs core.kpis.expenditure.execMln',
  );
  near(
    c,
    -numeric(h.deficitMln === undefined ? 0 : h.deficitMln, 'unary -'),
    kp.balance.execMln,
    1e-9,
    'highlights.deficitMln vs core.kpis.balance.execMln',
  );
  c.ok(
    greaterZero(required(h, 'deficitMln')) && greaterZero(required(h, 'deficitPrevYearMln')),
    "highlights: a deficit is stored as a positive number (the sentence says 'Дефицитът е')",
  );
  const last = rows.filter((e: any) => e.id === idMonth(lat.month));
  c.ok(
    last.length === 1 && last[0].date === lat.asOf,
    'the newest report event must be the latest month of execution.json',
  );
  const s = required(f, 'sentences');
  c.ok(
    Array.isArray(s) && s.length === 5,
    `sentences: expected 5, found ${repr(Array.isArray(s) ? s.length : s)}`,
  );
  if (Array.isArray(s) && s.length === 5) {
    for (const [i, t] of s.entries()) cleanText(c, `sentence ${i}`, t, true);
    amounts(
      c,
      'sentence 0',
      s[0],
      [required(h, 'revenueMln')],
      [],
      [Math.abs(numeric(required(h, 'revenueYoyPct'), 'abs()'))],
      [
        false,
        false,
        typeof h.revenueYoyPct === 'number' &&
          /[.eE]/.test(sourceToken(ctx.text('feed.json'), ['highlights', 'revenueYoyPct']) ?? ''),
      ],
    );
    amounts(
      c,
      'sentence 1',
      s[1],
      [required(h, 'expenditureMln')],
      [],
      [Math.abs(numeric(required(h, 'expenditureYoyPct'), 'abs()'))],
      [
        false,
        false,
        typeof h.expenditureYoyPct === 'number' &&
          /[.eE]/.test(
            sourceToken(ctx.text('feed.json'), ['highlights', 'expenditureYoyPct']) ?? '',
          ),
      ],
    );
    amounts(c, 'sentence 2', s[2], [required(h, 'deficitMln'), required(h, 'deficitPrevYearMln')]);
    amounts(c, 'sentence 3', s[3], [], [], [required(h, 'capexPctPlan')]);
    c.ok(s[3].includes(basis.citation), 'summary percent cites the denominator');
    amounts(c, 'sentence 4', s[4], [
      required(h, 'newBorrowingMln'),
      required(h, 'newBorrowingPrevYearMln'),
    ]);
    const month = required(h, 'month');
    if (typeof month !== 'number' && typeof month !== 'boolean')
      pyError('TypeError', `unsupported operand type(s) for -: '${typeName(month)}' and 'int'`);
    const monthSource = sourceToken(ctx.text('feed.json'), ['highlights', 'month']);
    if (monthSource && /[.eE]/.test(monthSource))
      pyError('TypeError', 'tuple indices must be integers or slices, not float');
    if (typeof s[0] !== 'string')
      pyError('TypeError', `expected string or bytes-like object, got '${typeName(s[0])}'`);
    c.ok(
      s[0].includes(`към края на ${MONTHS[h.month - 1]} 2026 г.`),
      'sentence 0 must name the month of the latest report',
    );
    c.ok(
      s[0].includes(h.revenueYoyPct >= 0 ? 'повече' : 'по-малко') &&
        s[1].includes(h.expenditureYoyPct >= 0 ? 'повече' : 'по-малко'),
      'sentences 0-1: more / less than a year earlier',
    );
    c.ok(
      s[0].includes('Приходите') &&
        s[1].includes('Разходите') &&
        s[2].includes('Дефицитът') &&
        s[3].includes('Капиталовите') &&
        s[4].includes('външно финансиране'),
      'sentences are in the fixed order',
    );
  }
  const expected = required(f, 'expected'),
    pm = required(ex, 'pendingMonths');
  length(pm);
  if (expected === null || typeof expected === 'boolean' || typeof expected === 'number')
    pyError('TypeError', `object of type '${typeName(expected)}' has no len()`);
  c.ok(
    Array.isArray(expected) && expected.length === pm.length + 1,
    `expected: ${length(expected)} entries, execution.json has ${pm.length} pending months + the next budget`,
  );
  for (const [i, p] of pm.entries()) {
    const e = i < length(expected) ? required(expected, i) : {},
      pend = core.pending[p.id] === undefined ? {} : core.pending[p.id];
    mapping(pend);
    c.ok(
      e.id === p.id &&
        e.status === 'pending' &&
        e.title ===
          `Месечен отчет на КФП към края на ${MONTHS[p.month - 1]} ${p.asOf.slice(0, 4)} г.`,
      `expected[${i}]: id / status / title vs execution.pendingMonths`,
    );
    c.ok(
      same(e.note ?? null, pend.reason ?? null) && same(e.expected ?? null, pend.expected ?? null),
      `expected[${i}]: note / expected must be the text of core.pending.${p.id}`,
    );
  }
  const nx = pyTruth(expected)
    ? Array.isArray(expected)
      ? expected.at(-1)
      : required(expected, '-1')
    : {};
  c.ok(
    ['title', 'status', 'note', 'expected'].every((x) => same(nx[x] ?? null, law.next[x] ?? null)),
    'expected[-1] must be law.json next',
  );
  for (const [i, e] of listLike(expected).entries()) {
    c.ok(e.status === 'pending', `expected[${i}]: status must be pending`);
    for (const key of ['title', 'note', 'expected']) cleanText(c, `expected[${i}].${key}`, e[key]);
    c.ok(
      !moneyIn(e.note ?? '').length && !eurIn(e.note ?? '').length,
      `expected[${i}]: a pending note must carry no amount`,
    );
  }
}
