// S07 · Къде отиват парите? · #/razhodi · step 3 of 8 · next S12 · periods all
// Expenditure of the КФП in three cuts of the same total: by function (D03 Табл. III-1), by economic kind (D03 Annex 3) and by budget holder
// (D04, the 46 budgets of the 2026 law), plus the Eurostat COFOG history. Every number is computed from the data files, none is typed in;
// the editorial layer is only names, one-line explanations, the colour slots and which Annex 3 rows form a „вид разход“.
//   cuts (?po=)        funkcii · vid  (the third cut «Кой харчи» is /vedomstva)   views inside a cut (?izgled=)   grafika (list first, map second) · tablica · godini
//   Топ 5 (?top=)      najgolemi · rast-eur · rast-pct   detail panel of a map click (?izbor=<id>), one id space per tab
//   units              млн. € / % от БВП through the unit switch; „на човек“ and „и в лева“ through view.js (the COFOG history ignores „на човек“:
//                      the population series starts in 2020)
//   embeds             s07-fn · s07-vid · s07-top10 = bar charts of the first view of each tab in the host period
import { html, raw } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { explorer } from '../ui/explorer.js';
import { seg } from '../ui/seg.js';
import { chart } from '../ui/chart.js';
import { dataTable } from '../ui/table.js';
import { ranklist } from '../ui/ranklist.js';
import { treemapList } from '../ui/treemap-list.js';
import { callout, facts } from '../ui/cards.js';
import { field, selectInput } from '../ui/forms.js';
import { pendingState } from '../ui/states.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';
import { apportion } from '../calc.js';
import { yIndex, change, chartUnit, moneyCol, amount, amountParts, perCapita, periodStatus } from '../view.js';
import { num, pct, money, delta, date, DASH, NBSP, MINUS } from '../format.js';

export const needs = ['core', 'expenditure', 'ministries?', 'execution?', 'glossary?'];
export const styles = ['s07-razhodi'];

const yr = y => `${y}${NBSP}г.`;
const ok = v => typeof v === 'number' && Number.isFinite(v);
const upper = s => (s ? s[0].toUpperCase() + s.slice(1) : s);
const tidy = (x, k = 1) => Math.round(x * 10 ** k) / 10 ** k;
const shareOf = (a, b) => (ok(a) && ok(b) && b > 0 ? (a / b) * 100 : null);
const slot = i => (i < 8 ? i + 1 : 'other');
const WORD = { actual: 'отчет', prelim: 'предв.\nотчет', plan: 'план', forecast: 'прогноза' };
const FLAT = { actual: 'отчет', prelim: 'предв. отчет', plan: 'план', forecast: 'прогноза' };
const VS = { actual: 'отчета', prelim: 'предварителния отчет', plan: 'плана', forecast: 'прогнозата' };
const MIN_BASE = 100;           // млн. € of the 2025 base under which a percentage ranking is not shown: a tiny budget would top it with a tiny sum
const TOP = 10;                 // budgets shown in „Кой харчи“
const NEST = true;              // parts of a function / group as nested rectangles on the map

/** Editorial layer: what is inside a function (the numbers come from the data; these are plain-language one-liners). */
const FN_WHAT = {
  'obshti-sluzhbi': 'Изпълнителната и законодателната власт, общите служби и науката.',
  'otbrana-sigurnost': 'Отбраната, полицията и вътрешният ред, съдебната власт, затворите и защитата при бедствия.',
  obrazovanie: 'Детските градини, училищата, университетите и другите образователни дейности.',
  zdraveopazvane: 'Лечението, болниците и общественото здраве.',
  sotsialni: 'Пенсиите, социалните помощи и обезщетения, грижите и заетостта.',
  'zhilishtno-sreda': 'Благоустройството и комуналните услуги, жилищното строителство и опазването на околната среда.',
  'kultura-sport': 'Културата, спорта, почивните дейности и религиозното дело.',
  ikonomika: 'Транспорта, енергетиката, селското стопанство, туризма и другите икономически дейности.',
  drugi: 'Разходите, които не се вписват в другите функции.'
};
/** short names of the Eurostat COFOG divisions (the data carries the long official ones) */
const COFOG_SHORT = { GF01: 'Общи държавни служби', GF02: 'Отбрана', GF03: 'Ред и сигурност', GF04: 'Икономически дейности', GF05: 'Околна среда', GF06: 'Жилищно и комунално', GF07: 'Здравеопазване', GF08: 'Култура и отдих', GF09: 'Образование', GF10: 'Социална защита' };

/** The eight „вид разход“ groups: which Annex 3 rows form each. The first six and the reserve are exactly the „Разходи“ row (x.exp, without the EU
 *  contribution); with the contribution they are the „Общо разходи“ row (x.total): the total of this cut, and the base of the monthly execution report. */
const VID = [
  { id: 'personal', short: 'Персонал', name: 'Персонал', rows: ['x.personnel'], parts: ['x.wages', 'x.otherpay', 'x.insurance'],
    what: 'Заплатите и осигуровките на хората, които работят за държавата: учители, полицаи, военни, служители в администрацията.' },
  { id: 'izdarzhka', short: 'Издръжка', name: 'Издръжка', rows: ['x.maint'], parts: [],
    what: 'Парите, с които институциите работят всеки ден: ток и отопление, материали, външни услуги, текущи ремонти и командировки.' },
  { id: 'socialni', short: 'Социални плащания', name: 'Социални и здравноосигурителни плащания', rows: ['x.social', 'x.scholarships'], parts: ['x.pensions', 'x.household', 'x.health', 'x.scholarships'],
    what: 'Пенсиите, помощите и обезщетенията, плащанията на здравната каса за лечение и стипендиите.' },
  { id: 'subsidii', short: 'Субсидии', name: 'Субсидии и други текущи трансфери', rows: ['x.subsidies'], parts: ['x.subsidies.main', 'x.subsidies.hospital'], gl: 'subsidiya',
    what: 'Пари за фирми и организации за определена дейност, без държавата да получава стока или услуга срещу тях. Отделно е субсидията за болнична помощ.' },
  { id: 'kapitalovi', short: 'Капиталови разходи', name: 'Капиталови разходи', rows: ['x.capex'], parts: [], gl: 'kapitalovi-razhodi',
    what: 'Парите за пътища, сгради, оборудване и други неща, които траят дълго.' },
  { id: 'lihvi', short: 'Лихви', name: 'Лихви по държавния дълг', rows: ['x.interest'], parts: ['x.interest.ext', 'x.interest.dom'], gl: 'lihva',
    what: 'Цената на заетите досега пари: лихвите по външния и по вътрешния дълг.' },
  { id: 'eu', short: 'Вноска в ЕС', name: 'Вноска в бюджета на ЕС', rows: ['x.eucontrib'], parts: [],
    what: 'Парите, които България внася в общия бюджет на Европейския съюз. Не са част от нито една бюджетна функция.' },
  { id: 'rezerv', short: 'Резерв и други', name: 'Резерв и други', rows: ['x.contingency', 'x.reserve', 'x.abroad'], parts: ['x.contingency', 'x.reserve', 'x.abroad'],
    what: 'Резервът за непредвидени и неотложни разходи, държавният резерв и изкупуването на земеделска продукция, трансферите към чужбина.' }
];
const PART = {
  'x.household': 'Помощи и обезщетения за домакинствата', 'x.subsidies.main': 'Субсидии и други текущи трансфери', 'x.subsidies.hospital': 'Субсидии за болнична помощ',
  'x.contingency': 'Резерв за непредвидени и неотложни разходи', 'x.reserve': 'Държавен резерв и изкупуване на земеделска продукция', 'x.abroad': 'Трансфери за чужбина'
};
/** the line of the monthly report that belongs to each group (the contingency reserve has no cumulative line there) */
const EXEC = { personal: 'exp.personnel', izdarzhka: 'exp.maint', socialni: 'exp.social', subsidii: 'exp.subsidies', lihvi: 'exp.interest', kapitalovi: 'exp.capex', eu: 'eucontrib' };

// ── models ─────────────────────────────────────────────────────────────────────────────────────────────
/** the fields every cut shares: shares of the total (apportioned to 100,0), the ranking, the selected year and the one before */
function finish(fm) {
  const vals = fm.items.map(x => x.val);
  const shares = apportion(vals, 100, 1);
  const sum = vals.reduce((a, v) => a + (ok(v) ? v : 0), 0);
  fm.items.forEach((x, i) => { x.rawShare = sum > 0 && ok(x.val) ? (x.val / sum) * 100 : null; x.share = ok(x.val) ? shares[i] ?? null : null; });
  fm.sum = sum;
  fm.ranked = fm.items.slice().sort((a, b) => (ok(b.val) ? b.val : -1) - (ok(a.val) ? a.val : -1));
  fm.year = fm.years[fm.sel];
  fm.prevYear = fm.prev >= 0 ? fm.years[fm.prev] : null;
  fm.total = fm.totalMln?.[fm.sel] ?? null;
  fm.totalPgs = fm.totalPg;                                   // the series; totalPg becomes the selected year's value
  fm.totalPg = fm.totalPgs?.[fm.sel] ?? null;
  fm.totalBefore = fm.prev >= 0 ? fm.totalMln?.[fm.prev] ?? null : null;
  fm.byId = new Map(fm.items.map(x => [x.id, x]));
  return fm;
}
const stepOf = (val, before) => ({ yoy: change(val, before), diff: ok(val) && ok(before) ? tidy(val - before, 1) : null });

/** КФП by function (Табл. III-1 of the motives); null when the period has no column in it (2024) */
function kfpModel(ctx) {
  const F = ctx.data?.expenditure?.functions;
  if (!F || !Array.isArray(F.years) || !Array.isArray(F.items) || !F.items.length) return null;
  const sel = yIndex(F.years, ctx);
  if (sel < 0) return null;
  const prev = sel > 0 ? sel - 1 : -1;
  const labels = F.yearLabels || F.years.map(String);
  const items = F.items.map((it, i) => {
    const mln = it.mln || [], pg = it.pctGdp || [];
    const val = mln[sel] ?? null, before = prev >= 0 ? mln[prev] ?? null : null;
    return {
      id: it.id, c: slot(i), label: it.short || it.name, name: it.name, mln, pg, val, pgSel: pg[sel] ?? null, before, ...stepOf(val, before),
      parts: (it.parts || []).map(p => ({ label: upper(p.name), mln: p.mln?.[sel] ?? null, pg: ok(pg[sel]) && ok(val) && val > 0 && ok(p.mln?.[sel]) ? tidy((pg[sel] * p.mln[sel]) / val, 3) : null })).filter(p => ok(p.mln)),
      gl: it.glossary ?? null, what: FN_WHAT[it.id] ?? '', href: ctx.href('S08', { fn: it.id })
    };
  });
  return finish({
    kind: 'kfp', F, kinds: F.vintage || [], years: F.years, sel, prev, items, totalMln: F.totalMln, totalPg: F.totalPctGdp,
    prevWord: prev === 0 ? 'програмата' : VS[F.vintage?.[prev]] ?? '',
    cats: labels.map(l => String(l).replace(/^(\d{4}) /, '$1\n')),
    flat: labels.map(l => String(l).replace(/^(\d{4}) (.+)$/, (m, y, w) => `${y} (${w.toLowerCase()})`)),
    asOf: ctx.data.expenditure.meta?.asOf
  });
}

/** Eurostat COFOG (sector „Държавно управление“), 2015–2024. `sel` is -1 when the period year is not in it (the history block still draws). */
function cofogModel(ctx) {
  const C = ctx.data?.expenditure?.cofog;
  if (!C || !Array.isArray(C.years) || !Array.isArray(C.items) || !C.total?.mln) return null;
  const sel = yIndex(C.years, ctx);
  const last = C.years.length - 1;
  const at = sel >= 0 ? sel : last;
  const prev = at > 0 ? at - 1 : -1;
  const items = C.items.filter(it => !it.memoOf).map((it, i) => {
    const mln = it.mln || [], pg = it.pctGdp || [];
    const val = mln[at] ?? null, before = prev >= 0 ? mln[prev] ?? null : null;
    return { id: it.code, c: slot(i), label: COFOG_SHORT[it.code] ?? it.name, name: it.name, mln, pg, val, pgSel: pg[at] ?? null, before, ...stepOf(val, before), parts: [], href: null };
  });
  // colour slots by the size of the division in the latest year: the five biggest keep their colours in the history chart, the rest turn grey
  items.sort((a, b) => (b.mln[last] ?? 0) - (a.mln[last] ?? 0));
  items.forEach((x, r) => { x.c = slot(r); });                 // the map colours its rectangles by position: rank order = colour order
  const fm = finish({
    kind: 'cofog', C, kinds: [], years: C.years, sel: at, inRange: sel >= 0, prev, items, totalMln: C.total.mln, totalPg: C.total.pctGdp, prevWord: '',
    cats: C.years.map(String), flat: C.years.map(String), asOf: C.asOf
  });
  fm.debt = C.items.find(it => it.memoOf);
  return fm;
}

/** КФП by economic kind (Annex 3), grouped into the seven VID groups */
function ecoModel(ctx) {
  const X = ctx.data?.expenditure?.economic;
  if (!X || !Array.isArray(X.years) || !Array.isArray(X.rows)) return null;
  const sel = yIndex(X.years, ctx);
  if (sel < 0) return null;
  const prev = sel > 0 ? sel - 1 : -1;
  const kinds = X.vintage || [];
  const rows = new Map(X.rows.map(r => [r.id, r]));
  const exp = rows.get('x.exp'), all = rows.get('x.total');
  if (!exp?.mln || !all?.mln) return null;
  const series = (ids, key) => X.years.map((y, i) => {
    const vs = ids.map(id => rows.get(id)?.[key]?.[i]);
    return vs.length && vs.every(ok) ? tidy(vs.reduce((a, b) => a + b, 0), 1) : null;
  });
  const gloss = new Map((ctx.data?.glossary?.terms || []).map(t => [t.slug, t]));
  const items = VID.map((g, i) => {
    const mln = series(g.rows, 'mln'), pg = series(g.rows, 'pctGdp');
    const val = mln[sel] ?? null, before = prev >= 0 ? mln[prev] ?? null : null;
    const parts = g.parts.map(id => rows.get(id)).filter(Boolean).map(r => ({ id: r.id, label: PART[r.id] ?? upper(r.label), mln: r.mln?.[sel] ?? null, pg: r.pctGdp?.[sel] ?? null, all: r.mln, allPg: r.pctGdp })).filter(p => ok(p.mln));
    return { id: g.id, c: slot(i), label: g.short, name: g.name, mln, pg, val, pgSel: pg[sel] ?? null, before, ...stepOf(val, before), parts, what: g.what, term: g.gl ? gloss.get(g.gl) ?? null : null, href: null };
  });
  const fm = finish({
    kind: 'eco', years: X.years, kinds, sel, prev, items, totalMln: all.mln, totalPg: all.pctGdp, prevWord: VS[kinds[prev]] ?? '',
    cats: X.years.map((y, i) => (WORD[kinds[i]] ? `${y}\n${WORD[kinds[i]]}` : String(y))),
    flat: X.years.map((y, i) => (FLAT[kinds[i]] ? `${y} (${FLAT[kinds[i]]})` : String(y))),
    asOf: ctx.data.expenditure.meta?.asOf
  });
  fm.rows = rows;
  fm.kind0 = kinds[sel] ?? 'plan';
  fm.prevKind = prev >= 0 ? kinds[prev] ?? null : null;
  fm.noEu = exp.mln?.[sel] ?? null;                              // „Разходи“ without the EU contribution (= the sum of the functions in 2026–2028)
  fm.noEuPg = exp.pctGdp?.[sel] ?? null;
  fm.eu = fm.byId.get('eu') ?? null;
  return fm;
}

/** the budgets of the 2026 law (D04): the TOP largest and the rest, always 2026 (the law has no other period) */
function minModel(ctx) {
  const M = ctx.data?.ministries, gdp = ctx.core?.kpis?.gdp?.mln;
  if (!M || !Array.isArray(M.items) || !M.items.length || !ok(M.totals?.expKhil)) return null;
  // „Закон 2025“ is a like-for-like base only when change.basis is 'law'; for the three programme-budget rows the published percentage is on the
  // bill's own columns (it differs from law-vs-law), so they show that percentage with an asterisk and no euro difference
  const items = M.items.filter(x => ok(x.expKhil)).map(x => {
    const val = tidy(x.expKhil / 1000, 4), basis = x.change?.basis ?? null;
    const base = ok(x.exp2025Khil) ? tidy(x.exp2025Khil / 1000, 4) : null, before = basis === 'law' ? base : null;
    return {
      id: x.id, label: x.short || x.name, name: x.name, short: x.short || x.name, kind: M.kinds?.[x.kind] ?? '', val, before, base, pgSel: ok(gdp) && gdp > 0 ? (val / gdp) * 100 : null,
      mln: [before, val], yoy: ok(x.change?.pct) ? x.change.pct : null, diff: stepOf(val, before).diff, basis, href: ctx.href('S11', { code: x.id })
    };
  });
  const ranked = items.slice().sort((a, b) => b.val - a.val);
  const top = ranked.slice(0, TOP), rest = ranked.slice(TOP);
  const total = tidy(M.totals.expKhil / 1000, 4);
  const restVal = tidy(rest.reduce((a, x) => a + x.val, 0), 4);
  const topItems = top.slice();
  const restItem = rest.length ? { id: 'rest', c: 'other', label: `Останалите ${num(rest.length, 0)} бюджета`, name: `Останалите ${num(rest.length, 0)} бюджета`, val: restVal, before: null, pgSel: ok(gdp) && gdp > 0 ? (restVal / gdp) * 100 : null, mln: [null, restVal], yoy: null, diff: null, href: ctx.href('S10', {}, { tab: 'vedomstva' }), rest: true } : null;
  const shown = restItem ? [...topItems, restItem] : topItems;
  // one apportionment over all budgets, so the map, the list, the panel and the table print the same share; the rest row is the sum of its budgets' shares
  const shares = apportion(ranked.map(x => x.val), 100, 1);
  ranked.forEach((x, i) => { x.rawShare = shareOf(x.val, total); x.share = shares[i] ?? null; });
  if (restItem) { restItem.rawShare = shareOf(restItem.val, total); restItem.share = tidy(rest.reduce((a, x) => a + (x.share ?? 0), 0), 1); }
  shown.forEach((x, i) => { x.c = x.rest ? 'other' : slot(i); });
  const year = Number(String(M.meta?.asOf || '').slice(0, 4)) || 2026;
  return { M, year, items, ranked, top, rest, restItem, shown, total, count: M.totals.count ?? items.length, gdp, asOf: M.meta?.asOf, byId: new Map(shown.map(x => [x.id, x])),
    basisNames: top.filter(x => x.basis === 'program-budget').map(x => x.short || x.label), noBase: top.filter(x => !ok(x.before)).map(x => x.short || x.label) };
}

// ── small pieces ───────────────────────────────────────────────────────────────────────────────────────
/** „+1,23 млрд. €“ / „−85,40 млн. €“: a difference of two sums, always in the money format (never per person) */
const signedMoney = mln => {
  if (!ok(mln)) return DASH;
  const t = money(Math.abs(mln));
  return (/^0(,0+)?\u00a0/.test(t) ? '' : mln > 0 ? '+' : MINUS) + t;
};
/** a money cell: the number in the table's unit, the leva addendum (when „и в лева“ is on) on a second line */
const moneyCell = (mc, mln) => html`${mc.text(mln)}${mc.lev(mln) ? html`<span class="s07-lev">${mc.lev(mln)}</span>` : ''}`;
/** an amount of the Eurostat history: euro (or % от БВП), never „на човек“ (the population series starts in 2020) */
const histAmount = (ctx, mln, pg) => {
  if (!ok(mln)) return DASH;
  if (ctx.store.get('unit') === 'pct' && ok(pg)) return `${pct(pg, 1)}${NBSP}от БВП`;
  return money(mln, { leva: !!ctx.store.get('leva') });
};
/** the table twin of a chart whose axis labels wrap onto several lines: the same rows, labelled on one line (feeds the screen twin and the CSV) */
function oneLine(spec, labels) {
  const columns = [{ key: 'c', label: spec.categoryLabel || 'Категория' }, ...spec.series.map((x, i) => ({ key: `s${i}`, label: x.name, unit: spec.unit, d: spec.d, num: true, fmt: v => (ok(v) ? spec.fmt(v) : DASH) }))];
  const rows = labels.map((c, j) => Object.fromEntries([['c', c], ...spec.series.map((x, i) => [`s${i}`, x.data[j] ?? null])]));
  return { columns, rows };
}
const vsHead = fm => (fm.prev >= 0 ? `Спрямо ${yr(fm.prevYear)}` : '');
/** „спрямо програмата за 2025 г.“: the sentence form of the same comparison */
const vsText = fm => (fm.prev >= 0 ? `спрямо ${fm.prevWord ? `${fm.prevWord} за ` : ''}${yr(fm.prevYear)}` : '');
const maxOf = lists => Math.max(0, ...lists.flat().filter(ok));
const lvOn = ctx => !!ctx.store.get('leva');
const personOn = ctx => !!ctx.store.get('perPerson');
const HIST_NOTE = '„На човек“ не се показва за годините назад: населението се е променяло.';
/** the words that change with the cut: КФП functions · Eurostat divisions · КФП by economic kind (the budgets have their own builders) */
const KIND_TXT = {
  kfp: { map: 'Разходи по функции', cat: 'Функция', cap: 'Разходи по функции', total: 'Общо', share: 'Дял от разходите' },
  cofog: { map: 'Разходи по функции на държавното управление', cat: 'Функция (COFOG)', cap: 'Разходи по функции (COFOG)', total: 'Общо (публикуван ред)', share: 'Дял от разходите' },
  eco: { map: 'Разходи по вид', cat: 'Вид разход', cap: 'Разходи по вид', total: 'Общо разходи, с вноската в ЕС', share: 'Дял от разходите' },
  min: { map: 'Разходи по бюджети', cat: 'Бюджет', cap: 'Разходи по бюджети', total: 'Всички бюджета', share: 'Дял от държавния бюджет' }
};

/** the rows of a treemap/ranklist: value in the selected unit (u.conv), mln/pctGdp kept so the text is computed again with „на човек“ and „лв.“ */
const mapItems = (u, items, withParts) => items.map(x => ({
  id: x.id, label: x.label, sub: x.what || (x.name && x.name !== x.label ? x.name : undefined), value: u.conv(x.val, x.pgSel), mln: x.val, pctGdp: x.pgSel, share: x.share, href: x.href || undefined,
  children: withParts && x.parts?.length > 1 ? x.parts.map(p => ({ label: p.label, value: u.conv(p.mln, p.pg), mln: p.mln, pctGdp: p.pg, pid: x.id })) : undefined
}));
const fmtFor = (ctx, u, hist) => (v, it) => (it ? (hist ? histAmount(ctx, it.mln, it.pctGdp) : amount(ctx, { mln: it.mln, pctGdp: it.pctGdp })) : u.fmt(v));

// ── the detail panel of a map click ────────────────────────────────────────────────────────────────────
/** one panel per item; all are in the page, one is visible (the others `hidden`); mount() switches them */
const pane = (x, hidden, { what, rows, parts, foot } = {}) => html`<div class="s07-pane" data-key="${x.id}" data-title="${x.label}"${hidden ? raw(' hidden') : ''}>
  <h3 class="s07-pane-title"><span class="s07-sw" data-c="${x.c}" aria-hidden="true"></span>${x.name || x.label}</h3>
  ${what ? html`<p class="s07-pane-what">${what}</p>` : ''}${facts(rows || [])}${parts || ''}${foot || ''}
</div>`;
/** the three biggest parts of an item */
const partsList = parts => {
  const top = (parts || []).filter(p => ok(p.mln)).sort((a, b) => b.mln - a.mln).slice(0, 3);
  return top.length ? html`<h4 class="s07-pane-sub">Най-големи пера</h4><ul class="s07-parts">${top.map(p => html`<li><span>${p.label}</span><strong class="num">${money(p.mln)}</strong></li>`)}</ul>` : '';
};
const factRows = (ctx, fm, x, extra = []) => {
  const per = perCapita(ctx, x.val), T = KIND_TXT[fm.kind];
  const star = x.basis === 'program-budget' ? '*' : '';
  const vs = ok(x.yoy) ? html`${delta(x.yoy, 1)}${star}${ok(x.diff) ? ` (${signedMoney(x.diff)})` : ''}` : fm.kind === 'min' && !x.rest ? 'Няма сравнима база' : null;
  return [
    { k: 'Сума', v: ok(x.val) ? money(x.val, { leva: lvOn(ctx) }) : null },
    { k: T.share, v: ok(x.share) ? pct(x.share, 1) : null },
    { k: '% от БВП', v: ok(x.pgSel) ? pct(x.pgSel, 1) : null },
    { k: 'На човек за година', v: fm.kind === 'cofog' || per === DASH ? null : per },
    { k: vsHead(fm), v: vs },
    ...extra
  ];
};
const goLink = (href, label) => html`<p class="s07-pane-go"><a class="btn btn-sm" href="${href}">${label}<span aria-hidden="true"> →</span></a></p>`;

/** the side column: the picker (the keyboard and phone way to the same panels) and the panels */
function side(key, items, sel, paneOf) {
  return html`<aside class="s07-side" aria-label="Подробности за избрания ред">
    ${field({ id: `s07-pick-${key}`, label: 'Покажи подробности за', control: selectInput({ id: `s07-pick-${key}`, options: items.map(x => ({ value: x.id, label: x.label })), value: sel }) })}
    <div class="s07-panes">${items.map(x => paneOf(x, x.id !== sel))}</div>
  </aside>`;
}
const selOf = (ctx, items) => {
  const q = String(ctx.query?.izbor ?? '');
  return items.find(x => x.id === q)?.id ?? items[0]?.id ?? null;
};

/** the names of the КФП functions that a Eurostat division overlaps, as links to their screens */
function kfpLinks(ctx, ids) {
  const byId = new Map((ctx.data?.expenditure?.functions?.items || []).map(f => [f.id, f]));
  const list = (ids || []).map(id => byId.get(id)).filter(Boolean);
  if (!list.length) return '';
  return html`<p class="small muted">Припокрива се с функции от бюджета: ${list.map((f, i) => html`${i ? ', ' : ''}<a href="${ctx.href('S08', { fn: f.id })}">${f.short || f.name}</a>`)}.</p>`;
}

// ── by function: the КФП (Табл. III-1) and the Eurostat history ───────────────────────────────────────
function fnPane(ctx, fm, x, hidden) {
  const cofog = fm.kind === 'cofog';
  const foot = cofog
    ? kfpLinks(ctx, fm.C.items.find(it => it.code === x.id)?.kfpFunctions)
    : html`${goLink(x.href, 'Отвори функцията')}`;
  return pane(x, hidden, {
    what: x.what || '', rows: factRows(ctx, fm, x), parts: partsList(x.parts),
    foot
  });
}

function fnMap(ctx, fm, key = 'funkcii', paneOf = fnPane) {
  const hist = fm.kind === 'cofog', T = KIND_TXT[fm.kind];
  const u = chartUnit(ctx, { pct: true, max: maxOf([fm.items.map(x => x.val)]), person: !hist });
  const sel = selOf(ctx, fm.ranked);
  const tm = treemapList({
    id: `s07-map-${key}`, label: T.map, unit: 'num', unitLabel: u.unit, d: u.d, fmt: fmtFor(ctx, u, hist),
    categoryLabel: T.cat, sort: 'desc', shares: true, pie: true, defaultView: 'list', items: mapItems(u, fm.items, NEST && !hist)
  });
  return html`<div class="s07-split" data-key="${key}"><div class="s07-main">${tm}</div>${side(key, fm.ranked, sel, (x, hidden) => paneOf(ctx, fm, x, hidden))}</div>`;
}

function fnTable(ctx, fm, key = 'funkcii') {
  const hist = fm.kind === 'cofog', T = KIND_TXT[fm.kind];
  const mc = moneyCol(ctx, { person: !hist });
  const rows = (fm.all ?? fm.ranked).map(x => ({ name: x.name || x.label, mln: x.val, v: mc.raw(x.val), share: x.share, pg: x.pgSel, yoy: x.yoy, star: x.basis === 'program-budget' ? '*' : '', _href: x.href || undefined }));
  const columns = [
    { key: 'name', label: T.cat },
    { key: 'v', label: 'Разходи', unit: mc.unit, d: mc.d, fmt: (v, row) => moneyCell(mc, row.mln) },
    { key: 'share', label: T.share, unit: '%', d: 1 },
    { key: 'pg', label: '% от БВП', d: 1 },
    ...(fm.prev >= 0 ? [{ key: 'yoy', label: vsHead(fm), fmt: (v, row) => (ok(v) ? html`${delta(v, 1)}${row.star || ''}` : DASH) }] : [])
  ];
  const total = { label: T.total, values: { mln: fm.total, v: mc.raw(fm.total), share: ok(fm.sum) && fm.sum > 0 ? 100 : null, pg: fm.totalPg, yoy: change(fm.total, fm.totalBefore) } };
  return dataTable({
    id: `s07-tbl-${key}`, caption: `${T.cap}, ${yr(fm.year)}`, columns, rows, sortable: true, total, note: tableNote(fm)
  });
}

/** what to say under a by-function table: the rounding of the source and, for the КФП, the base of the comparison */
function tableNote(fm) {
  const out = [];
  const d = ok(fm.total) ? Math.abs(fm.sum - fm.total) : 0;
  if (fm.kind === 'cofog') {
    if (d > 0.05) out.push(`Сборът на десетте функции (${num(fm.sum, 1)} млн. €) се различава от публикувания общ ред (${num(fm.total, 1)} млн. €) с ${num(d, 1)} млн. € заради закръгляването в източника.`);
    const debt = fm.debt?.mln?.[fm.sel];
    if (ok(debt)) out.push(`„Операции с публичния дълг“ (${num(debt, 1)} млн. € през ${yr(fm.year)}) е част от „Общи държавни служби“.`);
  } else if (fm.kind === 'eco') {
    if (ok(fm.eu?.val) && ok(fm.noEu)) out.push(`Без вноската в бюджета на ЕС (${num(fm.eu.val, 1)} млн. €) разходите са ${num(fm.noEu, 1)} млн. €: толкова са и разходите по функции.`);
    if (d > 0.05) out.push(`Сборът на групите (${num(fm.sum, 1)} млн. €) се различава от общия ред (${num(fm.total, 1)} млн. €) с ${num(d, 1)} млн. € заради закръгляването в източника.`);
  } else if (fm.kind === 'min') {
    const M = fm.mm, names = a => (a.length > 1 ? `${a.slice(0, -1).join(', ')} и ${a[a.length - 1]}` : a[0]);
    const star = M.items.filter(x => x.basis === 'program-budget').map(x => x.short), none = M.items.filter(x => !ok(x.before) && x.basis !== 'program-budget').map(x => x.short);
    if (star.length) out.push(`* ${names(star)}: процентът е по колоните на законопроекта (програмен бюджет), затова няма сума за сравнение с ${yr(fm.prevYear)}.`);
    if (none.length) out.push(`Няма сравнима основа за ${yr(fm.prevYear)}: ${names(none)}.`);
  } else {
    const r = fm.F.reconcile;
    if (fm.sel === 0 && ok(r?.annex3ExpenditureMln?.[0])) out.push(`Колоната е програмата за ${yr(fm.year)} (${num(fm.total, 1)} млн. €), а не предварителният отчет (${num(r.annex3ExpenditureMln[0], 1)} млн. €): разликата е ${num(r.diffMln?.[0], 1)} млн. €.`);
    else if (fm.prev === 0 && ok(r?.annex3ExpenditureMln?.[0])) out.push(`Сравнението е с програмата за ${yr(fm.prevYear)} (${num(fm.totalBefore, 1)} млн. €), а не с предварителния отчет (${num(r.annex3ExpenditureMln[0], 1)} млн. €).`);
    if (d > 0.05) out.push(`Сборът на деветте функции (${num(fm.sum, 1)} млн. €) се различава от общия ред (${num(fm.total, 1)} млн. €) с ${num(d, 1)} млн. € заради закръгляването в източника.`);
  }
  return out.join(' ');
}

/** stacked columns by year: one segment per item, the same colour slot as on the map */
function stackSpec(ctx, fm, o) {
  const hist = fm.kind === 'cofog';
  const u = chartUnit(ctx, { pct: true, max: maxOf([fm.totalMln]), person: !hist });
  const order = o.items ?? fm.items;
  const span = `${fm.years[0]}–${fm.years[fm.years.length - 1]}`;
  const spec = {
    id: o.id, type: 'bar', stack: true, title: o.title(span), sub: `В ${u.unit}.${o.sub ? ` ${o.sub}` : ''}`,
    unit: u.unit, d: u.d, fmt: u.fmt, option: u.option(false),
    categories: fm.cats, categoryLabel: 'Година',
    series: order.map(x => ({ name: x.label, color: x.c, data: x.mln.map((v, i) => u.conv(v, x.pg[i])) })),
    labels: false, legend: true, height: 360, views: ['bars', 'line'],
    desc: `Наслагани колони по години (${span}). Точните числа са в таблицата под графиката.`
  };
  spec.table = oneLine(spec, fm.flat);
  return { spec, u };
}

function yearsTable(ctx, fm, o) {
  const hist = fm.kind === 'cofog';
  const mc = moneyCol(ctx, { person: !hist });
  const asPct = chartUnit(ctx, { pct: true, max: 0, person: !hist }).kind === 'pct';
  const cells = (mln, pg) => Object.fromEntries(fm.years.map((y, i) => [`y${i}`, asPct ? pg?.[i] ?? null : mc.raw(mln?.[i] ?? null)]));
  const columns = [{ key: 'name', label: o.head }, ...fm.years.map((y, i) => ({
    key: `y${i}`, label: fm.flat[i], fmt: (v, row) => (asPct ? (ok(v) ? num(v, 1) : DASH) : moneyCell(mc, row.mlns?.[i]))
  }))];
  const rows = (o.items ?? fm.items).map(x => ({ name: x.label, mlns: x.mln, ...cells(x.mln, x.pg), _href: x.href || undefined }));
  return dataTable({
    id: o.id, caption: `${o.caption}, ${asPct ? '% от БВП' : mc.unit}`, captionVisible: true, columns, rows,
    total: { label: o.totalLabel, values: { mlns: fm.totalMln, ...cells(fm.totalMln, fm.totalPgs) } }, note: o.note || ''
  });
}

// ── by year ────────────────────────────────────────────────────────────────────────────────────────────
/** what to say under a by-year table: forecast years, the 2025 programme, the EU contribution, the Eurostat method */
function yearsNote(fm) {
  const out = [], f = fm.kinds.indexOf('forecast'), r = fm.F?.reconcile;
  if (f > 0) out.push(`${fm.years.slice(f).join(' и ')} са прогноза на Министерството на финансите, не приет план.`);
  if (fm.kind === 'kfp' && ok(r?.annex3ExpenditureMln?.[0]) && ok(fm.totalMln?.[0])) out.push(`Колоната за ${yr(fm.years[0])} е програмата от таблицата към проекта (${num(fm.totalMln[0], 1)} млн. €), а не предварителният отчет (${num(r.annex3ExpenditureMln[0], 1)} млн. €).`);
  if (fm.kind === 'eco') out.push('Общите разходи включват вноската в бюджета на ЕС: тя не е част от нито една функция.');
  if (fm.kind === 'cofog' && fm.C?.note) out.push(fm.C.note);
  return out.join(' ');
}
function yearsView(ctx, fm, key) {
  const T = KIND_TXT[fm.kind];
  const { spec } = stackSpec(ctx, fm, { id: `s07-yr-${key}`, title: span => `${T.map} по години, ${span}`, sub: fm.kind === 'cofog' ? HIST_NOTE : '', items: fm.ranked });
  return html`${chart(spec)}${yearsTable(ctx, fm, { id: `s07-ytbl-${key}`, head: T.cat, caption: `${T.cap} по години`, totalLabel: T.total, note: yearsNote(fm), items: fm.ranked })}`;
}
const COFOG_SCOPE = { key: 'cofog', label: 'Евростат · COFOG', note: 'друг разрез от КФП', gl: 'sektor-darzhavno-upravlenie' };
const MIN_SCOPE = { key: 'dbudget', label: 'Държавен бюджет', note: 'не цялата КФП' };
/** the three views of a cut: Разпределение (the list with bars first, the map second) / Таблица / По години, chosen with ?izgled= */
/** a „Покажи като“ switch (seg, ?query=…) and only the chosen body, built on demand: a hidden chart in a hidden panel cannot be measured, and the screen already has the outer tabs */
const picker = (ctx, name, label, query, list) => {
  const cur = list.find(t => t.key === String(ctx.query[query] ?? '')) ?? list[0];
  return html`<div class="field s07-view"><span class="field-label" aria-hidden="true">${label}</span>${seg({ name, label, value: cur.key, query, cls: 's07-seg', options: list.map(t => ({ value: t.key, label: t.label })) })}</div>${cur.body()}`;
};
const views = (ctx, key, label, list) => picker(ctx, `s07-v-${key}`, 'Покажи като', 'izgled', list);

// ── the three cuts ─────────────────────────────────────────────────────────────────────────────────────
function fnBlock(ctx, fm) {
  const hist = fm.kind === 'cofog';
  return block({
    id: 's07-fn', title: `${hist ? 'Разходи по функции на държавното управление' : 'За какво отиват парите'}, ${yr(fm.year)}`,
    scope: hist ? COFOG_SCOPE : 'kfp', status: hist ? 'real' : periodStatus(ctx), source: hist ? ['eurostat'] : ['asbp'], asOf: fm.asOf,
    sub: hist ? 'За тази година разбивка по функции има само от Евростат, по друга методика от тази на бюджета.' : 'Деветте функции на бюджета. Натисни правоъгълник, за да видиш подробности.',
    share: { embed: 's07-fn' },
    body: views(ctx, 'funkcii', 'Изглед на разходите по функции', [
      { key: 'grafika', label: 'Разпределение', body: () => fnMap(ctx, fm, 'funkcii') },
      { key: 'tablica', label: 'Таблица', body: () => fnTable(ctx, fm, 'funkcii') },
      { key: 'godini', label: 'По години', body: () => yearsView(ctx, fm, 'funkcii') }
    ])
  });
}
/** the Eurostat history under the budget's functions (2015–2024) */
const histBlock = (ctx, cm) => block({
  id: 's07-hist', title: `Функции през годините, ${cm.years[0]}–${cm.years[cm.years.length - 1]}`, scope: COFOG_SCOPE, status: 'real', source: ['eurostat'], asOf: cm.asOf,
  sub: 'Евростат, държавно управление. Друг разрез от функциите по-горе: числата не са сравними един към един.', body: yearsView(ctx, cm, 'cofog')
});

function vidPane(ctx, fm, x, hidden) {
  const foot = x.term ? html`<p class="small muted"><a href="${ctx.href('S03', { term: x.term.slug })}">Какво значи „${x.label.toLowerCase()}“, в речника</a></p>` : '';
  return pane(x, hidden, { what: x.what, rows: factRows(ctx, fm, x), parts: partsList(x.parts), foot });
}
const vidBlock = (ctx, fm) => block({
  id: 's07-vid', title: `На какво отиват парите, ${yr(fm.year)}`, scope: 'kfp', status: periodStatus(ctx), source: ['asbp'], asOf: fm.asOf,
  sub: 'Същите разходи, разрязани по вид: заплати, помощи, лихви и т.н., а не по функция. Включена е вноската в бюджета на ЕС.',
  share: { embed: 's07-vid' },
  body: views(ctx, 'vid', 'Изглед на разходите по вид', [
    { key: 'grafika', label: 'Разпределение', body: () => fnMap(ctx, fm, 'vid', vidPane) },
    { key: 'tablica', label: 'Таблица', body: () => fnTable(ctx, fm, 'vid') },
    { key: 'godini', label: 'По години', body: () => yearsView(ctx, fm, 'vid') }
  ])
});

/** the budgets in the shape of the other cuts: the map shows the largest and „останалите“, the table lists all of them */
function minFm(mm) {
  return { kind: 'min', mm, items: mm.shown, ranked: mm.top, all: mm.ranked, years: [mm.year - 1, mm.year], sel: 1, prev: 0, year: mm.year, prevYear: mm.year - 1,
    total: mm.total, sum: mm.total, totalBefore: null, totalPg: ok(mm.gdp) && mm.gdp > 0 ? (mm.total / mm.gdp) * 100 : null, byId: mm.byId };
}
const minPane = (ctx, fm, x, hidden) => pane(x, hidden, { what: upper(x.kind), rows: factRows(ctx, fm, x), foot: goLink(x.href, 'Отвори бюджета') });
/** 2026 against 2025 for the largest budgets: euro only (a like-for-like law-to-law base exists for the 'law' rows) */
function minYears(ctx, mm) {
  const rows = mm.top, u = chartUnit(ctx, { pct: false, person: false, max: maxOf([rows.map(x => x.val)]) });
  const spec = {
    id: 's07-yr-vedomstva', type: 'barh', title: `Най-големите бюджети: ${yr(mm.year)} спрямо ${yr(mm.year - 1)}`,
    sub: `В ${u.unit}. Закон за държавния бюджет. Където няма лента за ${mm.year - 1}, няма сравнима основа.`,
    unit: u.unit, d: u.d, fmt: u.fmt, option: u.option(true), categories: rows.map(x => x.label), categoryLabel: 'Бюджет',
    series: [{ name: `Закон ${mm.year - 1}`, data: rows.map(x => u.conv(x.before, null)), color: 'other' }, { name: `Закон ${mm.year}`, data: rows.map(x => u.conv(x.val, null)), color: '--exp' }],
    labels: false, legend: true, labelWidth: 'auto', labelOverflow: 'break', height: rows.length * 64 + 60,
    desc: `Ленти за ${rows.length} бюджета: ${rows.map(x => `${x.label} ${u.fmt(u.conv(x.val, null))} ${u.unit}`).join('; ')}.`
  };
  return html`<p class="small muted">Сравнението е само в евро: за бюджетите на ведомствата няма „на човек“ и „% от БВП“ по години.</p>${chart(spec)}`;
}
function minBlock(ctx, mm) {
  const fm = minFm(mm);
  const note = ctx.period?.key !== '2026.law' ? callout({ kind: 'info', body: `Бюджетите на ведомствата са по закона за ${yr(mm.year)} и не зависят от избрания период.` }) : '';
  return block({
    id: 's07-min', title: `Кой харчи, ${yr(mm.year)}`, scope: MIN_SCOPE, status: 'real', source: ['zdb'], asOf: mm.asOf,
    sub: `Десетте най-големи от ${num(mm.count, 0)} бюджета по закона: ${money(mm.total, { d: 1 })} общо. Това е държавният бюджет, не цялата консолидирана фискална програма.`,
    share: { embed: 's07-top10' },
    body: html`${note}${views(ctx, 'vedomstva', 'Изглед на разходите по бюджети', [
      { key: 'grafika', label: 'Разпределение', body: () => fnMap(ctx, fm, 'vedomstva', minPane) },
      { key: 'tablica', label: 'Таблица', body: () => fnTable(ctx, fm, 'vedomstva') },
      { key: 'godini', label: `${mm.year} спрямо ${mm.year - 1}`, body: () => minYears(ctx, mm) }
    ])}<p class="s07-all"><a class="btn" href="${ctx.href('S10', {}, { tab: 'vedomstva' })}">Всички ${num(mm.count, 0)} бюджета<span aria-hidden="true"> →</span></a></p>`
  });
}

// ── „Топ 5“ ────────────────────────────────────────────────────────────────────────────────────────────
const TOP_N = 5;
/** three rankings of one pool: the largest, the biggest rise in euro, the biggest rise in percent (not for a base under MIN_BASE) */
function rankModes(pool) {
  const up = pool.filter(x => ok(x.diff) && x.diff > 0);
  return [
    { key: 'najgolemi', label: 'Най-големи', rows: pool.filter(x => ok(x.val)).sort((a, b) => b.val - a.val).slice(0, TOP_N) },
    { key: 'rast-eur', label: 'Ръст в €', rows: up.slice().sort((a, b) => b.diff - a.diff).slice(0, TOP_N) },
    { key: 'rast-pct', label: 'Ръст в %', rows: up.filter(x => ok(x.yoy) && ok(x.before) && x.before >= MIN_BASE).sort((a, b) => b.yoy - a.yoy).slice(0, TOP_N) }
  ].filter(m => m.rows.length);
}
function topBlock(ctx, key, pool, o) {
  const modes = rankModes(pool);
  if (!modes.length) return '';
  const hist = o.kind === 'cofog', u = chartUnit(ctx, { pct: true, max: maxOf([pool.map(x => x.val)]), person: !hist });
  const sub = it => (ok(it.before) && ok(it.val) ? `${money(it.before)} → ${money(it.val)}` : undefined);
  const MODE = {
    najgolemi: { value: x => u.conv(x.val, x.pgSel), fmt: (v, it) => (hist ? histAmount(ctx, it.mln, it.pctGdp) : amount(ctx, { mln: it.mln, pctGdp: it.pctGdp })), unitLabel: u.unit, sub: () => undefined },
    'rast-eur': { value: x => x.diff, fmt: (v, it) => signedMoney(it.diff), unitLabel: 'млн. €', sub },
    'rast-pct': { value: x => x.yoy, fmt: (v, it) => delta(it.yoy, 1), unitLabel: '%', sub }
  };
  const list = m => ranklist({
    id: `s07-top-${key}-${m.key}`, caption: `${o.what}: ${m.label.toLowerCase()}${m.key === 'najgolemi' ? '' : ` ${vsText(o.fm)}`}`, label: `${m.label}: ${o.what.toLowerCase()}`, ordered: true,
    unit: 'num', unitLabel: MODE[m.key].unitLabel, fmt: MODE[m.key].fmt, shares: false, categoryLabel: o.cat,
    items: m.rows.map(x => ({ id: x.id, label: x.label, sub: MODE[m.key].sub(x), value: MODE[m.key].value(x), mln: x.val, pctGdp: x.pgSel, diff: x.diff, yoy: x.yoy, share: m.key === 'najgolemi' ? x.share : undefined, href: x.href || undefined }))
  });
  return block({
    id: `s07-top-${key}`, title: 'Топ 5', scope: o.scope, status: o.status, source: o.source, asOf: o.asOf, share: false, sub: o.sub,
    body: modes.length === 1 ? list(modes[0]) : picker(ctx, `s07-tm-${key}`, 'Какво да класираме', 'top', modes.map(m => ({ key: m.key, label: m.label, body: () => list(m) })))
  });
}

// ── the figures at a glance ────────────────────────────────────────────────────────────────────────────
function kpiBlock(ctx, main, eco) {
  const st = periodStatus(ctx) === 'forecast' ? 'forecast' : undefined;
  const dl = (cur, before, y) => { const v = change(cur, before); return v == null ? null : { value: v, d: 1, unit: '%', label: `спрямо ${yr(y)}` }; };
  const tiles = [];
  if (eco && ok(eco.total)) tiles.push(kpi({ label: 'Общо разходи', mln: eco.total, pctGdp: eco.totalPg, delta: eco.prevYear ? dl(eco.total, eco.totalBefore, eco.prevYear) : null, sub: 'С вноската в бюджета на ЕС', status: st }));
  else if (main && ok(main.total)) tiles.push(kpi({ label: 'Разходи на държавното управление', mln: main.total, pctGdp: main.totalPg, sub: 'По данни на Евростат', status: 'real' }));
  const a = main?.ranked[0];
  if (a && ok(a.val)) tiles.push(kpi({ label: `Най-голяма функция: ${a.label}`, mln: a.val, pctGdp: a.pgSel, delta: main.prevYear ? dl(a.val, a.before, main.prevYear) : null, sub: ok(a.rawShare) ? `${pct(a.rawShare, 1)} от разходите по функции` : '', status: main.kind === 'cofog' ? 'real' : st }));
  const cap = eco?.byId.get('kapitalovi');
  if (cap && ok(cap.val)) tiles.push(kpi({ label: 'Капиталови разходи', mln: cap.val, pctGdp: cap.pgSel, delta: eco.prevYear ? dl(cap.val, cap.before, eco.prevYear) : null, sub: 'Пътища, сгради, оборудване', gl: 'kapitalovi-razhodi', status: st }));
  if (!tiles.length) return '';
  return block({ id: 's07-kpis', title: 'Разходите накратко', scope: main?.kind === 'cofog' ? COFOG_SCOPE : 'kfp', status: periodStatus(ctx), source: main?.kind === 'cofog' ? ['eurostat'] : ['asbp'], asOf: main?.asOf, body: kpiGrid(tiles, { label: 'Разходите накратко' }) });
}

// ── the monthly execution is not shown here: this screen is the ANNUAL budget (law or draft), the reports live on «Изпълнение» ──────────────
const execPointer = ctx => html`<p class="s07-exec-go small muted">Колко от годината е изразходвано до последния месечен отчет: <a href="${ctx.href('S15')}">Месечни отчети</a>.</p>`;

// ── how to read the numbers ────────────────────────────────────────────────────────────────────────────
function notesBlock(ctx, mm) {
  const X = ctx.data?.expenditure, F = X?.functions;
  const note = id => (Array.isArray(F?.notes) ? F.notes.find(n => n.id === id)?.text : F?.notes?.[id]) ?? '';
  const items = [note('base'), note('col2025'), note('drugi'), mm?.M.scopeNote, X?.cofog?.note].filter(Boolean);
  if (X?.meta?.asOf) items.push(html`Числата са от мотивите към проекта на бюджета, към ${date(X.meta.asOf, true)}. Приетият закон може да се различава от проекта: какво е променено, виж в „<a href="${ctx.href('S14', {}, { per: '2026.law' })}">Пътят на бюджета</a>“.`);
  return block({ id: 's07-notes', title: 'Как да четеш числата', status: 'real', pill: false, report: false, source: ['asbp'], share: false, body: html`<ul class="s07-notes" data-gl-scan>${items.map(t => html`<li>${t}</li>`)}</ul>` });
}

// ── page contract ──────────────────────────────────────────────────────────────────────────────────────
export const lede = ctx => {
  const eco = ecoModel(ctx);
  if (eco && ok(eco.total)) {
    const v = money(eco.total, { d: 1 }), pg = ok(eco.totalPg) ? `, или ${pct(eco.totalPg, 1)} от БВП` : '';
    const first = { actual: `През ${yr(eco.year)} разходите на държавата са ${v}${pg}.`, prelim: `Според предварителния отчет разходите през ${yr(eco.year)} са ${v}${pg}.`,
      plan: `Държавата планира да похарчи ${v} през ${yr(eco.year)}${pg}.`, forecast: `Според прогнозата разходите през ${yr(eco.year)} ще бъдат ${v}${pg}.` }[eco.kind0] ?? `Разходите през ${yr(eco.year)} са ${v}${pg}.`;
    const a = kfpModel(ctx)?.ranked[0];
    return a && ok(a.rawShare) ? `${first} Най-голям дял има функцията „${a.label}“: ${pct(a.rawShare, 1)} от разходите по функции.` : first;
  }
  const c = cofogModel(ctx);
  return c?.inRange && ok(c.total) ? `През ${yr(c.year)} разходите на държавното управление са ${money(c.total, { d: 1 })} по данни на Евростат.` : null;
};

/** the bars of an embed: the items of a cut in the host period, largest first */
function barSpec(ctx, id, title, items, o) {
  const rows = items.filter(x => ok(x.val)), u = chartUnit(ctx, { pct: true, max: Math.max(0, ...rows.map(x => x.val)), person: !o.hist });
  return {
    id, type: 'barh', title, sub: `В ${u.unit}, от най-големия към най-малкия.`, unit: u.unit, d: u.d, fmt: u.fmt, option: u.option(true),
    categories: rows.map(x => x.label), categoryLabel: o.cat, series: [{ name: title, data: rows.map(x => u.conv(x.val, x.pgSel)), color: '--exp' }],
    labels: true, legend: false, labelWidth: 'auto', labelOverflow: 'break', height: Math.max(328, rows.length * 44 + 40),
    desc: `Хоризонтални ленти: ${rows.map(x => `${x.label} ${u.fmt(u.conv(x.val, x.pgSel))} ${u.unit}`).join('; ')}.`
  };
}
const emptyBars = (id, title) => ({ id, type: 'barh', title, categories: [], series: [], emptyTitle: `${title} не са налични`, emptyText: 'Данните не се заредиха.' });
export const embeds = {
  's07-fn': ctx => {
    const fm = kfpModel(ctx) ?? cofogModel(ctx), hist = fm?.kind === 'cofog';
    return { chart: fm ? barSpec(ctx, 's07-fn', `Разходи по функции, ${yr(fm.year)}`, fm.ranked, { hist, cat: KIND_TXT[fm.kind].cat }) : emptyBars('s07-fn', 'Разходите по функции'), source: hist ? ['eurostat'] : ['asbp'], asOf: fm?.asOf, status: fm ? (hist ? 'real' : periodStatus(ctx)) : 'pending' };
  },
  's07-vid': ctx => {
    const fm = ecoModel(ctx);
    return { chart: fm ? barSpec(ctx, 's07-vid', `Разходи по вид, ${yr(fm.year)}`, fm.ranked, { cat: KIND_TXT.eco.cat }) : emptyBars('s07-vid', 'Разходите по вид'), source: ['asbp'], asOf: fm?.asOf, status: fm ? periodStatus(ctx) : 'pending' };
  },
  's07-top10': ctx => {
    const mm = minModel(ctx);
    return { chart: mm ? barSpec(ctx, 's07-top10', `Най-големите бюджети, ${yr(mm.year)}`, mm.top, { cat: KIND_TXT.min.cat }) : emptyBars('s07-top10', 'Бюджетите на ведомствата'), source: ['zdb'], asOf: mm?.asOf, status: mm ? 'real' : 'pending' };
  }
};

export function render(ctx) {
  const kfp = kfpModel(ctx), eco = ecoModel(ctx), cof = cofogModel(ctx), mm = minModel(ctx);
  const main = kfp ?? cof;
  if (!main && !eco && !mm) return pendingState({ title: 'Разходи', text: 'Данните за разходите не са налични в момента.' });
  const po = String(ctx.query.po) === 'vid' ? 'vid' : 'funkcii';          // «Кой харчи» is the screen /vedomstva (old ?po=vedomstva links are redirected there)
  const hist = main?.kind === 'cofog';
  const nodata = txt => pendingState({ title: 'Разходи', text: txt });

  const funkcii = () => main        // built only for the cut that is shown: a block registers its share spec when it is built
    ? html`${fnBlock(ctx, main)}${topBlock(ctx, 'funkcii', main.items, { fm: main, kind: main.kind, what: 'Функции', cat: KIND_TXT[main.kind].cat, scope: hist ? COFOG_SCOPE : 'kfp', status: hist ? 'real' : periodStatus(ctx), source: hist ? ['eurostat'] : ['asbp'], asOf: main.asOf, sub: 'Кои функции са най-големи и кои растат най-бързо.' })}${kfp && cof ? histBlock(ctx, cof) : ''}`
    : nodata('Разбивката по функции не е налична в момента.');
  const vid = () => eco
    ? html`${vidBlock(ctx, eco)}${topBlock(ctx, 'vid', eco.items, { fm: eco, kind: 'eco', what: 'Видове разход', cat: KIND_TXT.eco.cat, scope: 'kfp', status: periodStatus(ctx), source: ['asbp'], asOf: eco.asOf, sub: 'Кои видове разход са най-големи и кои растат най-бързо.' })}`
    : callout({ kind: 'info', body: `За ${yr(ctx.period.year)} няма разбивка по вид разход. Избери ${ctx.period.year < 2025 ? 'година от 2025 нататък' : 'друг период'}.` });
  const same = kfp && eco && ok(eco.eu?.val) && Math.abs(kfp.total + eco.eu.val - eco.total) < 0.25;
  const intro = same ? html`<p class="s07-intro">Разрезите „За какво“ и „По вид“ са едни и същи разходи, разрязани по различен начин. Функциите (${money(kfp.total, { d: 1 })}) са без вноската в бюджета на ЕС (${money(eco.eu.val, { d: 1 })}), затова разрезът по вид е с толкова повече: ${money(eco.total, { d: 1 })}.</p>` : '';
  return {
    context: 'Консолидирана фискална програма (КФП): разходи',
    body: html`${explorer(ctx, po === 'vid' ? 'rashodi:vid' : 'rashodi:funkcii')}${unitSwitch(ctx, { name: 's07-unit', note: 'Важи за числата и графиките.' })}
      ${kpiBlock(ctx, main, eco)}${intro}
      <div id="s07-po" class="s07-cut" data-cut="${po}">${po === 'vid' ? vid() : funkcii()}</div>
      ${execPointer(ctx)}${notesBlock(ctx, mm)}`
  };
}

export function mount(root, ctx) {
  const off = [bindUnitSwitch(root, ctx, 's07-unit')];
  const show = (split, key) => {
    split.querySelectorAll('.s07-pane').forEach(p => { p.hidden = p.dataset.key !== key; });
    const pick = split.querySelector('select[id^="s07-pick-"]');
    if (pick && pick.value !== key) pick.value = key;
  };
  // a click on the map: show the panel of that item; the row without a panel („останалите“) follows its own link
  const onSelect = e => {
    const split = e.target.closest?.('.s07-split'), id = e.detail?.id;
    if (!split || !id || !split.querySelector(`.s07-pane[data-key="${CSS.escape(id)}"]`)) return;
    e.preventDefault();
    show(split, id);
    ctx.setQuery({ izbor: id }, { rerender: false });
    ctx.announce?.(`Подробности: ${e.detail.label}`);
  };
  const onPick = e => {
    const sel = e.target;
    if (!(sel instanceof HTMLSelectElement) || !sel.id.startsWith('s07-pick-')) return;
    const split = sel.closest('.s07-split');
    if (!split) return;
    show(split, sel.value);
    ctx.setQuery({ izbor: sel.value }, { rerender: false });
  };
  root.addEventListener('tmap:select', onSelect);
  root.addEventListener('change', onPick);
  return () => { root.removeEventListener('tmap:select', onSelect); root.removeEventListener('change', onPick); off.forEach(f => f && f()); };
}
