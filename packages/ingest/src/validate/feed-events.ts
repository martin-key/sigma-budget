import { Check, pyRepr as repr, pyTruth } from './checks.js';
import { amounts, cleanText, pythonDigitPattern } from './feed-text.js';
import {
  contains,
  equal,
  hashable,
  iterable,
  listLike,
  mapping,
  monthId,
  monthToken,
  pyError,
  required,
  sourceToken,
  typeName,
} from './feed-python.js';
import { pythonNumericText } from '../common/numbers.js';
import type { Context } from './context.js';

const MONTHS = [
  'януари',
  'февруари',
  'март',
  'април',
  'май',
  'юни',
  'юли',
  'август',
  'септември',
  'октомври',
  'ноември',
  'декември',
];
const same = equal;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const idMonth = monthId;
export function denominator(ex: any): any {
  return {
    periodKey: required(required(ex, 'plan2026'), 'periodKey'),
    basis: required(required(ex, 'plan2026'), 'basis'),
    source: required(required(ex, 'plan2026'), 'source'),
    citation: 'Програма по ЗДБРБ 2026, МФ, приложение 1',
  };
}
function validDate(s: unknown): boolean {
  if (
    typeof s !== 'string' ||
    !new RegExp(
      `^${pythonDigitPattern}{4}-${pythonDigitPattern}{2}-${pythonDigitPattern}{2}$`,
      'u',
    ).test(s)
  )
    return false;
  const [y, m, d] = s.split('-').map((x) => Number(pythonNumericText(x))) as [
    number,
    number,
    number,
  ];
  if (y < 1 || m < 1 || m > 12 || d < 1) return false;
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
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
  return d <= days[m - 1]!;
}
function event(
  c: Check,
  evs: Map<string, any>,
  eid: string,
  want: Record<string, unknown>,
  money: unknown[] = [],
  eur: unknown[] = [],
  pct: unknown[] = [],
  has: string[] = [],
  floatKinds: (boolean | boolean[])[] = [],
): void {
  const e = evs.get(eid);
  if (!c.ok(e !== undefined, `event ${eid} is missing`)) return;
  for (const [key, value] of Object.entries(want))
    c.ok(
      same(e[key] ?? null, value),
      `event ${eid}: ${key} is ${repr(e[key] ?? null)}, the dataset says ${repr(value)}`,
    );
  const text = e.text === undefined ? '' : e.text;
  amounts(c, `event ${eid} text`, text, money, eur, pct, floatKinds);
  for (const pattern of has) {
    if (typeof text !== 'string')
      pyError('TypeError', `expected string or bytes-like object, got '${typeName(text)}'`);
    c.ok(new RegExp(pattern, 'u').test(text), `event ${eid}: text lacks /${pattern}/`);
  }
}
export function feedEvents(c: Check, f: any, ctx: Context): void {
  const core = ctx.get('core.json'),
    ex = ctx.get('execution.json'),
    law = ctx.get('law.json');
  const basis = denominator(ex),
    rates = ctx.get('rates.json'),
    debt = ctx.get('debt.json'),
    exp = ctx.get('expenditure.json'),
    seb = ctx.get('sebra.json');
  const rows: any[] = listLike(required(f, 'events'));
  const kinds: any[] = listLike(required(f, 'kinds')).map((k: any) => {
      mapping(k);
      return k.id;
    }),
    ids = rows.map((e: any) => {
      mapping(e);
      return e.id;
    });
  for (const id of ids) hashable(id);
  const evs = new Map<string, any>(
    rows
      .filter((e: any) => e && typeof e === 'object' && !Array.isArray(e) && 'id' in e)
      .map((e: any) => [e.id, e]),
  );
  c.ok(
    new Set(ids).size === ids.length &&
      ids.every((x: any) => typeof x === 'string' && /^[a-z0-9][a-z0-9_.-]*$/.test(x)),
    'event ids: duplicates or odd characters',
  );
  const allowed = new Set([
    'id',
    'date',
    'dateTo',
    'dateKind',
    'kind',
    'title',
    'text',
    'href',
    'status',
    'source',
    'planBasis',
  ]);
  const requiredKeys = ['id', 'date', 'dateKind', 'kind', 'title', 'href', 'status', 'source'];
  for (const e of rows) {
    const eid = e.id,
      keys = Object.keys(e).sort();
    c.ok(
      keys.every((k) => allowed.has(k)) && requiredKeys.every((k) => Object.hasOwn(e, k)),
      `event ${eid}: keys ${repr(keys)}`,
    );
    c.ok(
      validDate(e.date ?? '') && e.date <= ctx.buildDate,
      `event ${eid}: date ${repr(e.date ?? null)} must be a real day not after the build day`,
    );
    if (Object.hasOwn(e, 'dateTo'))
      c.ok(
        validDate(e.dateTo) && e.dateTo >= e.date,
        `event ${eid}: dateTo ${repr(e.dateTo)} before date`,
      );
    c.ok(
      contains(required(f, 'dateKinds'), e.dateKind ?? null),
      `event ${eid}: dateKind ${repr(e.dateKind ?? null)}`,
    );
    c.ok(
      kinds.some((k) => same(k, e.kind)),
      `event ${eid}: kind ${repr(e.kind ?? null)} is not in kinds[]`,
    );
    c.ok(
      ['real', 'mock', 'pending'].includes(e.status),
      `event ${eid}: status ${repr(e.status ?? null)}`,
    );
    c.ok(
      Array.isArray(e.source) &&
        e.source.length > 0 &&
        e.source.every((s: string) => contains(required(core, 'sources'), s)),
      `event ${eid}: source ${repr(e.source ?? null)}`,
    );
    const href = e.href === undefined ? '' : e.href;
    c.ok(
      typeof href === 'string' && href.startsWith('#/') && ctx.routes().match(href) !== null,
      `event ${eid}: href ${repr(href)} does not open a screen`,
    );
    cleanText(c, `event ${eid} title`, e.title);
    if (Object.hasOwn(e, 'text')) cleanText(c, `event ${eid} text`, e.text, true);
  }
  const dates = rows.map((e) => (e.date === undefined ? '' : e.date));
  const nonString = dates.find((x) => typeof x !== 'string');
  if (nonString !== undefined && dates.some((x) => typeof x === 'string'))
    pyError(
      'TypeError',
      `'<' not supported between instances of '${typeName(nonString)}' and 'str'`,
    );
  c.ok(same(dates, [...dates].sort().reverse()), 'events must be newest first');
  const d26 = required(required(ex, 'data'), '2026'),
    d25 = required(required(ex, 'data'), '2025'),
    months = required(d26, 'months');
  if (months === null || typeof months === 'object')
    pyError(
      'TypeError',
      `int() argument must be a string, a bytes-like object or a real number, not '${typeName(months)}'`,
    );
  let parsed: number;
  if (typeof months === 'string') {
    const stripped = months.replace(
      /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu,
      '',
    );
    const integer = new RegExp(`^[+-]?${pythonDigitPattern}(?:_?${pythonDigitPattern})*$`, 'u');
    if (!integer.test(stripped))
      pyError('ValueError', `invalid literal for int() with base 10: ${repr(months)}`);
    parsed = Number(pythonNumericText(stripped).replaceAll('_', ''));
  } else parsed = Number(months);
  if (!Number.isFinite(parsed))
    pyError('OverflowError', 'cannot convert float infinity to integer');
  const nRep = Math.trunc(parsed);
  c.ok(rows.length === 18 + nRep, `expected ${18 + nRep} events, found ${rows.length}`);
  mapping(required(f, 'meta'));
  c.ok(
    f.meta.asOf === (dates.length ? dates[0] : null),
    'meta.asOf must be the date of the newest event',
  );
  const raw = monthToken(ctx.text('execution.json'));
  if (typeof months === 'number' && (raw?.includes('.') || /[eE]/.test(raw ?? '')))
    pyError('TypeError', "object of type 'float' has no len()");
  const n =
      typeof months === 'number'
        ? months
        : typeof months === 'boolean'
          ? Number(months)
          : months.length,
    lat = required(ex, 'latest');
  c.ok(
    same(n, lat.month) && d26.asOf[n - 1] === lat.asOf,
    'execution.json: months / latest.month / latest.asOf disagree',
  );
  c.ok(
    same(
      [...evs.keys()]
        .filter((x) => {
          if (typeof x !== 'string')
            pyError('AttributeError', `'${typeName(x)}' object has no attribute 'startswith'`);
          return x.startsWith('kfp-');
        })
        .sort(),
      Array.from({ length: n }, (_, i) => idMonth(i + 1)),
    ),
    'report events must be one per month of 2026',
  );
  for (let m = 1; m <= n; m++) {
    const rev = d26.kfp.rev[m - 1],
      expd = d26.kfp['exp.total'][m - 1],
      bal = d26.kfp.balance[m - 1],
      prev = d25.kfp.rev[m - 1];
    if (typeof rev !== 'number' || typeof prev !== 'number')
      pyError(
        'TypeError',
        `unsupported operand type(s) for /: '${typeName(rev)}' and '${typeName(prev)}'`,
      );
    if (prev === 0) pyError('ZeroDivisionError', 'float division by zero');
    const yoy = 100 * (rev / prev - 1);
    if (m === n && !Array.isArray(basis.source))
      pyError('TypeError', `can only concatenate list (not "${typeName(basis.source)}") to list`);
    event(
      c,
      evs,
      idMonth(m),
      {
        date: d26.asOf[m - 1],
        dateKind: 'asOf',
        kind: 'report',
        href: `#/izpalnenie?mesec=${m}`,
        status: 'real',
        source: ['kfp', ...(m === n ? basis.source : [])],
        title: `Месечен отчет на КФП към края на ${MONTHS[m - 1]} 2026 г.`,
      },
      [rev, expd, Math.abs(bal)],
      [],
      [Math.abs(yoy), ...(m === n ? [lat.kfp.rev.pctPlan] : [])],
      [bal < 0 ? 'дефицитът' : 'излишъкът', yoy >= 0 ? 'повече' : 'по-малко'],
      [
        true,
        false,
        [
          true,
          /[.eE]/.test(
            sourceToken(ctx.text('execution.json'), ['latest', 'kfp', 'rev', 'pctPlan']) ?? '',
          ),
        ],
      ],
    );
  }
  for (const e of rows)
    c.ok(
      Object.hasOwn(e, 'planBasis') === (required(e, 'id') === idMonth(n)),
      'denominator metadata only on the event with a plan percent',
    );
  const latest = evs.get(idMonth(n));
  if (latest === undefined) pyError('KeyError', repr(idMonth(n)));
  c.ok(same(latest.planBasis ?? null, basis), 'latest report denominator provenance');
  c.ok(latest.text.includes(basis.citation), 'latest report percent cites the denominator');
  const par = listLike(required(law, 'timeline')).filter((t: any) => {
    mapping(t);
    return t.phase === 'parliament';
  });
  c.ok(par.length === 11, `law.json timeline: ${par.length} parliament steps, expected 11`);
  const seen = new Map<string, number>(),
    wantIds: string[] = [];
  for (const t of par) {
    const base = `law-${t.date}-${t.kind}`,
      count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    const eid = count === 1 ? base : `${base}-${count}`;
    wantIds.push(eid);
    const want: Record<string, unknown> = {
      date: t.date,
      dateKind: 'occurred',
      kind: ['plenary-1', 'plenary-2', 'adopted'].includes(t.kind) ? 'plenary' : 'law',
      title: t.title,
      href: '#/zakon',
      status: 'real',
      source: pyTruth(t.source) ? t.source : ['parliament'],
    };
    if (pyTruth(t.dateTo)) want.dateTo = t.dateTo;
    event(c, evs, eid, want);
    const e = evs.get(eid) ?? {};
    c.ok(
      same(e.text ?? null, pyTruth(t.detail) ? t.detail : null) &&
        Object.hasOwn(e, 'text') === pyTruth(t.detail),
      `event ${eid}: text must be the detail of the timeline step`,
    );
    c.ok(Object.hasOwn(e, 'dateTo') === pyTruth(t.dateTo), `event ${eid}: dateTo`);
  }
  const lawIds = [...evs.keys()].filter((e) => e.startsWith('law-')).sort();
  c.ok(
    same(lawIds, [...wantIds].sort()),
    `law events ${repr(lawIds)} vs timeline steps ${repr([...wantIds].sort())}`,
  );
  const changes = new Map<string, any>(
    listLike(required(rates, 'changes')).map((x: any) => [required(x, 'id'), x]),
  );
  const mx = changes.get('max-insurable'),
    mn = changes.get('min-self-employed'),
    mi = changes.get('min-income-by-activity'),
    es = changes.get('civil-servant-employee-share'),
    er = changes.get('civil-servant-employer-share');
  if (!mx) pyError('KeyError', repr('max-insurable'));
  if (!mn) pyError('KeyError', repr('min-self-employed'));
  if (!mi) pyError('KeyError', repr('min-income-by-activity'));
  if (!es) pyError('KeyError', repr('civil-servant-employee-share'));
  if (!er) pyError('KeyError', repr('civil-servant-employer-share'));
  const cells =
    mi.changed === mi.filled
      ? `във всички ${mi.filled} попълнени клетки`
      : `в ${mi.changed} от ${mi.filled} попълнени клетки`;
  event(
    c,
    evs,
    'rates-2026-08-01',
    {
      date: '2026-08-01',
      dateKind: 'effective',
      kind: 'rates',
      href: '#/danaci',
      status: 'real',
      source: ['zbdoo'],
    },
    [],
    [mx.from, mx.until, mn.from, mn.until],
    [],
    [esc(cells)],
  );
  const [y, mo, d] = rates.meta.asOf.split('-').map(Number),
    longDate = `${d}[  ]${MONTHS[mo - 1]}[  ]${y}[  ]г\\.`;
  event(
    c,
    evs,
    'rates-2026-08-12',
    {
      date: rates.meta.asOf,
      dateKind: 'published',
      kind: 'rates',
      href: '#/danaci',
      status: 'real',
      source: ['nap'],
    },
    [],
    [],
    [es.from, es.until, er.from, er.until],
    [longDate, `в ${rates.napCategories.length} категории|${rates.napCategories.length} категории`],
  );
  const ms = required(required(debt, 'latest'), 'maastricht'),
    q = ms.quarter,
    [qy, qn] = q.id.split('-Q'),
    cy = exp.cofog.years.at(-1),
    pop = core.population,
    ordinal = ['първото', 'второто', 'третото', 'четвъртото'][Number(qn) - 1];
  event(
    c,
    evs,
    `eurostat-gov_10dd_edpt1-${ms.asOf}`,
    {
      date: ms.asOf,
      dateKind: 'published',
      kind: 'eurostat',
      href: `#/dalg?obhvat=maastricht&per=${ms.year}.report&to=s17-b-maastricht`,
      status: 'real',
      source: ['eurostat'],
      title: `Евростат: дългът на държавното управление за ${ms.year} г.`,
    },
    [ms.mln],
    [],
    [ms.pctGdp],
  );
  event(
    c,
    evs,
    `eurostat-gov_10q_ggdebt-${q.asOf}`,
    {
      date: q.asOf,
      dateKind: 'published',
      kind: 'eurostat',
      href: `#/dalg?obhvat=maastricht&per=${ms.year}.report&to=s17-b-quarterly`,
      status: 'real',
      source: ['eurostat'],
      title: `Евростат: дългът в края на ${ordinal} тримесечие на ${qy} г.`,
    },
    [q.mln],
    [],
    [q.pctGdp],
  );
  event(
    c,
    evs,
    `eurostat-gov_10a_exp-${exp.cofog.asOf}`,
    {
      date: exp.cofog.asOf,
      dateKind: 'published',
      kind: 'eurostat',
      href: `#/razhodi?per=${cy}.report`,
      status: 'real',
      source: ['eurostat'],
      title: `Евростат: разходите по функции (COFOG) са допълнени до ${cy} г.`,
    },
    [required(required(exp.cofog, 'total'), 'mln').at(-1)],
    [],
    [required(required(exp.cofog, 'total'), 'pctGdp').at(-1)],
    [`${cy} г\\.`],
  );
  const persons = String(required(pop, 'persons')).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  event(
    c,
    evs,
    `eurostat-tps00001-${pop.asOf}`,
    {
      date: pop.asOf,
      dateKind: 'published',
      kind: 'eurostat',
      href: '#/pari',
      status: 'real',
      source: ['eurostat'],
      title: `Евростат: населението на 1 януари ${pop.year} г.`,
    },
    [],
    [],
    [],
    [`${persons} души`],
  );
  c.ok(
    same(
      [...evs.keys()].filter((e) => e.startsWith('eurostat-')).sort(),
      [
        `eurostat-gov_10dd_edpt1-${ms.asOf}`,
        `eurostat-gov_10q_ggdebt-${q.asOf}`,
        `eurostat-gov_10a_exp-${exp.cofog.asOf}`,
        `eurostat-tps00001-${pop.asOf}`,
      ].sort(),
    ),
    'Eurostat events: ids vs dates in the datasets',
  );
  const files = seb.publication?.files || [],
    listed = [...new Set<string>(files.map((x: any) => x.listedOn))].sort();
  c.ok(listed.length === 1, `sebra.json: the files were listed on ${repr(listed)}`);
  const days = files.map((x: any) => x.day.slice(8, 10) + '.' + x.day.slice(5, 7));
  const pretty = days.length === 1 ? days[0] : days.slice(0, -1).join(', ') + ' и ' + days.at(-1),
    ov = seb.overall,
    active = contains(core.sources ?? {}, 'sebra');
  if (listed.length && active)
    event(
      c,
      evs,
      `sebra-${listed[0]}`,
      {
        date: listed[0],
        dateKind: 'published',
        kind: 'data',
        href: '#/plashtania',
        status: 'real',
        source: ['sebra'],
      },
      [],
      [ov.eur],
      [],
      [`${files.length} дневни файла`, esc(`(${pretty})`), `${ov.count} плащания`],
    );
  if (!active)
    c.ok(
      ![...evs.keys()].some((e) => e.startsWith('sebra-')),
      'the retired SEBRA dataset must have no active feed event',
    );
  const publication = ctx.get('budget2027.json');
  event(
    c,
    evs,
    'mf-budget-2027',
    {
      date: publication.publication,
      dateKind: 'published',
      kind: 'data',
      href: '#/byudzhet-2027',
      status: 'real',
      source: ['budget2027'],
    },
    [],
    [],
    [],
    ['не е приет закон'],
  );
  const expected = wantIds.length + n + 2 + 4 + Number(active) + 1;
  c.ok(evs.size === expected, `events: ${evs.size}, the datasets explain ${expected}`);
}
export { MONTHS };
