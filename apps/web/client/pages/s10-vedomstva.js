import { isFramework } from '../budget-2027.js';
import { institutionView, mountBillSearch } from './bill-views.js';
// S10 · Кой харчи? · #/vedomstva · next S15 · period 2026.law only (the data is the law of 31.07.2026 and the programme budgets of the bill)
// Data, only through `needs`:
//   ministries  D08+D09, REAL   the 46 budgets of the first-level spenders by the 2026 law (хил. €): spending, own revenue, the change against
//                               2025, the „bill ≠ law“ flags and where the programme budget is attached or still pending (P03)
//   programs    D09, REAL       272 rows: 82 policies and 190 programmes, the amounts of the spender's own budget (prb2026, prb2025)
//   core        the planned GDP (for „% от БВП“) and the number of inhabitants (for „на човек“)
// Two tabs (?tab=vedomstva|programi). Both lists filter in place while typing (a re-render would drop the caret and the focus); the text
// lives in ?q= and ?pq= (history.replaceState). Chips, selects and the view switches are ordinary re-renders (?vid ?podredba ?izgled ?ved ?pod ?nivo).
// Everything the visitor can change is a pure function of ctx and the model, so render() and mount() draw the very same markup.
import { html } from '../html.js';
import { num, pct, delta, money, khil, date, plural, DASH, NBSP, EUR_RATE } from '../format.js';
import { amount, moneyCol, chartUnit } from '../view.js';
import { norm, lat } from '../searchlib.js';
import { tabs } from '../ui/tabs.js';
import { explorer } from '../ui/explorer.js';
import { disclosure } from '../ui/disclosure.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { chips } from '../ui/chips.js';
import { seg } from '../ui/seg.js';
import { field, textInput, selectInput } from '../ui/forms.js';
import { ranklist } from '../ui/ranklist.js';
import { chart } from '../ui/chart.js';
import { dataTable } from '../ui/table.js';
import { callout } from '../ui/cards.js';
import { emptyState, errorState, pendingState } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';

export const needs = (ctx) =>
  isFramework(ctx) ? ['core', 'budget2027?'] : ['core', 'ministries', 'programs?'];
export const styles = ['s10-vedomstva'];
export const periods = ['2026.law', '2027.draft', '2028.forecast', '2029.forecast'];

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const bg = (a, b) => String(a).localeCompare(String(b), 'bg');
const clean = (q) =>
  String(q ?? '')
    .slice(0, 80)
    .trim();
const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);
const r1 = (v) => Number(v.toFixed(1)),
  r2 = (v) => Number(v.toFixed(2)),
  r3 = (v) => Number(v.toFixed(3));

const PAGE = 30; // programme rows per „Покажи още“
const LONG = 80; // a name longer than this is shown by its short form; the full name goes below it
const TABS = ['vedomstva', 'programi'];
const V_SORT = ['razmer', 'rast', 'spad', 'ime'];
const V_VIEW = ['lenti', 'tablica'];
const P_SORT = ['razmer', 'rast', 'spad', 'ime'];
const P_LEVEL = ['programi', 'politiki'];
const SOURCE_V = ['zdb', 'bill', 'prb'];
const SOURCE_P = ['prb', 'zdb'];

// the kinds of the data are eight; the visitor gets five groups (the last one is everything that is not one of the first four)
const GROUPS = [
  { key: 'ministry', kinds: ['ministry'], label: 'Министерства' },
  { key: 'agency', kinds: ['agency'], label: 'Агенции и служби' },
  { key: 'commission', kinds: ['commission'], label: 'Комисии и съвети' },
  { key: 'judiciary', kinds: ['judiciary'], label: 'Съдебна власт' },
  { key: 'other', kinds: ['constitutional', 'legislature', 'fund', 'other'], label: 'Други' },
];
const groupOf = (kind) =>
  (GROUPS.find((g) => g.kinds.includes(kind)) ?? GROUPS[GROUPS.length - 1]).key;

const SORT_V = [
  { value: 'razmer', label: 'Най-голям разход' },
  { value: 'rast', label: 'Най-голям ръст' },
  { value: 'spad', label: 'Най-голям спад' },
  { value: 'ime', label: 'По азбучен ред' },
];
const SORT_P = [{ value: 'razmer', label: 'Най-голяма сума' }, ...SORT_V.slice(1)];

/* ---------------------------------------------------------------- search: every word of the query must be found (word start; inside a word from 3 letters on) */
const fieldsOf = (list) =>
  list
    .filter((s) => s != null && s !== '')
    .map((s) => {
      const n = norm(s);
      return n ? { n, l: lat(n), c: String(s).trim().toLowerCase() } : null;
    })
    .filter(Boolean);

/** returns a function fields => -1 (no match) | 0 exact | 1 starts with | 2 word start | 3 inside; null for an empty query */
function makeMatcher(q) {
  const typed = clean(q);
  if (/^\d[\d.]*$/.test(typed)) {
    // a code or the start of one: „1300“, „1300.01“, „1300.01.01“
    const c = typed.replace(/\.+$/, '');
    return (fields) => {
      let best = -1;
      for (const f of fields) {
        if (!/^\d/.test(f.c)) continue;
        if (f.c === c) return 0;
        if (f.c.startsWith(c)) best = 1;
      }
      return best;
    };
  }
  const t = norm(typed).split(' ').filter(Boolean);
  if (!t.length) return null;
  const isLat = t.map((x) => /[a-z]/.test(x));
  return (fields) => {
    let worst = 0;
    for (let i = 0; i < t.length; i++) {
      let best = 9;
      for (const f of fields) {
        const s = isLat[i] ? f.l : f.n;
        if (!s) continue;
        let r = 9;
        if (s === t[i]) r = 0;
        else if (s.startsWith(t[i])) r = 1;
        else if ((' ' + s).includes(' ' + t[i])) r = 2;
        else if (t[i].length >= 3 && s.includes(t[i])) r = 3;
        if (r < best) best = r;
      }
      if (best === 9) return -1;
      if (best > worst) worst = best;
    }
    return worst;
  };
}

/* ---------------------------------------------------------------- the model */
function model(ctx) {
  const doc = ctx.data.ministries;
  const raw = (Array.isArray(doc?.items) ? doc.items : []).filter(
    (m) => m && m.id != null && m.name && ok(m.expKhil),
  );
  if (!raw.length) return { ok: false };
  const gdp = ctx.core?.kpis?.gdp;
  const gdpMln = [gdp?.mlnPrecise, gdp?.mln].find((x) => ok(x) && x > 0) ?? null;
  const total = raw.reduce((s, m) => s + m.expKhil / 1000, 0);
  const kinds = doc.kinds && typeof doc.kinds === 'object' ? doc.kinds : {};
  const items = raw.map((m) => {
    const mln = m.expKhil / 1000;
    const rev = ok(m.revKhil) ? m.revKhil / 1000 : null;
    const pbl = m.programBudgetVsLaw;
    const real = m.programs && m.programs.status === 'real';
    return {
      id: String(m.id),
      art: m.art,
      name: String(m.name).trim(),
      short: String(m.short || '').trim(),
      kind: m.kind,
      group: groupOf(m.kind),
      kindLabel: kinds[m.kind] || '',
      mln,
      rev,
      pctGdp: gdpMln ? (mln / gdpMln) * 100 : null,
      revPctGdp: gdpMln && rev !== null ? (rev / gdpMln) * 100 : null,
      share: total > 0 ? (mln / total) * 100 : null,
      change: m.change && ok(m.change.pct) ? { pct: m.change.pct, basis: m.change.basis } : null,
      differs: !!m.billVsLaw || (!!pbl && ok(pbl.diffKhil) && Math.abs(pbl.diffKhil) > 0.05),
      progDiffers: m.programs?.tier === 'program-budget-differs',
      progCount: real && ok(m.programs.count) ? m.programs.count : null,
      progPolicies: real && ok(m.programs.policyCount) ? m.programs.policyCount : null,
      pending: m.programs && m.programs.status === 'pending' ? m.programs : null,
      fields: fieldsOf([m.name, m.short, m.id, m.lawName]),
    };
  });
  const byId = new Map(items.map((m) => [m.id, m]));
  const withRev = items.filter((m) => m.rev !== null).length;
  const totalRev = items.reduce((s, m) => s + (m.rev ?? 0), 0);
  const arts = items.map((m) => m.art).filter(ok);
  const groups = GROUPS.map((g) => ({
    ...g,
    label: g.kinds.length === 1 && kinds[g.kinds[0]] ? kinds[g.kinds[0]] : g.label,
    count: items.filter((m) => m.group === g.key).length,
  })).filter((g) => g.count > 0);
  const vid = pick(
    ctx.query.vid,
    groups.map((g) => g.key),
    '',
  );
  return {
    ok: true,
    doc,
    items,
    byId,
    total,
    totalRev,
    withRev,
    gdpMln,
    groups,
    vid,
    vidLabel: groups.find((g) => g.key === vid)?.label ?? '',
    sort: pick(ctx.query.podredba, V_SORT, 'razmer'),
    view: pick(ctx.query.izgled, V_VIEW, 'lenti'),
    asOf: doc.meta?.asOf,
    artMin: arts.length ? Math.min(...arts) : null,
    artMax: arts.length ? Math.max(...arts) : null,
  };
}

/** the growth of a programme between the two columns of the spender's own budget */
function growthOf(k, k25, isNew) {
  if (k === null) return { kind: 'none', why: 'nodata' };
  if (isNew || (k25 === 0 && k > 0)) return { kind: 'new' };
  if (k25 === null) return { kind: 'none', why: 'no2025' };
  if (k25 > 0) return { kind: 'num', v: ((k - k25) / k25) * 100 };
  return { kind: 'none', why: 'zero' };
}

function pModel(md, ctx) {
  const doc = ctx.data.programs;
  if (!doc || !Array.isArray(doc.items) || !Array.isArray(doc.fields)) return null;
  const ix = {};
  doc.fields.forEach((f, i) => {
    ix[f] = i;
  });
  if (
    ['ministry', 'code', 'name', 'level', 'policy', 'y2026', 'prb2026', 'prb2025'].some(
      (f) => !(f in ix),
    )
  )
    return null;
  const NO = ok(doc.sentinels?.noData) ? doc.sentinels.noData : -1;
  const known = (v) => (ok(v) && v !== NO ? v : null);
  const policyName = new Map();
  for (const r of doc.items)
    if (r[ix.level] === 'policy')
      policyName.set(String(r[ix.code]), String(r[ix.name] ?? '').trim());
  const rows = [];
  for (const r of doc.items) {
    const code = String(r[ix.code] ?? '');
    if (!code) continue;
    const ministry = String(r[ix.ministry] ?? '');
    const min = md.byId.get(ministry);
    const level = r[ix.level] === 'policy' ? 'policy' : 'program';
    const name =
      String(r[ix.name] ?? '').trim() || `${level === 'policy' ? 'Политика' : 'Програма'} ${code}`;
    const k = known(r[ix.prb2026]),
      k25 = known(r[ix.prb2025]),
      consol = known(r[ix.y2026]);
    const parent = String(r[ix.policy] ?? '');
    rows.push({
      ministry,
      min,
      code,
      name,
      level,
      parent,
      k,
      k25,
      consol,
      isNew: r[ix.isNew] === 1,
      g: growthOf(k, k25, r[ix.isNew] === 1),
      kids: [],
      fields: fieldsOf([
        name,
        code,
        min?.short,
        ministry,
        min?.name,
        parent ? policyName.get(parent) : '',
      ]),
      anchor: `pol-${code.replace(/\./g, '-')}`,
    });
  }
  const policies = rows.filter((r) => r.level === 'policy');
  const programs = rows.filter((r) => r.level === 'program');
  const byCode = new Map(policies.map((p) => [p.code, p]));
  const solo = [];
  for (const p of programs) {
    const parent = p.parent && byCode.get(p.parent);
    if (parent) parent.kids.push(p);
    else solo.push(p);
  }
  const withProg = [...new Set(rows.map((r) => r.ministry))]
    .map((id) => md.byId.get(id))
    .filter(Boolean)
    .sort((a, b) => bg(a.short || a.name, b.short || b.name));
  const ved = pick(
    ctx.query.ved,
    withProg.map((m) => m.id),
    '',
  );
  return {
    doc,
    rows,
    policies,
    programs,
    solo,
    withProg,
    ved,
    asOf: doc.meta?.asOf,
    sort: pick(ctx.query.pod, P_SORT, 'razmer'),
    level: pick(ctx.query.nivo, P_LEVEL, 'programi'),
    kBudgets: withProg.length,
  };
}

/* ---------------------------------------------------------------- sorting */
const labelOf = (m) => (m.name.length > LONG && m.short && m.short !== m.name ? m.short : m.name);

function vSorter(sort) {
  const size = (a, b) => b.mln - a.mln || bg(a.name, b.name);
  if (sort === 'ime') return (a, b) => bg(labelOf(a), labelOf(b));
  if (sort === 'rast' || sort === 'spad') {
    const dir = sort === 'rast' ? -1 : 1;
    return (a, b) => {
      const x = a.change ? a.change.pct : null,
        y = b.change ? b.change.pct : null;
      if (x === null || y === null) return x === y ? size(a, b) : x === null ? 1 : -1; // no comparison: last in both directions
      return (x - y) * dir || size(a, b);
    };
  }
  return size;
}

const gv = (r) => (r.g.kind === 'num' ? r.g.v : r.g.kind === 'new' ? Infinity : null);
function pSorter(sort) {
  const size = (a, b) =>
    (a.k === null) - (b.k === null) || (b.k ?? 0) - (a.k ?? 0) || bg(a.name, b.name);
  if (sort === 'ime') return (a, b) => bg(a.name, b.name) || (a.code < b.code ? -1 : 1);
  if (sort === 'rast' || sort === 'spad') {
    const desc = sort === 'rast';
    return (a, b) => {
      const x = gv(a),
        y = gv(b);
      if (x === null || y === null) return x === y ? size(a, b) : x === null ? 1 : -1; // no value last; „ново“ is the largest growth
      if (x === y) return size(a, b);
      return (desc ? x > y : x < y) ? -1 : 1;
    };
  }
  return size;
}

/* ---------------------------------------------------------------- texts of the numbers */
/** a budget total as text: the amount in the chosen unit; „% от БВП“ and „на човек“ never print a misleading zero */
function amountText(ctx, mln, pctGdp, d) {
  if (!ok(mln)) return DASH;
  if (ctx.store.get('unit') === 'pct' && ok(pctGdp))
    return pctGdp < 0.005
      ? `под${NBSP}0,01%${NBSP}от${NBSP}БВП`
      : `${pct(pctGdp, 2)}${NBSP}от${NBSP}БВП`;
  if (ctx.store.get('perPerson')) {
    const people = ctx.core?.population?.persons;
    if (ok(people) && people > 0 && (mln * 1e6) / people < 0.5)
      return `под${NBSP}1${NBSP}€${NBSP}на${NBSP}човек`;
  }
  return amount(ctx, { mln, pctGdp, d });
}

/** the amount of a programme (хил. €): thousands below a million, million above; the leva only with „и в лева“ */
function amountK(ctx, k) {
  if (!ok(k)) return DASH;
  const lv = !!ctx.store.get('leva');
  if (Math.abs(k) >= 1000) return money(k / 1000, { leva: lv });
  if (k === 0) return `0${NBSP}€`;
  return lv ? `${khil(k, 1)} (≈${NBSP}${num(k * EUR_RATE, 1)}${NBSP}хил.${NBSP}лв.)` : khil(k, 1);
}

/** a share of the sum: a tiny share is „под 0,1%“, never a misleading 0,0% */
const shareNum = (p) => (!ok(p) ? DASH : p < 0.05 ? 'под 0,1' : num(p, 1));
const shareText = (p) => (!ok(p) ? '' : p < 0.05 ? `под${NBSP}0,1%` : pct(p, 1));
/** the name as a sentence part: the full name, or the short form when the name is long */
const plainName = (m) => (m.name.length <= 44 ? m.name : m.short || m.name);
const listNames = (names) =>
  names.length > 1
    ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}`
    : names[0] || '';
const tag = () =>
  html`<span class="s10-tag"><span aria-hidden="true">проект ≠ закон</span><span class="sr-only">проектът се различава от закона</span></span>`;
const dots = (parts) =>
  parts.filter((p) => p !== '' && p != null).map((p, i) => (i ? html` · ${p}` : html`${p}`));

function changeText(m) {
  if (!m.change) return 'няма сравнение с 2025 г.';
  const star = m.change.basis === 'program-budget' ? '*' : '';
  return Math.abs(m.change.pct) < 0.05
    ? `без промяна спрямо 2025 г.${star}`
    : `${delta(m.change.pct, 1)}${star} спрямо 2025 г.`;
}

function growthText(r) {
  const g = r.g;
  if (g.kind === 'num')
    return Math.abs(g.v) < 0.05 ? 'без промяна спрямо 2025 г.' : `${delta(g.v, 1)} спрямо 2025 г.`;
  if (g.kind === 'new') return 'ново: за 2025 г. няма средства';
  if (g.why === 'no2025') return 'няма данни за 2025 г.';
  if (g.why === 'zero') return 'без средства по бюджета на ведомството през 2025 и 2026 г.';
  return 'в източника няма сума';
}

/* ---------------------------------------------------------------- ministries: the list, the count, the notes */
function vSub(m, { change = true } = {}) {
  const parts = [];
  if (labelOf(m) !== m.name) parts.push(m.name);
  else if (m.short && m.short !== m.name) parts.push(m.short);
  parts.push(`код ${m.id}`);
  if (change) parts.push(changeText(m));
  return html`${dots(parts)}${m.differs ? html` ${tag()}` : ''}`;
}

function moneyColumn(ctx, md) {
  if (ctx.store.get('unit') === 'pct' && md.gdpMln) {
    return {
      unit: '% от БВП',
      text: (mln, p) => (!ok(p) ? DASH : p < 0.005 ? 'под 0,01' : num(p, 2)),
      lev: () => '',
    };
  }
  const c = moneyCol(ctx, { d: 2 });
  const per = !!ctx.store.get('perPerson');
  return {
    unit: c.unit,
    text: (mln) => {
      const v = c.raw(mln);
      return v === null ? DASH : per && v < 0.5 ? 'под 1' : num(v, c.d);
    },
    lev: (mln) => (per && c.raw(mln) < 0.5 ? '' : c.lev(mln)),
  };
}

function vTable(md, ctx, rows) {
  const col = moneyColumn(ctx, md);
  const money2 = (mln, p) =>
    html`${col.text(mln, p)}${col.lev(mln) ? html`<small class="s10-lev">${col.lev(mln)}</small>` : ''}`;
  const columns = [
    {
      key: 'name',
      label: 'Ведомство',
      fmt: (v, r) =>
        html`<a href="${ctx.href('vedomstvo', { code: r.m.id })}">${labelOf(r.m)}</a><small class="s10-cell-sub">${vSub(r.m, { change: false })}</small>`,
    },
    { key: 'kind', label: 'Вид', align: 'start' },
    {
      key: 'exp',
      label: 'Разходи 2026',
      unit: col.unit,
      num: true,
      fmt: (v, r) => money2(r.m.mln, r.m.pctGdp),
    },
    {
      key: 'share',
      label: 'Дял от сбора',
      unit: '%',
      num: true,
      fmt: (v, r) => shareNum(r.m.share),
    },
    {
      key: 'rev',
      label: 'Собствени приходи',
      unit: col.unit,
      num: true,
      fmt: (v, r) => (r.m.rev === null ? DASH : money2(r.m.rev, r.m.revPctGdp)),
    },
    {
      key: 'change',
      label: 'Промяна спрямо 2025',
      unit: '%',
      num: true,
      fmt: (v, r) =>
        r.m.change
          ? html`${delta(r.m.change.pct, 1)}${r.m.change.basis === 'program-budget' ? '*' : ''}`
          : DASH,
    },
    {
      key: 'progs',
      label: 'Програми',
      num: true,
      fmt: (v, r) =>
        r.m.progCount === null
          ? html`<span class="muted">няма данни</span>`
          : html`${num(r.m.progCount, 0)}`,
    },
  ];
  const data = rows.map((m) => ({
    m,
    name: m.name,
    kind: m.kindLabel,
    exp: m.mln,
    share: m.share,
    rev: m.rev,
    change: m.change ? m.change.pct : null,
    progs: m.progCount,
  }));
  return dataTable({
    id: 's10-v-tablica',
    caption: 'Бюджети на ведомствата за 2026 г.',
    columns,
    rows: data,
    dense: true,
    note: 'Тире значи, че законът не посочва собствени приходи за това ведомство.',
  });
}

function vList(md, ctx, rows, q) {
  if (md.view === 'tablica') return vTable(md, ctx, rows);
  return ranklist({
    id: 's10-v-lenti',
    label: 'Разходи на ведомствата през 2026 г.',
    ordered: !q && md.sort === 'razmer',
    categoryLabel: 'Ведомство',
    unitLabel: 'млн. €',
    fmt: (v, it) =>
      html`${amountText(ctx, v, it.pctGdp)}${ok(it.sharePct) ? html`<span class="rank-share">${shareText(it.sharePct)} от сбора</span>` : ''}`,
    items: rows.map((m) => ({
      label: labelOf(m),
      sub: vSub(m),
      value: m.mln,
      pctGdp: m.pctGdp,
      sharePct: m.share,
      href: ctx.href('vedomstvo', { code: m.id }),
    })),
  });
}

function vNotes(md, rows) {
  const out = [];
  if (rows.some((m) => m.differs)) {
    out.push(
      html`<p>${tag()} Така са отбелязани ведомствата, при които проектът на закона или програмният бюджет към него се различава от приетия закон: в общата сума или в отделни редове. Подробностите са на страницата на ведомството.</p>`,
    );
  }
  const star = rows.filter((m) => m.change?.basis === 'program-budget');
  if (star.length) {
    out.push(
      html`<p>* ${listNames(star.map(plainName))}: промяната е изчислена по програмния бюджет към проекта на закона, а не по сумата в закона, защото двете се различават.</p>`,
    );
  }
  if (rows.some((m) => m.change))
    out.push(html`<p>Промяната е в евро по текущи цени, без поправка за инфлация.</p>`);
  return html`${out}`;
}

function vParts(md, ctx, q) {
  const match = makeMatcher(q);
  const rank = new Map();
  let rows = md.items.filter((m) => !md.vid || m.group === md.vid);
  if (match)
    rows = rows.filter((m) => {
      const r = match(m.fields);
      if (r < 0) return false;
      rank.set(m, r);
      return true;
    });
  const sorter = vSorter(md.sort);
  rows = [...rows].sort(
    (a, b) => (match ? (rank.get(a) > 0) - (rank.get(b) > 0) : 0) || sorter(a, b),
  ); // an exact hit first, then the chosen order
  const n = rows.length,
    N = md.items.length;
  const sum = rows.reduce((s, m) => s + m.mln, 0);
  const X = amountText(ctx, sum, md.gdpMln ? (sum / md.gdpMln) * 100 : null);
  const share = md.total > 0 ? (sum / md.total) * 100 : 0;
  let count;
  if (!n) count = 'Няма показани ведомства.';
  else if (n === N)
    count = `Показани са всички ${num(N, 0)} ведомства. Сборът на бюджетите им е ${X}.`;
  else if (n === 1)
    count = `${q ? 'Намерено е' : 'Показано е'} 1 от ${num(N, 0)} ведомства. Бюджетът му е ${X}, или ${shareText(share)} от сбора на всички ${num(N, 0)} бюджета.`;
  else
    count = `${q ? 'Намерени са' : 'Показани са'} ${num(n, 0)} от ${num(N, 0)} ведомства. Бюджетите им са общо ${X}, или ${shareText(share)} от сбора на всички ${num(N, 0)} бюджета.`;
  let body;
  if (n) body = vList(md, ctx, rows, q);
  else {
    const elsewhere = md.vid && match ? md.items.filter((m) => match(m.fields) >= 0).length : 0;
    body = emptyState({
      title: 'Няма такова ведомство.',
      text: elsewhere
        ? `В групата „${md.vidLabel}“ няма такова ведомство. Има съвпадения в други групи.`
        : q
          ? 'Опитай „МВР“ или код „1300“.'
          : 'В тази група няма ведомства.',
      actions: [
        elsewhere
          ? { label: 'Покажи всички групи', action: 's10-all-groups', primary: true }
          : null,
        q ? { label: 'Изчисти търсенето', action: 's10-clear-v', primary: !elsewhere } : null,
      ].filter(Boolean),
    });
  }
  return { n, rows, count, body, notes: n ? vNotes(md, rows) : html`` };
}

function exportV(md, ctx) {
  const p = vParts(md, ctx, clean(ctx.query.q));
  return {
    columns: [
      'Ведомство',
      'Код',
      'Вид',
      'Разходи 2026, млн. €',
      'Дял от сбора, %',
      'Собствени приходи, млн. €',
      'Промяна спрямо 2025, %',
      'Основа на промяната',
      'Програми',
    ],
    rows: p.rows.map((m) => [
      m.name,
      m.id,
      m.kindLabel,
      r3(m.mln),
      m.share === null ? '' : r2(m.share),
      m.rev === null ? '' : r3(m.rev),
      m.change ? m.change.pct : '',
      m.change ? (m.change.basis === 'program-budget' ? 'програмен бюджет' : 'закон') : '',
      m.progCount === null ? 'няма данни' : m.progCount,
    ]),
  };
}

/* ---------------------------------------------------------------- programmes: the list, the count, the notes */
function pSub(r, ctx, { ministry = true, kids = 0, solo = false } = {}) {
  const parts = [];
  if (ministry) parts.push(r.min?.short || r.min?.name || r.ministry);
  if (r.level === 'policy') parts.push('политика');
  else if (solo) parts.push('програма без политика');
  parts.push(`код ${r.code}`);
  if (kids) parts.push(plural(kids, 'програма', 'програми'));
  parts.push(growthText(r));
  if (r.k === 0 && ok(r.consol) && r.consol > 0.5)
    parts.push(`${amountK(ctx, r.consol)} са от европейски и други средства`);
  return html`${dots(parts)}${r.min?.progDiffers ? html` ${tag()}` : ''}`;
}

function pItem(r, ctx, o) {
  const href =
    r.level === 'policy'
      ? ctx.href('vedomstvo', { code: r.ministry }, { to: r.anchor })
      : ctx.href('vedomstvo', { code: r.ministry, program: r.code });
  return { label: r.name, sub: pSub(r, ctx, o), value: r.k, href };
}

/** the rows of the current view: flat programmes, or policies with their programmes (a policy stays when it or any of its programmes matches) */
function pRows(pm, q) {
  const match = makeMatcher(q);
  const sorter = pSorter(pm.sort);
  const rank = new Map();
  const keep = (r) => {
    if (pm.ved && r.ministry !== pm.ved) return false;
    if (!match) return true;
    const k = match(r.fields);
    if (k < 0) return false;
    rank.set(r, k);
    return true;
  };
  const order = (list) =>
    [...list].sort((a, b) => (match ? (rank.get(a) > 0) - (rank.get(b) > 0) : 0) || sorter(a, b));
  if (pm.level === 'programi')
    return { flat: true, tops: order(pm.programs.filter(keep)).map((row) => ({ row, kids: [] })) };
  const tops = [];
  for (const pol of pm.policies) {
    if (pm.ved && pol.ministry !== pm.ved) continue;
    let kids = pol.kids;
    if (match) {
      const own = match(pol.fields);
      if (own >= 0) rank.set(pol, own);
      else {
        kids = pol.kids.filter((c) => {
          const k = match(c.fields);
          if (k >= 0) rank.set(c, k);
          return k >= 0;
        });
        if (!kids.length) continue;
        rank.set(pol, Math.min(...kids.map((c) => rank.get(c))));
      }
    }
    tops.push({ row: pol, kids });
  }
  for (const s of pm.solo) if (keep(s)) tops.push({ row: s, kids: [], solo: true });
  const byRow = new Map(tops.map((t) => [t.row, t]));
  return {
    flat: false,
    tops: order(tops.map((t) => t.row)).map((r) => ({
      ...byRow.get(r),
      kids: order(byRow.get(r).kids),
    })),
  };
}

function pNotes(pm, ctx, tops) {
  const out = [];
  const diff = [
    ...new Map(
      tops.filter((t) => t.row.min?.progDiffers).map((t) => [t.row.ministry, t.row.min]),
    ).values(),
  ];
  if (diff.length) {
    out.push(
      html`<p>${tag()} Така са отбелязани програмите на ведомства, чийто програмен бюджет към проекта на закона се различава от приетия закон (${listNames(diff.map(plainName))}). Сумите на техните програми са по проекта.</p>`,
    );
  }
  if (ctx.store.get('unit') === 'pct' || ctx.store.get('perPerson'))
    out.push(
      html`<p>Сумите на програмите са винаги в евро. Дял от БВП и сума на човек се показват само за бюджетите на ведомствата.</p>`,
    );
  return html`${out}`;
}

function pParts(pm, ctx, q, limit) {
  const { flat, tops } = pRows(pm, q);
  const total = tops.length;
  const shown = tops.slice(0, limit);
  const T = pm.programs.length;
  const sum = tops.reduce((s, t) => s + (t.row.k ?? 0), 0);
  const X = amountK(ctx, sum);
  let count;
  const here = pm.ved ? ' в избраното ведомство' : '';
  if (flat) {
    const n = total;
    if (!n) count = 'Няма намерени програми.';
    else if (q)
      count = `${n === 1 ? 'Намерена е 1 програма' : `Намерени са ${num(n, 0)} програми`} от общо ${num(T, 0)}. ${n === 1 ? 'Сумата ѝ' : 'Сборът им'} е ${X}.`;
    else if (n === T) count = `Общо ${num(T, 0)} програми. Сборът им е ${X}.`;
    else
      count = `${n === 1 ? '1 програма' : `${num(n, 0)} програми`}${here}, от общо ${num(T, 0)}. ${n === 1 ? 'Сумата ѝ' : 'Сборът им'} е ${X}.`;
  } else {
    const pol = tops.filter((t) => !t.solo).length,
      solo = tops.length - pol,
      one = tops.length === 1;
    const what = [
      pol ? plural(pol, 'политика', 'политики') : '',
      solo ? `${plural(solo, 'програма', 'програми')} без политика` : '',
    ]
      .filter(Boolean)
      .join(' и ');
    if (!tops.length) count = 'Няма намерени политики.';
    else if (q)
      count = `${one ? 'Намерена е' : 'Намерени са'} ${what}.`; // no sum: a policy that matched by one programme still carries its whole amount
    else
      count = `${pm.ved ? 'В избраното ведомство има' : 'Има'} ${what}. ${one ? 'Сумата ѝ' : 'Сборът им'} е ${X}.`;
  }
  const finite = tops.map((t) => t.row.k).filter(ok);
  const max = finite.length ? Math.max(...finite) : undefined;
  let body;
  if (!total) {
    const elsewhere =
      pm.ved && q
        ? (() => {
            const m = makeMatcher(q);
            return pm.rows.some((r) => r.ministry !== pm.ved && m(r.fields) >= 0);
          })()
        : false;
    body = emptyState({
      title: 'Няма такава програма.',
      text: elsewhere
        ? 'В избраното ведомство няма такава програма. Има съвпадения в други ведомства.'
        : q
          ? 'Опитай дума от името или код като „1300.01.01“.'
          : 'За избраното ведомство няма програми.',
      actions: [
        elsewhere
          ? { label: 'Покажи всички ведомства', action: 's10-all-ved', primary: true }
          : null,
        q ? { label: 'Изчисти търсенето', action: 's10-clear-p', primary: !elsewhere } : null,
      ].filter(Boolean),
    });
  } else {
    const list = ranklist({
      id: 's10-p-lenti',
      label: flat
        ? 'Програми на ведомствата, сума за 2026 г.'
        : 'Политики и програми на ведомствата, сума за 2026 г.',
      categoryLabel: flat ? 'Програма' : 'Политика или програма',
      unitLabel: 'хил. €',
      max,
      fmt: (v) => amountK(ctx, v),
      items: shown.map((t) =>
        flat
          ? pItem(t.row, ctx, {})
          : {
              ...pItem(t.row, ctx, { kids: t.kids.length, solo: t.solo }),
              children: t.kids.map((c) => pItem(c, ctx, { ministry: false })),
            },
      ),
    });
    body = html`${list}${total > shown.length ? html`<p class="s10-more"><button type="button" class="btn" data-action="s10-more">Покажи още ${num(Math.min(PAGE, total - shown.length), 0)}</button><span class="small muted">Показани са ${num(shown.length, 0)} от ${num(total, 0)}.</span></p>` : ''}`;
  }
  return {
    flat,
    tops,
    total,
    shownN: shown.length,
    count,
    body,
    notes: total ? pNotes(pm, ctx, shown) : html``,
  };
}

function exportP(pm, ctx) {
  const { flat, tops } = pRows(pm, clean(ctx.query.pq));
  const line = (r, polName = '') => [
    r.code,
    r.name,
    r.level === 'policy' ? 'политика' : 'програма',
    polName,
    r.min?.short || r.min?.name || r.ministry,
    r.k === null ? '' : r.k,
    r.k25 === null ? '' : r.k25,
    r.g.kind === 'num' ? r1(r.g.v) : '',
    r.g.kind === 'new' ? 'да' : '',
  ];
  const rows = [];
  for (const t of tops) {
    rows.push(line(t.row));
    if (!flat) for (const c of t.kids) rows.push(line(c, t.row.name));
  }
  return {
    columns: [
      'Код',
      'Програма или политика',
      'Ниво',
      'Политика',
      'Ведомство',
      'Разход 2026, хил. €',
      'Разход 2025, хил. €',
      'Промяна спрямо 2025, %',
      'Ново',
    ],
    rows,
  };
}

/* ---------------------------------------------------------------- the pieces of the page */
/** the answer to „Кой харчи?“ in two sentences: the sum and the three biggest budgets, each with its amount and share. On the screen under the
    totals (overview) and, the same text, the short answer for search and answer engines (answer below, js/seo.js) */
function topLine(md) {
  const top = [...md.items].sort((a, b) => b.mln - a.mln).slice(0, 3);
  if (!top.length) return '';
  const topShare = (top.reduce((s, m) => s + m.mln, 0) / md.total) * 100;
  const one = (m) => `${m.name} (${money(m.mln, { d: 2 })}, ${pct(m.share, 1)})`;
  const names =
    top.length > 1
      ? `${top.slice(0, -1).map(one).join(', ')} и ${one(top[top.length - 1])}`
      : one(top[0]);
  return `Ведомствата харчат общо ${money(md.total, { d: 2 })} по закона за 2026 г. Най-големи са бюджетите на ${names}: заедно ${pct(topShare, 1)} от сбора.`;
}
export function answer(ctx) {
  if (isFramework(ctx)) return '';
  if (!ctx.data?.ministries) return '';
  const md = model(ctx);
  return md.ok ? topLine(md) : '';
}

function overview(md, pm, ctx) {
  const N = md.items.length;
  const items = [
    kpi({
      label: 'Ведомства с бюджет',
      value: num(N, 0),
      gl: 'parvostepenen-razporeditel-s-byudzhet',
      sub: md.artMin !== null ? `Членове ${md.artMin}–${md.artMax} от закона.` : '',
    }),
    kpi({
      label: 'Разходи общо',
      mln: md.total,
      pctGdp: md.gdpMln ? (md.total / md.gdpMln) * 100 : null,
      sub: `Сборът на бюджетите на всички ${num(N, 0)} ведомства.`,
    }),
    kpi({
      label: 'Собствени приходи',
      mln: md.totalRev,
      pctGdp: md.gdpMln ? (md.totalRev / md.gdpMln) * 100 : null,
      sub: `Приходи, записани в бюджетите на ${num(md.withRev, 0)} от ${num(N, 0)} ведомства.`,
    }),
    pm
      ? kpi({
          label: 'Програми',
          value: num(pm.programs.length, 0),
          href: ctx.href('vedomstva', {}, { tab: 'programi' }),
          sub: `В ${plural(pm.policies.length, 'политика', 'политики')} на ${pm.kBudgets} от ${num(N, 0)} бюджета.`,
        })
      : kpi({ label: 'Програми', value: null }),
  ];
  return block({
    id: 's10-obshto',
    title: 'Бюджетите на ведомствата общо',
    status: 'real',
    source: md.doc.meta?.source ?? SOURCE_V,
    asOf: md.asOf,
    scope: { key: 'zdb-vedomstva', label: 'Бюджети на ведомствата', note: 'не е целият бюджет' },
    sub: 'Разходите и собствените приходи на всички ведомства по закона за 2026 г.',
    body: html`${kpiGrid(items, { label: 'Основни числа за ведомствата' })}
      ${callout({ kind: 'info', title: 'Какво е и какво не е в сбора', body: md.doc.scopeNote || 'Сборът е на разходите на първостепенните разпоредители. Не е целият държавен бюджет.' })}
      <p class="s10-top">${topLine(md)}</p>`,
  });
}

/** how the sum splits: the seven biggest budgets and all the others together, as bars, a pie or a table (the parts add up to „Разходи общо“ above) */
function sharesBlock(md, ctx) {
  const order = [...md.items].sort((a, b) => b.mln - a.mln || bg(a.name, b.name));
  if (order.length < 5 || !(md.total > 0)) return '';
  const top = order.slice(0, 7),
    rest = order.slice(7);
  const restMln = rest.reduce((s, m) => s + m.mln, 0);
  const name = (m) => (m.name.length > 50 && m.short ? m.short : m.name);
  const parts = [
    ...top.map((m) => ({ name: name(m), mln: m.mln, pg: m.pctGdp })),
    {
      name: `Останалите ${num(rest.length, 0)} ведомства`,
      mln: restMln,
      pg: md.gdpMln ? (restMln / md.gdpMln) * 100 : null,
    },
  ];
  const u = chartUnit(ctx, { pct: true, max: Math.max(...parts.map((p) => p.mln)) });
  const spec = {
    id: 's10-ch-delove',
    type: 'barh',
    title: 'Най-големите бюджети и останалите',
    sub: `В ${u.unit}.`,
    unit: u.unit,
    d: u.d,
    fmt: u.fmt,
    option: u.option(true),
    categories: parts.map((p) => p.name),
    categoryLabel: 'Ведомство',
    series: [
      {
        name: 'Разходи на ведомството',
        data: parts.map((p) => u.conv(p.mln, p.pg)),
        color: '--exp',
      },
    ],
    labels: true,
    legend: false,
    labelWidth: 'auto',
    labelOverflow: 'break',
    height: parts.length * 44 + 40,
    views: ['bars', 'pie', 'table'],
    partColors: [...top.map((_, i) => i + 1), 'other'],
    pieHeight: 340,
    desc: `Хоризонтални ленти: ${parts.map((p) => `${p.name} ${u.fmt(u.conv(p.mln, p.pg))} ${u.unit}`).join('; ')}.`,
  };
  return block({
    id: 's10-delove',
    title: 'Кой взема най-голям дял',
    status: 'real',
    source: md.doc.meta?.source ?? SOURCE_V,
    asOf: md.asOf,
    scope: { key: 'zdb-vedomstva', label: 'Бюджети на ведомствата', note: 'не е целият бюджет' },
    sub: 'Седемте най-големи бюджета и всички останали ведомства заедно. Заедно правят сбора по-горе.',
    body: chart(spec),
  });
}

function vFind(md, ctx, q, p) {
  const chipItems = [
    { label: 'Всички', count: md.items.length, query: 'vid=', pressed: !md.vid },
    ...md.groups.map((g) => ({
      label: g.label,
      count: g.count,
      query: `vid=${g.key}`,
      pressed: md.vid === g.key,
    })),
  ];
  return html`<div class="s10-find" role="search" aria-label="Търсене и филтри на ведомствата">
    <div class="s10-controls">
      ${field({ id: 's10-q', label: 'Намери ведомство', hint: 'Име, „МВР“ или код „1300“.', control: textInput({ id: 's10-q', name: 'q', value: q, type: 'search', autocomplete: 'off', inputmode: 'search', hint: true }) })}
      ${field({ id: 's10-sort', label: 'Подреди по', control: selectInput({ id: 's10-sort', name: 'podredba', value: md.sort, options: SORT_V, query: 'podredba' }) })}
      <div class="field s10-view"><span class="field-label" aria-hidden="true">Покажи като</span>${seg(
        {
          name: 's10-view',
          label: 'Покажи като',
          value: md.view,
          query: 'izgled',
          options: [
            { value: 'lenti', label: 'Ленти', icon: 'barChart' },
            { value: 'tablica', label: 'Таблица', icon: 'table' },
          ],
        },
      )}</div>
    </div>
    ${chips({ id: 's10-vid', label: 'Вид ведомство', items: chipItems })}
    <p class="s10-count" id="s10-v-count" data-fk="s10-v-count" tabindex="-1">${p.count}</p>
  </div>`;
}

function vPanel(md, pm, ctx) {
  const q = clean(ctx.query.q);
  const p = vParts(md, ctx, q);
  return html`${unitSwitch(ctx, { name: 's10-unit', note: '„% от БВП“ е спрямо планирания БВП за 2026 г.' })}
    ${block({
      id: 's10-spisak',
      title: 'Всички ведомства',
      status: 'real',
      source: md.doc.meta?.source ?? SOURCE_V,
      asOf: md.asOf,
      scope: { key: 'zdb-vedomstva', label: 'Бюджети на ведомствата', note: 'не е целият бюджет' },
      tools: html`<p class="s10-tip">Натисни ведомство, за да видиш политиките и програмите му.</p>`,
      share: { table: () => exportV(md, ctx), text: 'Колко харчи всяко ведомство през 2026 г.' },
      body: html`${vFind(md, ctx, q, p)}<div id="s10-v-list" class="s10-list">${p.body}</div><div id="s10-v-notes" class="s10-notes small muted"${p.notes.s ? '' : html` hidden`}>${p.notes}</div>`,
    })}
    ${overview(md, pm, ctx)}
    ${sharesBlock(md, ctx)}`;
}

function pFind(pm, ctx, q, p) {
  const vedOptions = [
    { value: '', label: `Всички ведомства (${pm.kBudgets})` },
    ...pm.withProg.map((m) => ({ value: m.id, label: `${m.short || m.name} · ${m.id}` })),
  ];
  return html`<div class="s10-find" role="search" aria-label="Търсене и филтри на програмите">
    <div class="s10-controls s10-controls-p">
      ${field({ id: 's10-pq', label: 'Намери програма', hint: 'Дума от името, ведомство или код като „1300.01.01“.', control: textInput({ id: 's10-pq', name: 'pq', value: q, type: 'search', autocomplete: 'off', inputmode: 'search', hint: true }) })}
      ${field({ id: 's10-ved', label: 'Ведомство', control: selectInput({ id: 's10-ved', name: 'ved', value: pm.ved, options: vedOptions, query: 'ved' }) })}
      ${field({ id: 's10-pod', label: 'Подреди по', control: selectInput({ id: 's10-pod', name: 'pod', value: pm.sort, options: SORT_P, query: 'pod' }) })}
      <div class="field s10-view"><span class="field-label" aria-hidden="true">Покажи като</span>${seg(
        {
          name: 's10-lev',
          label: 'Покажи като',
          value: pm.level,
          query: 'nivo',
          options: [
            { value: 'programi', label: 'Програми', icon: 'list' },
            { value: 'politiki', label: 'По политики', icon: 'grid' },
          ],
        },
      )}</div>
    </div>
    <p class="s10-count" id="s10-p-count" data-fk="s10-p-count" tabindex="-1">${p.count}</p>
  </div>`;
}

function pPanel(md, pm, ctx) {
  if (!pm) {
    return block({
      id: 's10-programi',
      title: 'Програмите на ведомствата',
      status: 'pending',
      body: errorState({
        title: 'Програмите не се заредиха.',
        text: 'Опитай пак след малко. Бюджетите на ведомствата са в другия раздел.',
        retry: true,
      }),
    });
  }
  pm.ctx = ctx;
  const q = clean(ctx.query.pq);
  const p = pParts(pm, ctx, q, PAGE);
  const nValid = md.items.filter((m) => m.progCount !== null && !m.progDiffers).length;
  const diffList = listNames(md.items.filter((m) => m.progDiffers).map(plainName));
  return html`${block({
    id: 's10-programi',
    title: 'Програмите на ведомствата',
    status: 'partial',
    statusLabel: 'Официални данни, частично покритие',
    source: SOURCE_P,
    asOf: pm.asOf,
    scope: { key: 'prb-programi', label: 'Програмни бюджети', note: 'без ЕС и други средства' },
    sub: 'Всяка програма има име, код и сума за 2026 г. Натисни програма, за да видиш повече на страницата на ведомството.',
    share: { table: () => exportP(pm, ctx) },
    body: html`<div class="s10-intro">${disclosure({
      id: 's10-p-intro',
      title: 'Какво е бюджетна програма',
      body: html`
      <p>${gl('byudzhetna-programa', 'Бюджетната програма')} показва за какво точно харчи парите си едно ведомство. Програмите се събират в политики. Сумите тук са по бюджета на самото ведомство за 2026 г., без европейските и другите средства.</p>
      <p>За ${num(nValid, 0)} от ${num(pm.kBudgets, 0)} ведомства сборът на програмите е равен на бюджета им по закона.${diffList ? ` Изключение са ${diffList}: техните програмни бюджети са от проекта на закона и се различават от приетия закон.` : ''}</p>
    `,
    })}</div>
    ${pFind(pm, ctx, q, p)}<div id="s10-p-list" class="s10-list">${p.body}</div><div id="s10-p-notes" class="s10-notes small muted"${p.notes.s ? '' : html` hidden`}>${p.notes}</div>`,
  })}`;
}

/* ---------------------------------------------------------------- render */
export function render(ctx) {
  if (isFramework(ctx)) return institutionView(ctx);
  const md = model(ctx);
  if (!md.ok)
    return pendingState({
      title: 'Няма данни за ведомствата',
      text: 'Няма данни за избрания период.',
    });
  const pm = pModel(md, ctx);
  const tab = pick(ctx.query.tab, TABS, 'vedomstva');
  const ctxLine = html`<span class="ctx-period"><strong>${ctx.period.label}</strong> <span class="muted">· Бюджетите на ведомствата са по закона към ${date(md.asOf)} г.${pm?.asOf ? ` Програмите са по проекта на закона от ${date(pm.asOf)} г.` : ''}</span></span>`;
  return {
    lede: 'Министерствата и другите органи харчат парите от държавния бюджет за 2026 г. Тук виждаш колко харчи всеки, как се променя това спрямо 2025 г. и за какви програми отиват парите.',
    context: ctxLine,
    ownContext: true,
    body: html`${explorer(ctx, 'rashodi:vedomstva')}${tabs({
      id: 's10-tabs',
      label: 'Ведомства или програми',
      query: 'tab',
      active: tab,
      tabs: [
        { key: 'vedomstva', label: 'Ведомства', count: md.items.length, body: vPanel(md, pm, ctx) },
        {
          key: 'programi',
          label: 'Програми',
          count: pm ? pm.programs.length : undefined,
          body: pPanel(md, pm, ctx),
        },
      ],
    })}`,
  };
}

/* ---------------------------------------------------------------- behaviour: both searches filter in place, „Покажи още“ pages the programmes */
function liveSearch(input, key, ctx, paint, onEnter) {
  let timer = 0;
  let applied = clean(ctx.query[key]); // what the markup of render() already shows
  const apply = (say) => {
    const q = clean(input.value);
    if (q === applied) return false;
    applied = q;
    try {
      ctx.setQuery({ [key]: q }, { rerender: false });
    } catch {
      /* the address is a convenience, the filter already works */
    }
    paint(q, say);
    return true;
  };
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    apply(true);
  };
  const onInput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = 0;
      apply(true);
    }, 260);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && input.value) {
      e.preventDefault();
      input.value = '';
      flush();
      return;
    }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    flush();
    const q = clean(input.value);
    if (q) onEnter(q);
  };
  input.addEventListener('input', onInput);
  input.addEventListener('change', flush);
  input.addEventListener('blur', flush);
  input.addEventListener('keydown', onKey);
  return {
    clear() {
      input.value = '';
      flush();
      input.focus();
    },
    off() {
      clearTimeout(timer);
      input.removeEventListener('input', onInput);
      input.removeEventListener('change', flush);
      input.removeEventListener('blur', flush);
      input.removeEventListener('keydown', onKey);
    },
  };
}

/** a search opens the policies it found, so the matching programmes are in view at once (the list component does not open a policy by itself) */
const openMatches = (el, q) => {
  if (q)
    el.querySelectorAll('details.rank-det').forEach((d) => {
      d.open = true;
    });
};

export function mount(root, ctx) {
  if (isFramework(ctx)) return mountBillSearch(root, ctx);
  const md = model(ctx);
  if (!md.ok) return undefined;
  const pm = pModel(md, ctx);
  if (pm) pm.ctx = ctx;
  const offs = [bindUnitSwitch(root, ctx, 's10-unit')];
  const $ = (sel) => root.querySelector(sel);
  const searches = {};

  const vIn = $('#s10-q'),
    vListEl = $('#s10-v-list'),
    vCountEl = $('#s10-v-count'),
    vNotesEl = $('#s10-v-notes');
  if (vIn && vListEl) {
    const paintV = (q, say) => {
      const p = vParts(md, ctx, q);
      if (vCountEl) vCountEl.textContent = p.count;
      vListEl.innerHTML = p.body.s;
      if (vNotesEl) {
        vNotesEl.innerHTML = p.notes.s;
        vNotesEl.hidden = !p.notes.s;
      }
      if (say) ctx.announce?.(p.count);
    };
    searches.v = liveSearch(vIn, 'q', ctx, paintV, (q) => {
      const p = vParts(md, ctx, q);
      if (p.n === 1) ctx.go?.(ctx.href('vedomstvo', { code: p.rows[0].id }));
      else if (p.n > 1) vListEl.querySelector('a')?.focus();
    });
    offs.push(searches.v.off);
  }

  const pIn = $('#s10-pq'),
    pListEl = $('#s10-p-list'),
    pCountEl = $('#s10-p-count'),
    pNotesEl = $('#s10-p-notes');
  let limit = PAGE;
  let lastQ = clean(ctx.query.pq);
  if (pm && pIn && pListEl) {
    const paintP = (q, say, keepLimit) => {
      if (!keepLimit) limit = PAGE;
      lastQ = q;
      const p = pParts(pm, ctx, q, limit);
      if (pCountEl) pCountEl.textContent = p.count;
      pListEl.innerHTML = p.body.s;
      openMatches(pListEl, q);
      if (pNotesEl) {
        pNotesEl.innerHTML = p.notes.s;
        pNotesEl.hidden = !p.notes.s;
      }
      if (say) ctx.announce?.(p.count);
      return p;
    };
    openMatches(pListEl, lastQ);
    searches.p = liveSearch(
      pIn,
      'pq',
      ctx,
      (q, say) => paintP(q, say, false),
      (q) => {
        const p = pParts(pm, ctx, q, limit);
        if (p.flat && p.total === 1)
          ctx.go?.(
            ctx.href('vedomstvo', { code: p.tops[0].row.ministry, program: p.tops[0].row.code }),
          );
        else if (p.total) pListEl.querySelector('a, summary')?.focus();
      },
    );
    offs.push(searches.p.off);
    searches.page = () => {
      const before = limit;
      const wasOpen = [...pListEl.querySelectorAll('.rank-list > li')].map(
        (li) => !!li.querySelector('details[open]'),
      );
      limit += PAGE;
      const p = paintP(lastQ, false, true);
      const rows = pListEl.querySelectorAll('.rank-list > li');
      wasOpen.forEach((o, i) => {
        const d = o && rows[i]?.querySelector('details');
        if (d) d.open = true;
      }); // paging keeps the policies the visitor opened
      rows[before]?.querySelector('a, summary')?.focus();
      ctx.announce?.(`Показани са ${num(p.shownN, 0)} от ${num(p.total, 0)}.`);
    };
  }

  const onClick = (e) => {
    const b = e.target.closest?.('[data-action]');
    if (!b || !root.contains(b)) return;
    const a = b.dataset.action;
    if (a === 's10-clear-v') searches.v?.clear();
    else if (a === 's10-clear-p') searches.p?.clear();
    else if (a === 's10-more') searches.page?.();
    else if (a === 's10-all-groups') {
      b.dataset.fk = 's10-v-count';
      ctx.setQuery({ vid: '' });
    } else if (a === 's10-all-ved') {
      b.dataset.fk = 's10-p-count';
      ctx.setQuery({ ved: '' });
    }
  };
  root.addEventListener('click', onClick);
  offs.push(() => root.removeEventListener('click', onClick));
  return () =>
    offs.forEach((f) => {
      try {
        f?.();
      } catch {
        /* a cleanup must never throw */
      }
    });
}
