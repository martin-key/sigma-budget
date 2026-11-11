import { isFramework } from '../budget-2027.js';
import { institutionView, mountBillSearch, billListHref } from './bill-views.js';
// S11 · Ведомство · #/vedomstvo/<код>[/<програма>] · next S15, S10 · period 2026.law only
// Data, only through `needs`:
//   ministries         D08+D09 REAL  the budget of the spender by the 2026 law (хил. €), the law's policy list, the bill-vs-law flags and where
//                                    the programme budget is attached or still pending (P03)
//   ministries/<код>?  D09 REAL      policies → programmes, nine columns, 2023–2028 (a file does not exist for the four budgets still pending)
//   core                             the planned GDP (for „% от БВП“) and the inhabitants (for „на човек“)
// One route, two views: the spender (#/vedomstvo/1300) and a policy or a programme of it (#/vedomstvo/1300/1300.01.01).
// S10 links a policy as #/vedomstvo/<код>?to=pol-<код с тирета>: every policy here is a <details id="pol-…"> that the router opens and focuses.
import { html } from '../html.js';
import { num, delta, date, plural, DASH } from '../format.js';
import { data } from '../data.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { dataTable } from '../ui/table.js';
import { disclosure } from '../ui/disclosure.js';
import { callout, facts, ext } from '../ui/cards.js';
import { errorState, pendingState } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import { unitSwitch, bindUnitSwitch } from '../ui/unit-switch.js';

// the four budgets whose programmes are still pending (P03) have no file: used only to spare a direct load a 404 before the index is cached
const NO_FILE = ['0100', '1800', '2300', '7400'];
export const needs = (ctx) => {
  if (isFramework(ctx)) return ['core', 'budget2027?'];
  const code = String(ctx?.params?.code ?? '');
  const list = ['core', 'ministries'];
  if (/^\d{4}$/.test(code)) {
    const known = data.get('ministries')?.items?.find?.((m) => m && String(m.id) === code);
    if (known ? known.programs?.status === 'real' : !NO_FILE.includes(code))
      list.push(`ministries/${code}?`);
  }
  return list;
};
export const styles = ['s11-vedomstvo'];
export const periods = ['2026.law', '2027.draft', '2028.forecast', '2029.forecast'];

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const LONG = 80;
const NOUN = {
  ministry: 'Министерство',
  agency: 'Агенция или служба',
  commission: 'Комисия или съвет',
  judiciary: 'Съдебна власт',
  constitutional: 'Конституционен орган',
  legislature: 'Законодателна власт',
  fund: 'Фонд',
  other: 'Ведомство',
};
const labelOf = (m) => (m.name.length > LONG && m.short && m.short !== m.name ? m.short : m.name);
const plainName = (m) => (m.name.length <= 44 ? m.name : m.short || m.name);
const clip = (s, n = 70) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const anchor = (code) => `pol-${String(code).replace(/\./g, '-')}`;
/** one number of a row of the programme budget: values[year] is an array of nine columns (0 total, 1 own budget, 2 other sources, 3–5 departmental, 6–8 administered) */
const val = (values, y, i) => {
  const v = values?.[String(y)]?.[i];
  return ok(v) ? v : null;
};
const K = (v) => (!ok(v) ? DASH : v === 0 ? '0' : num(v, 1));
const SGN = (v) => (ok(v) ? num(v, 1, { sign: true }) : DASH);
const SCOPE = { key: 'zdb-vedomstvo', label: 'Бюджет на ведомството', note: 'не е целият бюджет' };

/** a big amount goes through the standard KPI path (it honours „% от БВП“, „на човек“, „и в лева“); an amount under a million euro is printed in thousands */
function kpiK(M, o) {
  const { k, ...rest } = o;
  if (!ok(k)) return kpi({ ...rest, mln: null });
  if (Math.abs(k) >= 1000)
    return kpi({ ...rest, mln: k / 1000, pctGdp: M.gdpMln ? (k / 1000 / M.gdpMln) * 100 : null });
  return kpi({ ...rest, value: K(k), unit: 'хил. €' });
}
function changeText(m) {
  if (!m.change) return 'няма сравнение с 2025 г.';
  const star = m.change.basis === 'program-budget' ? '*' : '';
  return Math.abs(m.change.pct) < 0.05
    ? `без промяна спрямо 2025 г.${star}`
    : `${delta(m.change.pct, 1)}${star} спрямо 2025 г.`;
}
function growth(k, k25) {
  if (!ok(k)) return 'няма данни за 2026 г.';
  if (!ok(k25)) return 'няма данни за 2025 г.';
  if (k25 > 0) {
    const v = ((k - k25) / k25) * 100;
    return Math.abs(v) < 0.05 ? 'без промяна спрямо 2025 г.' : `${delta(v, 1)} спрямо 2025 г.`;
  }
  if (k25 === 0 && k > 0) return 'ново, за 2025 г. няма средства';
  return k25 === 0 ? 'без средства през 2025 и 2026 г.' : 'няма сравнение с 2025 г.';
}

/* ---------------------------------------------------------------- the model */
function modelOf(ctx) {
  const doc = ctx.data.ministries;
  const code = String(ctx.params.code ?? '');
  const m =
    /^\d{4}$/.test(code) && Array.isArray(doc?.items)
      ? doc.items.find((x) => x && String(x.id) === code)
      : null;
  if (!m) ctx.notFound();
  const pending = m.programs?.status !== 'real';
  const file = pending ? null : (ctx.data[`ministries/${code}`] ?? null);
  const list = (Array.isArray(file?.policies) ? file.policies : []).map((p) => ({
    ...p,
    level: p.kind === 'program' ? 'solo' : 'policy',
    programs: (Array.isArray(p.programs) ? p.programs : []).map((q) => ({
      ...q,
      level: 'prog',
      parent: p.code,
    })),
  }));
  const byCode = new Map();
  list.forEach((e) => {
    byCode.set(e.code, e);
    e.programs.forEach((q) => byCode.set(q.code, q));
  });
  const gdp = ctx.core?.kpis?.gdp;
  const gdpMln = [gdp?.mlnPrecise, gdp?.mln].find((x) => ok(x) && x > 0) ?? null;
  const pc = ctx.params.program ? String(ctx.params.program) : '';
  const node = pc ? (byCode.get(pc) ?? null) : null;
  if (pc && !node) ctx.notFound(); // a programme that this budget does not have, or a budget whose programmes are still pending
  const pbl = m.programBudgetVsLaw;
  const differs = !!m.billVsLaw || (!!pbl && ok(pbl.diffKhil) && Math.abs(pbl.diffKhil) > 0.05);
  return {
    ctx,
    doc,
    m,
    code,
    pending,
    file,
    list,
    byCode,
    gdpMln,
    node,
    parent: node?.parent ? (byCode.get(node.parent) ?? null) : null,
    pbl,
    differs,
  };
}

function head(M) {
  const { m, node, doc, file, parent } = M;
  const law = `Бюджетът на ведомството е по закона към ${date(doc.meta.asOf)} г.`;
  const context = file?.meta?.asOf
    ? `${law} Програмите са по проекта на закона от ${date(file.meta.asOf)} г.`
    : law;
  if (!node) {
    return {
      title: labelOf(m),
      eyebrow: `${NOUN[m.kind] || 'Ведомство'} · код ${m.id}`,
      context,
      lede: `${m.name.length > LONG ? `Пълното име е „${m.name}“. ` : ''}Бюджетът му е по чл. ${m.art} от Закона за държавния бюджет за 2026 г. Тук се виждат колко харчи през 2026 г. и ${M.pending ? 'по кои политики' : 'по кои политики и програми'} са разпределени парите му.`,
    };
  }
  const word =
    node.level === 'policy'
      ? 'Политика'
      : node.level === 'solo'
        ? 'Програма без политика'
        : 'Програма';
  return {
    title: node.name,
    eyebrow: `${word} · код ${node.code}`,
    context,
    lede:
      node.level === 'policy'
        ? `Политика на ${plainName(m)}. Включва ${plural(node.programs.length, 'програма', 'програми')}.`
        : parent
          ? `Програма към политиката „${clip(parent.name, 110)}“ на ${plainName(m)}.`
          : `Програма на ${plainName(m)}, която не е част от политика.`,
  };
}

/* ---------------------------------------------------------------- tables */
const amountCol = (key, label) => ({ key, label, unit: 'хил. €', num: true, fmt: (v) => K(v) });
const treeCols = () => [
  {
    key: 'name',
    label: 'Програма',
    fmt: (v, r) =>
      html`${v}${r.code ? html`<small class="s11-cell-sub">код ${r.code}</small>` : ''}`,
  },
  amountCol('total', 'Общо'),
  amountCol('prb', 'По бюджета на ведомството'),
  amountCol('other', 'Други източници'),
  { key: 'chg', label: 'Спрямо 2025 г.', fmt: (v) => v },
];
const rowOf = (M, q) => ({
  name: q.name,
  code: q.code,
  total: val(q.values, 2026, 0),
  prb: val(q.values, 2026, 1),
  other: val(q.values, 2026, 2),
  chg: growth(val(q.values, 2026, 1), val(q.values, 2025, 1)),
  _href: M.ctx.href('vedomstvo', { code: M.code, program: q.code }),
});
const totalOf = (e) => ({
  label: 'Общо',
  values: {
    total: val(e.values, 2026, 0),
    prb: val(e.values, 2026, 1),
    other: val(e.values, 2026, 2),
    chg: growth(val(e.values, 2026, 1), val(e.values, 2025, 1)),
  },
});
const programTable = (M, id, caption, e) =>
  dataTable({
    id,
    caption,
    columns: treeCols(),
    rows: e.programs.map((q) => rowOf(M, q)),
    total: totalOf(e),
    note: 'Сборът на програмите на една политика е сумата на политиката. Не събирай политиките и програмите заедно: програмите са същите пари на по-дребно.',
  });

/** the nine columns of one policy or programme in 2026, by level of expense */
function levelsTable(M, id, node) {
  const v = node.values;
  const lvl = (name, i) => ({
    name,
    total: val(v, 2026, i),
    prb: val(v, 2026, i + 1),
    other: val(v, 2026, i + 2),
  });
  return dataTable({
    id,
    caption: `Разходи на „${clip(node.name, 80)}“ през 2026 г. по вид, хил. €`,
    columns: [
      { key: 'name', label: 'Вид разходи' },
      amountCol('total', 'Общо'),
      amountCol('prb', 'По бюджета на ведомството'),
      amountCol('other', 'Други източници'),
    ],
    rows: [
      lvl('Консолидирани разходи', 0),
      lvl('Ведомствени разходи', 3),
      lvl('Администрирани разходи', 6),
    ],
    note: 'Ведомствените разходи са за дейността на самото ведомство. Администрираните са средства, които то управлява, но не за собствената си дейност. Двата вида заедно дават консолидираните разходи.',
  });
}

function yearsBlock(M, id, values) {
  const f = M.file;
  const rows = f.years.map((y, i) => ({
    y: f.yearLabels?.[i] ?? String(y),
    total: val(values, y, 0),
    prb: val(values, y, 1),
    other: val(values, y, 2),
  }));
  const missing = f.years.filter((y) => val(values, y, 1) === null);
  return block({
    id,
    title: 'По години, 2023–2028',
    status: 'real',
    source: f.meta.source,
    asOf: f.meta.asOf,
    scope: SCOPE,
    sub: 'Отчет, закон и проект на закона; 2027 и 2028 г. са прогноза.',
    body: html`${dataTable({
      id: `${id}-tab`,
      caption: 'Разходи по години, хил. €',
      columns: [
        { key: 'y', label: 'Година' },
        amountCol('total', 'Общо'),
        amountCol('prb', 'По бюджета на ведомството'),
        amountCol('other', 'Други източници'),
      ],
      rows,
      note: missing.length ? `За ${missing.join(', ')} г. в източника няма данни.` : null,
    })}`,
  });
}

/* ---------------------------------------------------------------- the original document */
const pages = (a) =>
  Array.isArray(a) && a.length
    ? a.length > 1
      ? `стр. ${a[0]}–${a[a.length - 1]}`
      : `стр. ${a[0]}`
    : '';
function docBlock(M, year = null) {
  const d = M.file?.doc;
  if (!d) return '';
  const f = M.file;
  const rows = f.years
    .filter((y) => !year || y === year)
    .map((y) => ({
      k: f.yearLabels?.[f.years.indexOf(y)] ?? String(y),
      v: pages(d.pagesByYear?.[String(y)]),
    }));
  return block({
    id: 's11-dokument',
    title: 'Отвори оригиналния документ',
    status: 'real',
    source: f.meta.source,
    asOf: f.meta.asOf,
    body: html`<p>Програмите са извлечени от програмния бюджет на ведомството. Оригиналът е в ${ext(d.archiveUrl, 'архива към законопроекта в parliament.bg')}.</p>
      ${facts([{ k: 'Файл в архива', v: d.file }, { k: 'Папка', v: d.archive }, { k: 'Страници с програмите', v: pages(d.pages) }, ...rows])}`,
  });
}

/* ---------------------------------------------------------------- the spender */
function lawBlock(M) {
  const { ctx, m, doc, pbl } = M;
  const b = m.billVsLaw || {};
  const rows = [
    ['Разходи', b.expKhil],
    ['Собствени приходи', b.revKhil],
    ['Трансфери (нето)', b.transfersKhil],
  ]
    .filter(([, x]) => x && ok(x.bill) && ok(x.law))
    .map(([what, x]) => ({ what, a: x.bill, b: x.law, d: ok(x.diff) ? x.diff : x.law - x.bill }));
  const prbOnly =
    pbl &&
    ok(pbl.prbKhil) &&
    ok(pbl.lawKhil) &&
    Math.abs(pbl.diffKhil) > 0.05 &&
    !(pbl.matchesBill && b.expKhil);
  if (prbOnly)
    rows.push({
      what: 'Разходи по програмния бюджет',
      a: pbl.prbKhil,
      b: pbl.lawKhil,
      d: pbl.lawKhil - pbl.prbKhil,
    });
  const lines = b.lines || {};
  const lineFacts = [
    [`Изменени редове в чл. ${m.art}`, lines.chg],
    ['Добавени редове', lines.add],
    ['Премахнати редове', lines.del],
  ]
    .filter(([, n]) => ok(n) && n > 0)
    .map(([k, v]) => ({ k, v: num(v, 0) }));
  const text = rows.length
    ? 'Сумите на ведомството в приетия закон се различават от тези в проекта на закона.'
    : `В чл. ${m.art} спрямо проекта са променени отделни редове.`;
  return block({
    id: 's11-zakon',
    title: 'Проект на закона и приет закон',
    status: 'real',
    source: ['zdb', 'bill'],
    asOf: doc.meta.asOf,
    scope: SCOPE,
    body: html`<p>${text}</p>
      ${
        rows.length
          ? dataTable({
              id: 's11-t-zakon',
              caption: 'Проект на закона и приет закон, хил. €',
              columns: [
                { key: 'what', label: 'Показател' },
                amountCol('a', 'Проект'),
                amountCol('b', 'Закон'),
                { key: 'd', label: 'Разлика', unit: 'хил. €', num: true, fmt: (v) => SGN(v) },
              ],
              rows,
              note: prbOnly
                ? 'Програмите по-долу са по програмния бюджет към проекта на закона.'
                : null,
            })
          : ''
      }
      ${lineFacts.length ? facts(lineFacts) : ''}
      <p class="s11-note">Всички промени между проекта и закона са описани в „<a href="${ctx.href('zakon')}">Пътят на бюджета</a>“.</p>`,
  });
}

function policiesBlock(M) {
  const { ctx, m, doc, file, list } = M;
  if (M.pending) {
    return html`${block({
      id: 's11-politiki',
      title: 'Политики по закона',
      status: 'real',
      source: doc.meta.source,
      asOf: doc.meta.asOf,
      scope: SCOPE,
      sub: 'Законът разпределя парите на ведомството по политики.',
      body: html`${dataTable({
        id: 's11-t-politiki',
        caption: 'Политики по закона, 2026 г., хил. €',
        columns: [{ key: 'name', label: 'Политика' }, amountCol('khil', 'Разходи')],
        rows: m.policies.map((p) => ({ name: p.name, khil: p.khil })),
        total: { label: 'Общо', values: { khil: m.expKhil } },
      })}`,
    })}
    ${block({
      id: 's11-p03',
      title: 'Програми',
      status: 'pending',
      source: ['prb'],
      asOf: doc.meta.asOf,
      body: pendingState({
        id: 'P03',
        title: 'Програмите на ведомството предстои да бъдат добавени',
        text: m.programs?.reason || 'Програмите на ведомството още не са извлечени.',
        source: ['prb'],
      }),
    })}`;
  }
  if (!file) {
    return block({
      id: 's11-politiki',
      title: 'Политики и програми',
      status: 'pending',
      body: errorState({
        title: 'Програмите не се заредиха.',
        text: 'Опитай пак след малко.',
        retry: true,
      }),
    });
  }
  const pols = list.filter((e) => e.level === 'policy'),
    solos = list.filter((e) => e.level === 'solo');
  const tier = doc.tiers?.[m.programs.tier];
  const differs = m.programs.tier === 'program-budget-differs';
  return block({
    id: 's11-politiki',
    title: 'Политики и програми през 2026 г.',
    status: differs ? 'partial' : 'real',
    statusLabel: differs ? 'Данни от проекта на закона' : undefined,
    source: file.meta.source,
    asOf: file.meta.asOf,
    scope: { key: 'prb-programi', label: 'Програмни бюджети', note: 'без ЕС и други средства' },
    sub: tier ? `${tier}.` : undefined,
    body: html`<p class="s11-text">Парите на ведомството са разпределени по ${plural(pols.length, 'политика', 'политики')}. Всяка политика се изпълнява чрез ${gl('byudzhetna-programa', 'бюджетни програми')}. Отвори политика, за да видиш програмите ѝ.</p>
      <div class="s11-pols">${pols.map((e) =>
        disclosure({
          id: anchor(e.code),
          title: e.name,
          meta: plural(e.programs.length, 'програма', 'програми'),
          open: pols.length === 1 && !solos.length,
          body: html`<p class="s11-pol-top"><a href="${ctx.href('vedomstvo', { code: m.id, program: e.code })}">Виж политиката поотделно</a></p>${programTable(M, `s11-t-${anchor(e.code)}`, `Програми на политика „${clip(e.name, 80)}“, 2026 г., хил. €`, e)}`,
        }),
      )}</div>
      ${
        solos.length
          ? html`<h3 class="s11-sub">Програми без политика</h3><p class="s11-text">Те не са част от нито една политика, например администрацията на ведомството.</p>${dataTable(
              {
                id: 's11-t-solo',
                caption: 'Програми без политика, 2026 г., хил. €',
                columns: treeCols(),
                rows: solos.map((e) => rowOf(M, e)),
              },
            )}`
          : ''
      }`,
  });
}

function skippedBlock(M) {
  const sk = Array.isArray(M.file?.skipped) ? M.file.skipped.filter(Boolean) : [];
  if (!sk.length) return '';
  return disclosure({
    id: 's11-propusnati',
    title: 'Редове, които не се показват',
    meta: num(sk.length, 0),
    body: html`<p>Тези редове в документа не можаха да се прочетат със сигурност и затова не са в таблиците.</p><ul>${sk.map((s) => html`<li>${s}</li>`)}</ul>`,
  });
}

function countKpi(M) {
  const { m, list } = M;
  const n = m.programs?.count;
  if (M.pending || !ok(n))
    return kpi({
      label: 'Политики и програми',
      value: null,
      sub: `Законът разпределя парите по ${plural(m.policies.length, 'политика', 'политики')}. Програмите предстоят.`,
    });
  const pol = list.filter((e) => e.level === 'policy').length,
    solo = list.filter((e) => e.level === 'solo').length;
  return kpi({
    label: 'Програми',
    value: num(n, 0),
    unit: n === 1 ? 'програма' : 'програми',
    sub: `${pol ? `В ${plural(pol, 'политика', 'политики')}` : 'Без политики'}${solo ? `; ${plural(solo, 'програма', 'програми')} без политика` : ''}.`,
  });
}
const transferSub = (k) =>
  !ok(k)
    ? 'Законът не посочва трансфери за ведомството.'
    : k < 0
      ? 'Отрицателна сума: ведомството предоставя повече средства, отколкото получава.'
      : 'Средства, които ведомството получава от централния бюджет.';

function ministryBody(M) {
  const { ctx, m, doc } = M;
  const kpis = [
    kpiK(M, {
      label: 'Разходи през 2026 г.',
      k: m.expKhil,
      sub: changeText(m),
      gl: 'byudzhetni-razhodi',
    }),
    kpiK(M, {
      label: 'Собствени приходи',
      k: m.revKhil,
      sub: ok(m.revKhil)
        ? 'Приходи, записани в бюджета на ведомството.'
        : 'Законът не посочва собствени приходи за ведомството.',
      gl: 'byudzhetni-prihodi',
    }),
    kpiK(M, {
      label: 'Трансфери (нето)',
      k: m.transfersKhil,
      sub: transferSub(m.transfersKhil),
      gl: 'byudzheten-transfer',
    }),
    countKpi(M),
  ];
  const star = m.change?.basis === 'program-budget';
  const summary = block({
    id: 's11-obshto',
    title: 'Накратко',
    status: 'real',
    source: doc.meta.source,
    asOf: doc.meta.asOf,
    scope: SCOPE,
    body: html`${kpiGrid(kpis, { label: 'Основни числа за ведомството' })}
      ${star ? html`<p class="s11-note">* Сравнението е по програмния бюджет към проекта на закона и по закона за 2025 г., не по приетия закон за 2026 г.</p>` : ''}
      ${M.differs ? callout({ kind: 'warn', title: 'Проектът и законът се различават', body: html`За това ведомство проектът на закона и приетият закон дават различни данни. <a href="${ctx.href('vedomstvo', { code: m.id }, { to: 's11-zakon' })}">Виж разликата</a>.` }) : ''}
      <p class="s11-text">${plainName(m)} е ${gl('parvostepenen-razporeditel-s-byudzhet', 'първостепенен разпоредител с бюджет')}: управлява бюджета си на най-високото ниво и носи отговорност за него.</p>
      ${facts([
        { k: 'Вид', v: NOUN[m.kind] },
        { k: 'Код', v: m.id },
        { k: 'Член от закона', v: `чл. ${m.art}` },
        { k: 'Програмен бюджет', v: doc.tiers?.[m.programs?.tier] },
      ])}`,
  });
  return html`${unitSwitch(ctx, { name: 's11-unit', note: '„% от БВП“ е спрямо планирания БВП за 2026 г.' })}
    ${summary}${M.differs ? lawBlock(M) : ''}${policiesBlock(M)}${M.file ? yearsBlock(M, 's11-godini', M.file.total) : ''}${skippedBlock(M)}${docBlock(M)}`;
}

/* ---------------------------------------------------------------- a policy or a programme */
function nodeBody(M) {
  const { ctx, m, file, node } = M;
  const v = node.values;
  const prb = val(v, 2026, 1),
    p25 = val(v, 2025, 1),
    base = val(file.total, 2026, 1);
  const share = ok(prb) && ok(base) && base > 0 ? (prb / base) * 100 : null;
  const kpis = [
    kpiK(M, {
      label: 'Разходи през 2026 г.',
      k: prb,
      sub: `По бюджета на ведомството: ${growth(prb, p25)}`,
      gl: 'byudzhetni-razhodi',
    }),
    kpiK(M, {
      label: 'Общо с други източници',
      k: val(v, 2026, 0),
      sub: 'Включва ЕС и други бюджети и сметки.',
    }),
    kpi({
      label: 'Дял от бюджета на ведомството',
      value: share === null ? null : share < 0.05 ? 'под 0,1' : num(share, 1),
      unit: '%',
      sub: `от разходите на ${plainName(m)} по програмния бюджет`,
    }),
  ];
  const has26 = !!v['2026'];
  return html`${unitSwitch(ctx, { name: 's11-unit', note: '„% от БВП“ е спрямо планирания БВП за 2026 г.' })}
    ${block({
      id: 's11-obshto',
      title: 'Накратко',
      status: 'real',
      source: file.meta.source,
      asOf: file.meta.asOf,
      scope: { key: 'prb-programi', label: 'Програмни бюджети', note: 'без ЕС и други средства' },
      body: html`${kpiGrid(kpis, { label: 'Основни числа' })}
        <p class="s11-text"><a href="${ctx.href('vedomstvo', { code: m.id })}">Назад към ${plainName(m)}</a>${M.parent ? html` · <a href="${ctx.href('vedomstvo', { code: m.id, program: M.parent.code })}">Политика: ${clip(M.parent.name, 60)}</a>` : ''}</p>`,
    })}
    ${block({
      id: 's11-razhodi',
      title: 'Как се разпределят разходите през 2026 г.',
      status: has26 ? 'real' : 'pending',
      source: file.meta.source,
      asOf: file.meta.asOf,
      body: has26
        ? levelsTable(M, 's11-t-razhodi', node)
        : html`<p class="s11-text">В източника няма данни за 2026 г. за тази ${node.level === 'policy' ? 'политика' : 'програма'}.</p>`,
    })}
    ${
      node.level === 'policy' && node.programs.length
        ? block({
            id: 's11-programi',
            title: 'Програми на политиката',
            status: 'real',
            source: file.meta.source,
            asOf: file.meta.asOf,
            scope: {
              key: 'prb-programi',
              label: 'Програмни бюджети',
              note: 'без ЕС и други средства',
            },
            body: programTable(
              M,
              's11-t-programi',
              `Програми на политика „${clip(node.name, 80)}“, 2026 г., хил. €`,
              node,
            ),
          })
        : ''
    }
    ${yearsBlock(M, 's11-godini', v)}${docBlock(M, 2026)}`;
}

/* ---------------------------------------------------------------- the module */
export function render(ctx) {
  if (isFramework(ctx)) return institutionView(ctx);
  const M = modelOf(ctx);
  const h = head(M);
  return { ...h, body: M.node ? nodeBody(M) : ministryBody(M) };
}

export function crumbs(ctx) {
  if (isFramework(ctx)) return undefined;
  const M = modelOf(ctx);
  const c = [{ label: 'Кой харчи?', href: ctx.href('vedomstva') }];
  if (!M.node) return [...c, { label: labelOf(M.m) }];
  c.push({ label: plainName(M.m), href: ctx.href('vedomstvo', { code: M.code }) });
  if (M.parent)
    c.push({
      label: clip(M.parent.name, 50),
      href: ctx.href('vedomstvo', { code: M.code, program: M.parent.code }),
    });
  return [...c, { label: clip(M.node.name, 50) }];
}

export function next(ctx) {
  if (isFramework(ctx)) return [{ title: 'Към списъка с ведомства', href: billListHref(ctx) }];
  const M = modelOf(ctx);
  if (!M.node) return ['S15', 'S10'];
  return [
    {
      kicker: 'Следва',
      title: plainName(M.m),
      text: 'Всички политики и програми на ведомството.',
      href: ctx.href('vedomstvo', { code: M.code }),
    },
    'S10',
  ];
}

export function mount(root, ctx) {
  if (isFramework(ctx)) return mountBillSearch(root, ctx);
  const offs = [bindUnitSwitch(root, ctx, 's11-unit')];
  return () =>
    offs.forEach((f) => {
      try {
        f?.();
      } catch {
        /* a cleanup must never throw */
      }
    });
}
