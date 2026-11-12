import { isFramework } from '../budget-2027.js';
import { municipalityView, mountBillSearch, billListHref } from './bill-views.js';
// S21 · Община · #/obshtina/:code · next S20 · period 2026.law only (D19 is the law; there is no table for the bill)
// Data, only through `needs`:
//   municipalities          D19, REAL   the main transfers of the 2026 state budget law to each municipality (хил. €), inhabitants, € per person
//   geo/obshtini            D20, REAL   the outlines for the locator map (optional: without it the screen simply has no map)
// One municipality, found by its code (case does not matter); an unknown code is ctx.notFound(). The page is a pure function of ctx:
// nothing is typed in, every number comes from the data or from a sum, an average or a rank of it (muni.js).
// Groups for the comparison: the oblast (all its municipalities, the one itself included, so the figure is the one of S20), the ten municipalities
// with the nearest population (the one itself left out) and the whole country (all 265, the one itself included).
import { html } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { mapFigure } from '../ui/map.js';
import { dataTable } from '../ui/table.js';
import { ranklist } from '../ui/ranklist.js';
import { disclosure } from '../ui/disclosure.js';
import { callout } from '../ui/cards.js';
import { pendingState } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import { num, pct, plural, eur, leva, money, moneyParts, NBSP, EUR_RATE } from '../format.js';
import * as M from '../muni.js';

export const needs = (ctx) =>
  isFramework(ctx)
    ? ['core', 'budget2027?', 'municipalities']
    : ['core', 'municipalities', 'geo/obshtini?'];
export const styles = ['s21-obshtina'];
export const periods = ['2026.law', '2027.draft', '2028.forecast', '2029.forecast'];

const SIMILAR_N = 10;
const KINDS = M.TYPES.filter((t) => t.inTotal);
const SRC = ['zdb', 'gisco'];

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const bg = (a, b) => String(a).localeCompare(String(b), 'bg');
const regionKey = (m) => String(m.regionId ?? m.region ?? '');

/** the leva part of a million-euro amount („≈ 9,57 млрд. лв.“) without the brackets */
const levaOf = (mln) => {
  const s = money(mln, { leva: true });
  const i = s.indexOf('(≈');
  return i < 0 ? '' : s.slice(i + 1, -1);
};
/** a sentence ends with one full stop (the unit „лв.“ already carries one) */
const dot = (s) => (String(s).endsWith('.') ? String(s) : `${s}.`);
/** € per person: whole euros, but cents below 10 € (the small kinds are only a few euro per person, a „0“ would be a lie) */
const pcD = (v) => (ok(v) && v !== 0 && Math.abs(v) < 10 ? 2 : 0);
const pcNum = (v) => (ok(v) ? num(v, pcD(v)) : null);
const pcText = (v, lv) => M.eurText(v, pcD(v), lv);
/** a share of a whole: two decimals below a tenth of a percent, so a small municipality never shows „0,0%“ */
const shareText = (v) => (!ok(v) ? '—' : v > 0 && v < 0.1 ? pct(v, 2) : pct(v, 1));

/* ---------------------------------------------------------------- the model: everything the screen shows, from ctx alone */
function model(ctx) {
  const doc = ctx.data.municipalities;
  const all = (Array.isArray(doc?.items) ? doc.items : []).filter((m) => m && m.id && m.name);
  if (!all.length) return { ok: false };
  const code = String(ctx.params.code ?? '')
    .trim()
    .toUpperCase();
  const m = all.find((x) => String(x.id).toUpperCase() === code);
  if (!m) return { ok: true, m: null };
  const rid = regionKey(m);
  const oblast = all.filter((x) => regionKey(x) === rid);
  const similar = M.similarTo(all, m, SIMILAR_N);
  const geo = ctx.data['geo/obshtini'];
  const year = [doc?.populationYear, doc?.meta?.populationYear].find(ok) ?? null;
  const fixIds = new Set(Array.isArray(doc?.popFix?.ids) ? doc.popFix.ids.map(String) : []); // the two municipalities whose population the data corrects
  const fixNote = typeof doc?.popFix?.note === 'string' ? doc.popFix.note.trim() : '';
  return {
    ok: true,
    m,
    all,
    rid,
    region: String(m.region ?? ''),
    oblast,
    similar,
    fixIds,
    fixNote,
    aggOblast: oblast.length > 1 ? M.aggregate(oblast) : null, // an oblast of one municipality (the capital) has nothing to compare with
    aggSimilar: similar.length ? M.aggregate(similar) : null,
    aggNat: M.aggregate(all),
    rank: M.rankOf(all, m),
    hasGeo: Array.isArray(geo?.features) && geo.features.length > 0,
    geo,
    year,
    asOf: doc?.meta?.asOf,
    lv: !!ctx.store.get('leva'),
  };
}

/** the data's own footnote about the two corrected populations: the callout of the municipality's own page says it, a list that shows either of the two says it again */
const FIX_TITLE = 'Бележка за броя на жителите';
const fixOwn = (md) => md.fixNote && md.fixIds.has(String(md.m.id));
const fixFoot = (md, list) =>
  md.fixNote && !fixOwn(md) && list.some((x) => md.fixIds.has(String(x.id)))
    ? html`<p class="small muted s21-fix"><strong>${FIX_TITLE}.</strong> ${md.fixNote}</p>`
    : '';

/** one sentence part: how much more or less than a group's average, in words a reader can say aloud; null when there is nothing to compare */
function compareLine(own, ref, what, lv) {
  if (!ok(own) || !ok(ref) || own <= 0 || ref <= 0) return null;
  const ratio = own / ref;
  const tail = `средното за ${what}, което е ${pcText(ref, lv)} на жител`;
  if (ratio >= 2) return `${num(ratio, 1)} пъти повече от ${tail}`;
  if (ratio <= 0.5) return `${num(1 / ratio, 1)} пъти по-малко от ${tail}`;
  const r = Math.round(Math.abs(ratio - 1) * 100);
  return r === 0
    ? `почти колкото ${tail}`
    : `с ${r}% ${ratio > 1 ? 'повече' : 'по-малко'} от ${tail}`;
}

/* ---------------------------------------------------------------- A · the money of this municipality */
function moneyBlock(md) {
  const { m, lv } = md;
  const tot = M.totalOf(m); // хил. €
  const mln = tot === null ? null : tot / 1000;
  const parts = mln === null ? null : moneyParts(mln);
  const natTot = md.aggNat.sum.total;
  const natShare = tot !== null && ok(natTot) && natTot > 0 ? (tot / natTot) * 100 : null;
  const subTot = [
    natShare === null
      ? ''
      : `Това е ${shareText(natShare)} от основните трансфери за всички общини.`,
    lv && mln !== null ? `В лева: ${dot(levaOf(mln))}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const pc = M.pcOf(m),
    r = md.rank;
  const subPc = [
    r
      ? `Място ${num(r.rank, 0)} от ${num(r.of, 0)} по евро на жител. Първото място е за общината с най-много.`
      : '',
    lv && pc !== null ? `В лева: ≈${NBSP}${dot(leva(pc * EUR_RATE, pcD(pc * EUR_RATE)))}` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const pop = M.popOf(m);
  return block({
    id: 's21-pari',
    title: 'Парите от държавата през 2026 г.',
    scope: 'nat',
    status: 'real',
    source: SRC,
    asOf: md.asOf,
    sub: 'Основните трансфери от държавния бюджет към общината, по закона за 2026 г.',
    body: html`<div class="s21-stack">${kpiGrid(
      [
        kpi({
          label: 'Основни трансфери общо',
          value: parts ? parts.v : null,
          unit: parts ? parts.u : '',
          sub: subTot,
        }),
        kpi({
          label: 'На жител',
          value: pc === null ? null : num(pc, pcD(pc)),
          unit: pc === null ? '' : '€',
          sub: subPc,
        }),
        kpi({
          label: 'Жители',
          value: pop === null ? null : num(pop, 0),
          unit: pop === null ? '' : 'души',
          sub: md.year ? `По данни към ${md.year} г.` : '',
        }),
      ],
      { label: `Основни числа за ${M.munName(m)}` },
    )}${fixOwn(md) ? callout({ kind: 'info', title: FIX_TITLE, body: md.fixNote }) : ''}</div>`,
  });
}

/* ---------------------------------------------------------------- B · compared with the oblast, with similar municipalities and with the country */
function compareBlock(md, ctx) {
  const { m, lv } = md;
  const pc = M.pcOf(m);
  const head = {
    id: 's21-sravnenie',
    title: 'Как се сравнява с други общини',
    scope: 'nat',
    status: 'real',
    source: SRC,
    asOf: md.asOf,
  };
  if (pc === null) {
    return block({
      ...head,
      sub: 'Основни трансфери на жител.',
      body: html`<p>Няма данни за жителите на общината, затова не можем да сравним сумата на жител.</p>`,
    });
  }
  const nOf = (n) => plural(n, 'община', 'общини');
  const groups = [
    md.aggOblast
      ? {
          label: `Област ${md.region}`,
          sub: `средно за ${nOf(md.oblast.length)}`,
          what: `област ${md.region}`,
          v: md.aggOblast.perCapita.total,
        }
      : null,
    md.aggSimilar
      ? {
          label: 'Общини с подобен размер',
          sub: `средно за ${nOf(md.similar.length)} с най-близък брой жители`,
          what: 'общините с подобен размер',
          v: md.aggSimilar.perCapita.total,
        }
      : null,
    {
      label: 'Цялата страна',
      sub: `средно за ${nOf(md.all.length)}`,
      what: 'страната',
      v: md.aggNat.perCapita.total,
    },
  ].filter(Boolean);
  const lines = groups.map((g) => compareLine(pc, g.v, g.what, lv)).filter(Boolean);
  const list = ranklist({
    id: 's21-sravnenie-l',
    label: 'Основни трансфери на жител: общината и средните за групите',
    unit: 'num',
    fmt: (v) => pcText(v, lv),
    unitLabel: '€ на жител',
    categoryLabel: 'Сравнение',
    items: [
      { label: M.munName(m), sub: 'тази община', value: pc },
      ...groups.map((g) => ({ label: g.label, sub: g.sub, value: g.v })),
    ],
  });

  // the ten municipalities with the nearest population, and a word of caution when none of them is really the same size
  let similarPart = '';
  if (md.similar.length) {
    const pops = md.similar.map(M.popOf).filter(Boolean);
    const lo = Math.min(...pops),
      hi = Math.max(...pops),
      p = M.popOf(m);
    const far = p > hi * 2 ? 'по-малки' : p < lo / 2 ? 'по-големи' : '';
    const table = dataTable({
      id: 's21-podobni-t',
      caption: `Общините с най-близък брой жители до ${M.munName(m)}`,
      dense: true,
      columns: [
        { key: 'name', label: 'Община' },
        { key: 'region', label: 'Област' },
        { key: 'population', label: 'Жители', num: true, d: 0 },
        {
          key: 'pc',
          label: 'Основни трансфери на жител',
          unit: lv ? 'лв.' : '€',
          num: true,
          fmt: pcNum,
        },
      ],
      rows: md.similar.map((x) => ({
        name: x.name,
        region: x.region,
        population: M.popOf(x),
        pc: M.pcOf(x) === null ? null : M.pcOf(x) * (lv ? EUR_RATE : 1),
        _href: ctx.href('obshtina', { code: x.id }),
      })),
    });
    similarPart = html`<p>Общините с подобен размер са ${plural(md.similar.length, 'община', 'общини')}, чийто брой жители е най-близък до този на общината: от ${num(lo, 0)} до ${num(hi, 0)} души.</p>
      ${far ? callout({ kind: 'info', body: html`Няма общини със същия размер: най-близките са много ${far}. Сравнението с тях е само ориентировъчно.` }) : ''}
      ${disclosure({ id: 's21-podobni', title: 'Кои са общините с подобен размер', meta: nOf(md.similar.length), body: html`<div class="s21-stack">${table}${fixFoot(md, md.similar)}</div>` })}`;
  }
  return block({
    ...head,
    sub: md.aggOblast
      ? 'Основни трансфери на жител: общината, областта, общините с подобен размер и цялата страна.'
      : 'Основни трансфери на жител: общината, общините с подобен размер и цялата страна.',
    body: html`<div class="s21-stack">
      ${lines.length ? html`<div><p class="s21-lead" id="s21-sravnenie-lead">На жител общината получава:</p><ul class="s21-diffs" aria-labelledby="s21-sravnenie-lead">${lines.map((l) => html`<li>${l}</li>`)}</ul></div>` : ''}
      ${list}
      <p class="small muted">Средното за група е сумата на всички общини в нея, разделена на жителите им.</p>
      ${similarPart}
      <p class="cluster s21-links">${md.aggOblast ? html`<a class="btn" href="${ctx.href('obshtini', {}, { oblast: md.rid })}">Всички общини в област ${md.region}</a>` : ''}<a class="btn" href="${ctx.href('obshtini')}">Търси друга община</a></p>
    </div>`,
  });
}

/* ---------------------------------------------------------------- C · the four kinds of transfer */
function kindsBlock(md) {
  const { m, lv } = md;
  const k = lv ? EUR_RATE : 1;
  const mu = lv ? 'хил. лв.' : 'хил. €',
    pu = lv ? 'лв.' : '€';
  const scale = (v) => (ok(v) ? v * k : null);
  const rows = KINDS.map((t) => ({
    kind: t.label,
    text: t.text,
    total: scale(m.transfers?.[t.key]),
    pc: scale(M.pcType(m, t.key)),
    oblast: scale(md.aggOblast?.perCapita[t.key]),
    similar: scale(md.aggSimilar?.perCapita[t.key]),
    nation: scale(md.aggNat.perCapita[t.key]),
  }));
  const totals = {
    total: scale(M.totalOf(m)),
    pc: scale(M.pcOf(m)),
    oblast: scale(md.aggOblast?.perCapita.total),
    similar: scale(md.aggSimilar?.perCapita.total),
    nation: scale(md.aggNat.perCapita.total),
  };
  const per = { num: true, fmt: pcNum };
  const columns = [
    {
      key: 'kind',
      label: 'Вид',
      fmt: (v, r) =>
        html`${v}${r.text ? html`<small class="s21-kind-text">${r.text}</small>` : ''}`,
    },
    { key: 'total', label: 'Общо', unit: mu, num: true, fmt: (v) => (ok(v) ? num(v, 1) : null) },
    { key: 'pc', label: 'На жител', unit: pu, ...per },
    ...(md.aggOblast
      ? [{ key: 'oblast', label: 'Средно за областта', unit: `${pu} на жител`, ...per }]
      : []),
    ...(md.aggSimilar
      ? [{ key: 'similar', label: 'Средно за подобните общини', unit: `${pu} на жител`, ...per }]
      : []),
    { key: 'nation', label: 'Средно за страната', unit: `${pu} на жител`, ...per },
  ];
  const avgNames = [
    md.aggOblast ? 'областта' : null,
    md.aggSimilar ? 'подобните общини' : null,
    'страната',
  ].filter(Boolean);
  const averages =
    avgNames.length > 1
      ? `${avgNames.slice(0, -1).join(', ')} и ${avgNames[avgNames.length - 1]}`
      : avgNames[0];
  const table = dataTable({
    id: 's21-vidove-tbl',
    caption: `Основни трансфери към ${M.munName(m)} по вид, 2026 г.`,
    columns,
    rows,
    dense: true,
    total: { label: 'Основни трансфери общо', values: totals },
  });

  // which kind is the biggest, and the sum that is paid on top (outside the total)
  const sum = M.totalOf(m);
  const known = KINDS.map((t) => ({ t, v: m.transfers?.[t.key] })).filter((x) => ok(x.v));
  const top =
    known.length && ok(sum) && sum > 0 ? known.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const other = m.transfers?.otherTargeted;
  const otherPc = M.pcType(m, 'otherTargeted');
  const otherName = M.TYPES.find((t) => !t.inTotal)?.label ?? 'Други целеви трансфери';
  // the fifth kind sits outside the total, so it gets one sentence with the same comparison as the table has
  const otherCmp = [
    [md.aggOblast?.perCapita.otherTargeted, 'за областта'],
    [md.aggSimilar?.perCapita.otherTargeted, 'за подобните общини'],
    [md.aggNat.perCapita.otherTargeted, 'за страната'],
  ]
    .filter(([v]) => ok(v))
    .map(([v, t]) => `${pcText(v, lv)} ${t}`);
  const otherCmpText =
    otherCmp.length > 1
      ? `${otherCmp.slice(0, -1).join(', ')} и ${otherCmp[otherCmp.length - 1]}`
      : (otherCmp[0] ?? '');
  const otherLine = !ok(other)
    ? ''
    : other > 0
      ? `Освен тях общината получава „${otherName}“: ${M.khilText(other, 1, lv)}${otherPc === null ? '' : ` (${pcText(otherPc, lv)} на жител)`}. Тази сума се дава отгоре и не е в общата сума по-горе.${otherCmpText ? ` За сравнение, средно на жител: ${otherCmpText}.` : ''}`
      : `Тази община няма „${otherName}“. Те се дават отгоре на основните трансфери и не са в общата сума.${otherCmpText ? ` За сравнение, средно на жител: ${otherCmpText}.` : ''}`;
  return block({
    id: 's21-vidove',
    title: 'Трансфери по вид',
    scope: 'nat',
    status: 'real',
    source: SRC,
    asOf: md.asOf,
    sub: 'Колко е всеки от четирите вида основни трансфери и как се сравнява със средното за други общини.',
    body: html`<div class="s21-stack">
      ${top ? html`<p>Най-голямата част от основните трансфери (${pct((top.v / sum) * 100, 0)}) е за „${top.t.label}“.</p>` : ''}
      ${table}
      <p class="small muted s21-scroll-hint">Ако таблицата е по-широка от екрана, плъзни я настрани: там са средните за ${averages}.</p>
      ${otherLine ? html`<p>${otherLine}</p>` : ''}
      <div class="s21-notes small muted">
        <p>Сумите на жител са закръглени, затова събраните може да се различават от общата сума с 1${NBSP}до${NBSP}2${NBSP}${pu} на жител.</p>
        ${known.some((x) => x.v === 0) ? html`<p>Нулата значи, че законът не дава такава сума на общината.</p>` : ''}
      </div>
    </div>`,
  });
}

/* ---------------------------------------------------------------- E · where the municipality is: the oblast on the map, with a list under it */
function mapBlock(md, ctx) {
  if (!md.hasGeo || !md.aggOblast) return '';
  const { m, lv } = md;
  const pu = lv ? 'лв.' : '€';
  const items = md.all.map((x) => ({
    id: x.id,
    label: x.name,
    sub: `област ${x.region}`,
    value: M.pcOf(x),
    group: regionKey(x),
    href: String(x.id) === String(m.id) ? undefined : ctx.href('obshtina', { code: x.id }), // the one itself is not a link: it is the page
  }));
  const rows = md.oblast
    .map((x) => ({
      name: x.name,
      population: M.popOf(x),
      pc: M.pcOf(x) === null ? null : M.pcOf(x) * (lv ? EUR_RATE : 1),
      self: String(x.id) === String(m.id),
      _href: String(x.id) === String(m.id) ? undefined : ctx.href('obshtina', { code: x.id }),
    }))
    .sort((a, b) => bg(a.name, b.name));
  const table = dataTable({
    id: 's21-oblast-t',
    caption: `Основни трансфери на жител в област ${md.region}`,
    dense: true,
    columns: [
      {
        key: 'name',
        label: 'Община',
        fmt: (v, r) => (r.self ? html`${v} <span class="muted">(тази община)</span>` : v),
      },
      { key: 'population', label: 'Жители', num: true, d: 0 },
      { key: 'pc', label: 'Основни трансфери на жител', unit: pu, num: true, fmt: pcNum },
    ],
    rows,
  });
  return block({
    id: 's21-karta',
    title: `Общините в област ${md.region}`,
    scope: 'nat',
    status: 'real',
    source: SRC,
    asOf: md.asOf,
    sub: 'Евро на жител през 2026 г. Общината е очертана. Избери друга община, за да отвориш нейната страница.',
    body: html`<div class="s21-stack">
      ${mapFigure({
        id: 's21-map',
        title: 'Основни трансфери на жител в областта',
        sub: '€ на жител, 2026 г.',
        geo: md.geo,
        items,
        unitLabel: 'Трансфер на жител, €',
        valueLabel: 'трансфер на жител',
        fmt: (v) => eur(v, pcD(v)),
        focusGroup: md.rid,
        selected: String(m.id),
        categoryLabel: 'Община',
        groupLabel: 'Област',
        openLabel: 'Виж общината',
        desc: 'Цветът на всяка община показва колко евро на жител получава. Общината, за която е страницата, е очертана. Същите данни има в списъка под картата.',
        hint: 'Посочи община на картата или я избери с Tab и стрелките.',
        help: 'Картата е един елемент за Tab. Със стрелките се местиш между общините, с Enter отваряш избраната. Същите данни има и в списъка под картата.',
        twin: false,
      })}
      ${fixFoot(md, md.oblast)}
      ${disclosure({ id: 's21-oblast', title: `Общините в област ${md.region} в списък`, meta: plural(md.oblast.length, 'община', 'общини'), body: table })}
    </div>`,
  });
}

/* ---------------------------------------------------------------- F · how to read the numbers */
function readBlock(md) {
  const { m } = md;
  const law = m.lawName && String(m.lawName).trim();
  const lines = [
    md.year ? `Жителите са по данни към ${md.year} г.` : '',
    law ? `В закона името на общината е изписано „${law}“.` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return block({
    id: 's21-chetene',
    title: 'Как да четем числата',
    status: 'real',
    pill: false,
    report: false,
    source: SRC,
    asOf: md.asOf,
    share: false,
    body: html`<div class="prose s21-read">
      <p>Показваме основните ${gl('byudzheten-transfer', 'трансфери')} от държавния бюджет по закона за 2026 г. Те са четири вида и отиват в ${gl('obshtinski-byudzhet', 'бюджета на общината')}. „Други целеви трансфери“ са отделна сума, която се дава отгоре. Не я събираме с основните.</p>
      <p>„На жител“ е сумата на общината, разделена на жителите ѝ. Така големи и малки общини се сравняват по равно. Това е ${gl('razhod-na-chovek', 'средна стойност')}: никой не получава тези евро в ръка.</p>
      <p>По-голяма сума на жител не значи, че общината е по-добре или по-зле управлявана. Тя зависи от много неща, например колко училища, детски градини и пътища има общината.</p>
      ${lines ? html`<p class="small muted">${lines}</p>` : ''}
    </div>`,
  });
}

/* ---------------------------------------------------------------- render */
export function render(ctx) {
  if (isFramework(ctx)) return municipalityView(ctx);
  const md = model(ctx);
  if (!md.ok)
    return pendingState({
      title: 'Няма данни за общините',
      text: 'Няма данни за избрания период.',
    });
  if (!md.m) ctx.notFound();
  return {
    title: M.munName(md.m),
    docTitle: `${M.munName(md.m)}, област ${md.region}`, // two municipalities are called Бяла (js/seo.js: one title per address)
    lede: `Област ${md.region}. Колко пари държавата дава на общината през 2026 г., за какво са те и как сумата се сравнява с областта и с другите общини.`,
    body: html`${moneyBlock(md)}${compareBlock(md, ctx)}${kindsBlock(md)}${mapBlock(md, ctx)}${readBlock(md)}`,
  };
}

export function next(ctx) {
  return isFramework(ctx) ? [{ title: 'Към списъка с общини', href: billListHref(ctx) }] : ['S20'];
}
