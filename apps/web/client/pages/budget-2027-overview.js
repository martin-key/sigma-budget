// S34 · Бюджет 2027, the main view of the November bill (variant „Основен проект“): the answer first, then the comparison with 2026 and
// 2025, the capital expenditure, where the money comes from and goes to, the measures, the institutions, the investment projects, the
// municipalities, the debt and the state budget by article 1. Every number is read from the release (budget2027, outlook, revenue,
// expenditure, ministries) or is a plain sum or difference of printed numbers that the text names. Block ids start with „b27-“: the
// „s34-“ ids of the October plan stay that document's addresses (budget-documents.js).
import { html } from '../html.js';
import { num, pct, money, NBSP, DASH, arrow } from '../format.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { chart } from '../ui/chart.js';
import { dataTable, tableData } from '../ui/table.js';
import { ranklist } from '../ui/ranklist.js';
import { chips } from '../ui/chips.js';
import { linkCard } from '../ui/cards.js';
import { gl } from '../ui/gl.js';
import { institutions, cellValue, headline, stateDebt, strictSum } from '../budget-2027.js';
import {
  COMPARE,
  CAPEX_YEARS,
  comparison,
  cellOf,
  change,
  lawTotals,
  periodHead,
  periodWord,
} from '../budget-2027-compare.js';
import { measureText } from '../measures-2027.js';
import { periodByKey } from '../periods.js';
import { byId } from '../routes.js';
import { base, projectsBlocks, variantControl, publication, keep } from './bill-views.js';

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const yr = (y) => `${y}${NBSP}г.`;
// the site's default: млрд. € with two decimals from a billion, млн. € with one below it
const bn = (mln) => money(mln);
const mlnTxt = (mln, d = 1) => money(mln, { scale: 'mln', d });
const signed = (v, d = 1) => (ok(v) ? num(v, d, { sign: true }) : DASH);
const KFP_SOURCE = ['budget2027', 'asbp'];
const DRAFT = '2027.draft',
  PREV = '2026.expected';
const draftStatus = { status: 'real', statusLabel: '2027 · Законопроект' };
/** the colour of the 2027 draft on every chart of the screen: the accent (series 3) */
const DRAFT_COLOR = 3;
// the scope chips of the institution and municipal blocks, as on their own screens (bill-views.js)
const INSTITUTIONS = {
  key: 'institution-budgets',
  label: 'Бюджети на ведомствата',
  long: 'Бюджети на ведомствата по законопроекта за ЗДБРБ, не е целият бюджет',
  note: 'не е целият бюджет',
  gl: null,
};
const MUNICIPAL = {
  key: 'municipal-transfers',
  label: 'Трансфери към общините',
  long: 'Трансфери от държавния бюджет към общинските бюджети',
  gl: null,
};
/** a short column head: „2025 · предв. отчет“, „2026 · очаквано“, „2027 · проект“ */
const periodShort = (data, key) =>
  `${periodByKey(key).year} · ${periodWord(data, key)
    .replace('предварителен', 'предв.')
    .replace('законопроект', 'проект')}`;

/** the comparison rows by id, and the value of one of them in one period */
function model(ctx) {
  const rows = comparison(ctx.data);
  const byKey = Object.fromEntries(rows.map((r) => [r.id, r]));
  const at = (id, key = DRAFT) => byKey[id]?.cells?.[key] || null;
  const v = (id, key = DRAFT) => at(id, key)?.value ?? null;
  return { rows, byKey, at, v };
}
/** „повече“ or „по-малко“ for a signed difference, without a value judgement */
const moreLess = (d, more = 'повече', less = 'по-малко') => (d > 0 ? more : less);
const to = (ctx, id) => ctx.href('S34', {}, { to: id });

/* ---------------------------------------------------------------- on this page */
function onThisPage(ctx) {
  const items = [
    ['b27-nakratko', 'Накратко'],
    ['b27-sravnenie', 'Спрямо 2026 и 2025'],
    ['b27-kapitalovi', 'Капиталови разходи'],
    ['b27-prihodi', 'Приходи'],
    ['b27-razhodi', 'Разходи'],
    ['b27-merki', 'Мерки'],
    ['b27-vedomstva', 'Ведомства'],
    ['s34-projects', 'Инвестиционни проекти'],
    ['b27-obshtini', 'Общини'],
    ['b27-dalg', 'Дълг'],
  ];
  return html`<nav class="b27-toc" aria-label="На тази страница">
    <p class="b27-toc-h">На тази страница</p>
    ${chips({ items: items.map(([id, label]) => ({ label, href: to(ctx, id) })) })}
  </nav>`;
}

/* ---------------------------------------------------------------- 1 · Накратко */
function nakratko(ctx, m) {
  const { v, at } = m;
  const rev = v('rev'),
    exp = v('exp'),
    bal = v('bal'),
    capex = v('exp.capex'),
    interest = v('exp.interest');
  const balPrev = at('bal', PREV),
    balNow = at('bal');
  const capexPrev = v('exp.capex', PREV);
  const debt = stateDebt(ctx.data.budget2027, DRAFT),
    debtPrev = stateDebt(ctx.data.budget2027, PREV);
  const debtNow = cellValue(debt?.total),
    debtBefore = cellValue(debtPrev?.total);
  const dl = (id) => {
    const c = m.byKey[id]?.change;
    return ok(c?.pct) ? { value: c.pct, d: 1, label: 'спрямо 2026' } : null;
  };
  const answer =
    ok(rev) && ok(exp) && ok(bal)
      ? html`<p class="b27-answer">
          През 2027 г. държавата планира да събере ${bn(rev)} и да похарчи ${bn(exp)}.
          ${
            bal < 0
              ? html`Разликата е дефицит от ${bn(-bal)}, или ${pct(Math.abs(balNow.pctGdp), 1)} от
              ${gl('bvp', 'БВП')}${
                ok(balPrev?.pctGdp)
                  ? html` (${pct(Math.abs(balPrev.pctGdp), 1)} очаквано за ${yr(2026)})`
                  : ''
              }.`
              : html`Разликата е излишък от ${bn(bal)}.`
          }
          ${
            ok(capex) && ok(capexPrev)
              ? html`Капиталовите разходи са ${bn(capex)}: с ${bn(Math.abs(capex - capexPrev))}
              ${moreLess(capex - capexPrev)} от очакваното за ${yr(2026)}`
              : ''
          }
          ${ok(interest) ? html`За лихви по дълга отиват ${bn(interest)}.` : ''}
        </p>`
      : '';
  const tiles = kpiGrid(
    [
      kpi({
        label: 'Приходи',
        gl: 'byudzhetni-prihodi',
        mln: rev,
        pctGdp: at('rev')?.pctGdp,
        delta: dl('rev'),
        sub: `${yr(2026)}: ${bn(v('rev', PREV))} · ${yr(2025)}: ${bn(v('rev', COMPARE[0]))}`,
      }),
      kpi({
        label: 'Разходи',
        gl: 'byudzhetni-razhodi',
        mln: exp,
        pctGdp: at('exp')?.pctGdp,
        delta: dl('exp'),
        sub: `С вноската в бюджета на ЕС. ${yr(2026)}: ${bn(v('exp', PREV))}`,
      }),
      kpi({
        label: bal < 0 ? 'Дефицит' : 'Излишък',
        gl: 'byudzheten-defitsit',
        mln: ok(bal) ? Math.abs(bal) : null,
        pctGdp: ok(balNow?.pctGdp) ? Math.abs(balNow.pctGdp) : null,
        delta:
          ok(balNow?.pctGdp) && ok(balPrev?.pctGdp)
            ? {
                value: Math.abs(balNow.pctGdp) - Math.abs(balPrev.pctGdp),
                unit: 'пр.п.',
                d: 1,
                label: 'от БВП спрямо 2026',
              }
            : null,
        sub: ok(balNow?.pctGdp) ? `${pct(Math.abs(balNow.pctGdp), 1)} от БВП` : '',
      }),
      kpi({
        label: 'Капиталови разходи',
        gl: 'kapitalovi-razhodi',
        mln: capex,
        pctGdp: at('exp.capex')?.pctGdp,
        delta: dl('exp.capex'),
        sub: `${yr(2026)}: ${bn(capexPrev)} · ${yr(2025)}: ${bn(v('exp.capex', COMPARE[0]))}`,
      }),
      kpi({
        label: 'Лихви по дълга',
        mln: interest,
        pctGdp: at('exp.interest')?.pctGdp,
        delta: dl('exp.interest'),
        sub: `${yr(2026)}: ${bn(v('exp.interest', PREV))}`,
      }),
      kpi({
        label: 'Държавен дълг в края на 2027 г.',
        mln: debtNow,
        pctGdp: cellValue(debt?.pctGdp),
        scope: 'zdd',
        delta: ok(change(debtNow, debtBefore).pct)
          ? { value: change(debtNow, debtBefore).pct, d: 1, label: 'спрямо края на 2026' }
          : null,
        sub: ok(cellValue(debt?.pctGdp)) ? `${pct(cellValue(debt.pctGdp), 1)} от БВП` : '',
      }),
    ],
    { label: 'Основни числа на проекта за 2027 г.' },
  );
  return block({
    id: 'b27-nakratko',
    title: 'Накратко',
    scope: 'kfp',
    ...draftStatus,
    source: KFP_SOURCE,
    asOf: ctx.data.budget2027?.publication,
    sub: 'Всички публични бюджети заедно (консолидираната фискална програма). Промяната е спрямо очакваното изпълнение за 2026 г.',
    share: {
      period: DRAFT,
      unit: 'млн. €',
      text: ok(rev)
        ? `Бюджет 2027 (законопроект): приходи ${bn(rev)}, разходи ${bn(exp)}, ${bal < 0 ? 'дефицит' : 'излишък'} ${bn(Math.abs(bal))}, капиталови разходи ${bn(capex)}.`
        : undefined,
    },
    body: html`<div class="stack">${answer}${tiles}</div>`,
  });
}

/* ---------------------------------------------------------------- 2 · Спрямо 2026 и 2025 */
function sravnenie(ctx, m) {
  const heads = COMPARE.map((k) => periodHead(ctx.data, k));
  const pick = ['rev', 'exp', 'bal', 'exp.capex', 'exp.interest'];
  const names = {
    rev: 'Приходи',
    exp: 'Разходи',
    bal: 'Дефицит',
    'exp.capex': 'Капиталови разходи',
    'exp.interest': 'Лихви',
  };
  const share = (id, k) => {
    const p = m.at(id, k)?.pctGdp;
    return ok(p) ? (id === 'bal' ? Math.abs(p) : p) : null;
  };
  // older years lighter, the draft in the accent colour: the same on every chart of the screen
  const colors = [2, 'other', DRAFT_COLOR];
  const spec = {
    id: 'b27-sravnenie-fig',
    type: 'barh',
    title: 'Основните показатели като дял от БВП',
    sub: '% от БВП',
    categories: pick.map((id) => names[id]),
    categoryLabel: 'Показател',
    unit: '%',
    d: 1,
    min: 0,
    fmt: (x) => pct(x, 1),
    labels: 'right',
    labelWidth: 'auto',
    height: pick.length * 100 + 60,
    series: COMPARE.map((k, i) => ({
      name: heads[i],
      color: colors[i],
      data: pick.map((id) => share(id, k)),
    })),
    desc: pick
      .map(
        (id) =>
          `${names[id]}: ${COMPARE.map((k, i) => `${pct(share(id, k), 1)} (${heads[i]})`).join(', ')}`,
      )
      .join('. '),
  };
  const label = (val, r) => html`<span class="b27-l b27-l${r.level}">${val}</span>`;
  const columns = [
    { key: 'label', label: 'Показател', fmt: label },
    ...COMPARE.map((k) => ({ key: k, label: periodShort(ctx.data, k), num: true, d: 1 })),
    {
      key: 'abs',
      label: 'Промяна, млн. €',
      num: true,
      fmt: (x) => (ok(x) ? html`<span class="b27-chg">${arrow(x)} ${signed(x)}</span>` : DASH),
    },
    { key: 'pct', label: 'Промяна, %', num: true, fmt: (x) => (ok(x) ? signed(x) : DASH) },
  ];
  const rows = m.rows.map((r) => ({
    label: r.label,
    level: r.level,
    ...Object.fromEntries(COMPARE.map((k) => [k, r.cells[k]?.value ?? null])),
    abs: r.change.abs,
    pct: r.id === 'bal' ? null : r.change.pct,
  }));
  const law = lawTotals(ctx.data);
  const same = [
    ['приходите', law.rev, m.v('rev', PREV)],
    ['разходите', law.exp, m.v('exp', PREV)],
    ['салдото', law.bal, m.v('bal', PREV)],
  ];
  const equal = same.filter(([, a, b]) => ok(a) && a === b).map(([w]) => w);
  const differ = same.filter(([, a, b]) => ok(a) && ok(b) && a !== b);
  const capexLaw = law.capex,
    capexExp = m.v('exp.capex', PREV);
  const lawNote = html`<p class="b27-note small">
    ${
      equal.length
        ? html`По приетия закон за ${yr(2026)} ${equal.join(', ').replace(/, ([^,]+)$/, ' и $1')} са
        същите като в очакваното изпълнение.`
        : ''
    }
    ${differ.map(([w, a]) => html` По закона ${w} са ${mlnTxt(a)}.`)}
    ${
      ok(capexLaw) && ok(capexExp) && capexLaw !== capexExp
        ? html` Капиталовите разходи по закона са ${mlnTxt(capexLaw)}, а очакваните — ${mlnTxt(capexExp)}.`
        : ''
    }
    Числата за ${yr(2025)} са ${periodWord(ctx.data, COMPARE[0])} от бюджетната прогноза, публикувана с
    бюджета за ${yr(2026)}
  </p>`;
  return block({
    id: 'b27-sravnenie',
    title: '2027 спрямо 2026 и 2025 г.',
    scope: 'kfp',
    ...draftStatus,
    source: KFP_SOURCE,
    asOf: ctx.data.budget2027?.publication,
    sub: 'Основните показатели на консолидираната фискална програма за три години: отчет, очаквано изпълнение и законопроект.',
    share: { period: COMPARE.join(' / '), unit: 'млн. €' },
    body: html`<div class="stack">
      ${chart(spec)}
      <h3 class="b27-sub">В милиони евро</h3>
      ${dataTable({
        id: 'b27-sravnenie-table',
        caption: 'Основни показатели на КФП: 2025, 2026 и 2027 г., в млн. евро',
        columns,
        rows,
        dense: true,
        note: '„Промяна“ е разликата между законопроекта за 2027 г. и очакваното изпълнение за 2026 г.',
      })}
      ${lawNote}
    </div>`,
  });
}

/* ---------------------------------------------------------------- 3 · Капиталови разходи */
function capexByInstitution(ctx) {
  const doc = ctx.data.budget2027;
  const names = new Map(
    (ctx.data.ministries?.items || []).map((i) => [String(i.id), i.name || i.short]),
  );
  const list = institutions(doc, 'bill')
    .map((i) => {
      const row = (doc.budgets.bill[i.article]?.rows || []).find((r) =>
        String(r.label).trim().startsWith('Капиталови разходи'),
      );
      return {
        code: i.code,
        name: names.get(i.code) || i.name,
        cell: row?.cell,
        value: cellValue(row?.cell),
      };
    })
    .filter((x) => ok(x.value));
  const total = strictSum(list.map((x) => x.cell));
  return { list: list.sort((a, b) => b.value - a.value), total };
}

function kapitalovi(ctx, m) {
  const doc = ctx.data.budget2027;
  const series = CAPEX_YEARS.map((k) => ({ key: k, cell: cellOf(ctx.data, 'exp.capex', k) }));
  const kind = (k) => periodByKey(k).status;
  const pick = (test) => series.map((s) => (test(kind(s.key)) ? (s.cell?.value ?? null) : null));
  const spec = {
    id: 'b27-kapitalovi-fig',
    type: 'bar',
    stack: true,
    title: 'Капиталови разходи по КФП',
    sub: 'млрд. €',
    // the year only: the legend says what kind of number each colour is, and six two-line labels do not fit a phone
    categories: series.map((s) => String(periodByKey(s.key).year)),
    categoryLabel: 'Година',
    interval: 0,
    unit: 'млрд. €',
    d: 2,
    min: 0,
    fmt: (x) => num(x / 1000, 2),
    labels: 'top',
    height: 320,
    series: [
      { name: 'Отчет', color: 2, data: pick((st) => st === 'report') },
      { name: 'Очаквано за 2026 г.', color: 'other', data: pick((st) => st === 'expected') },
      { name: 'Законопроект за 2027 г.', color: DRAFT_COLOR, data: pick((st) => st === 'draft') },
      { name: 'Прогноза', color: 8, data: pick((st) => st === 'forecast') },
    ],
    desc: `Капиталовите разходи по КФП: ${series
      .map((s) => `${bn(s.cell?.value)} (${periodHead(ctx.data, s.key)})`)
      .join(', ')}.`,
    table: {
      columns: [
        { key: 'y', label: 'Година' },
        { key: 'k', label: 'Вид данни' },
        { key: 'v', label: 'Капиталови разходи', unit: 'млн. €', num: true, d: 1 },
        { key: 'p', label: 'Дял от БВП', unit: '%', num: true, d: 1 },
      ],
      rows: series.map((s) => ({
        y: String(periodByKey(s.key).year),
        k: periodWord(ctx.data, s.key),
        v: s.cell?.value ?? null,
        p: s.cell?.pctGdp ?? null,
      })),
    },
  };
  const art1 = doc.budgets?.bill?.['1']?.rows || [];
  const row = (prefix) =>
    art1.find((r) => String(r.label).trim().startsWith(prefix) && r.no?.startsWith('2'));
  const stateCapex = cellValue(row('Капиталови разходи')?.cell),
    stateAssets = cellValue(row('Придобиване на дълготрайни активи')?.cell);
  const projects = cellValue(doc.projectAnnualSums?.[DRAFT]);
  const annex9 = doc.forecast?.annex9 || [];
  const municipal = annex9.find((r) => /Целева субсидия за капиталови разходи/.test(r.label));
  const municipalNow = cellValue(municipal?.cells?.['0']);
  const inst = capexByInstitution(ctx);
  const SHOWN = 8;
  const rest = inst.list.slice(SHOWN);
  const restSum = rest.length ? strictSum(rest.map((x) => x.cell)) : null;
  const items = [
    ...inst.list.slice(0, SHOWN).map((x) => ({
      label: x.name,
      value: x.value / 1000,
      href: ctx.href('S11', { code: x.code }, { per: DRAFT }),
    })),
    ...(ok(restSum)
      ? [{ label: `Други ${num(rest.length)} ведомства`, value: restSum / 1000 }]
      : []),
  ];
  const capex = m.v('exp.capex'),
    prev = m.v('exp.capex', PREV),
    c = change(capex, prev);
  return block({
    id: 'b27-kapitalovi',
    title: 'Капиталови разходи',
    scope: 'kfp',
    ...draftStatus,
    source: KFP_SOURCE,
    asOf: doc?.publication,
    sub: 'Парите за строителство, ремонти, техника и други дълготрайни активи.',
    share: {
      period: CAPEX_YEARS.join(' / '),
      unit: 'млн. €',
      chart: spec.id,
      text: ok(capex)
        ? `Капиталовите разходи по КФП в законопроекта за 2027 г. са ${bn(capex)}${ok(prev) ? `, при ${bn(prev)} очаквано за 2026 г.` : ''}.`
        : undefined,
    },
    body: html`<div class="stack">
      ${kpiGrid(
        [
          kpi({
            label: 'Всички публични бюджети (КФП)',
            mln: capex,
            pctGdp: m.at('exp.capex')?.pctGdp,
            delta: ok(c.pct) ? { value: c.pct, d: 1, label: 'спрямо 2026' } : null,
            sub: ok(m.at('exp.capex')?.pctGdp) ? `${pct(m.at('exp.capex').pctGdp, 1)} от БВП` : '',
          }),
          kpi({
            label: 'Държавен бюджет (чл. 1)',
            mln: ok(stateCapex) ? stateCapex / 1000 : null,
            sub: ok(stateAssets)
              ? `От тях ${bn(stateAssets / 1000)} за дълготрайни активи и основен ремонт.`
              : '',
          }),
          kpi({
            label: 'Инвестиционни проекти (Приложение 2)',
            mln: ok(projects) ? projects / 1000 : null,
            sub: `${num((doc.projects || []).length)} проекта, сбор на годишните суми за ${yr(2027)}`,
            href: to(ctx, 's34-projects'),
          }),
          kpi({
            label: 'Капиталова субсидия за общините',
            mln: ok(municipalNow) ? municipalNow / 1000 : null,
            sub: 'Целевата субсидия по Приложение 9.',
            href: ctx.href('S20', {}, { per: DRAFT }),
          }),
        ],
        { label: 'Капиталови разходи през 2027 г.' },
      )}
      <p class="b27-note">
        ${
          ok(capex) && ok(prev)
            ? html`Капиталовите разходи по КФП за ${yr(2027)} са ${bn(capex)} — с ${bn(Math.abs(c.abs))}
            ${moreLess(c.abs)} от очакваното за ${yr(2026)} (${pct(c.pct, 1, { sign: true })}).`
            : ''
        }
        КФП обхваща всички публични бюджети: държавния, общинските, осигурителните фондове и сметките за
        европейски средства. Държавният бюджет и инвестиционните проекти са част от тях, затова сумите не се
        събират.
      </p>
      ${chart(spec)}
      <h3 class="b27-sub">Капиталови разходи по ведомства, ${yr(2027)}</h3>
      ${ranklist({
        id: 'b27-kapitalovi-vedomstva',
        caption: 'Капиталовите разходи в бюджетите на ведомствата, млн. €',
        items,
        fmt: (x) => mlnTxt(x, 1),
        categoryLabel: 'Ведомство',
        unitLabel: 'млн. €',
      })}
      <p class="b27-note small muted">
        Редът „Капиталови разходи“ от бюджета на всяко ведомство по законопроекта (чл. 2–48).
        ${ok(inst.total) ? html`Сборът е ${bn(inst.total / 1000)}.` : ''}
        <a href="${to(ctx, 's34-projects')}">Всички инвестиционни проекти</a> ·
        <a href="${ctx.href('S10', {}, { per: DRAFT })}">Бюджетите на ведомствата</a>
      </p>
    </div>`,
  });
}

/* ---------------------------------------------------------------- 4 · Приходи */
function twoYears(ctx, list, idPrefix) {
  const now = list.map((x) => x.now),
    before = list.map((x) => x.before);
  return {
    id: `${idPrefix}-fig`,
    type: 'barh',
    title: '',
    unit: 'млрд. €',
    d: 1,
    min: 0,
    fmt: (x) => num(x / 1000, 2),
    labels: 'right',
    labelWidth: 'auto',
    labelOverflow: 'break',
    categories: list.map((x) => x.name),
    categoryLabel: 'Вид',
    height: list.length * 62 + 60,
    series: [
      { name: periodHead(ctx.data, PREV), color: 'other', data: before },
      { name: periodHead(ctx.data, DRAFT), color: DRAFT_COLOR, data: now },
    ],
    desc: list
      .map((x) => `${x.name}: ${bn(x.now)} през ${yr(2027)} и ${bn(x.before)} през ${yr(2026)}`)
      .join(' '), // every part already ends with „г.“
  };
}
function biggestMoves(list) {
  const moved = list.map((x) => ({ ...x, c: change(x.now, x.before) })).filter((x) => ok(x.c.abs));
  const up = [...moved].sort((a, b) => b.c.abs - a.c.abs)[0];
  const down = [...moved].sort((a, b) => a.c.abs - b.c.abs)[0];
  return { up: up?.c.abs > 0 ? up : null, down: down?.c.abs < 0 ? down : null };
}
/** „приходите от …“: the group of revenue after the preposition */
const FROM = {
  dds: 'ДДС',
  osiguritelni: 'осигуровки',
  nedanachni: 'неданъчни източници',
  pomoshti: 'помощи и дарения (основно европейски средства)',
  ddfl: 'данъка върху доходите на физическите лица',
  akcizi: 'акцизи',
  korporativen: 'корпоративния данък',
  drugi: 'други данъци и мита',
};
function prihodi(ctx) {
  const rev = ctx.data.revenue;
  const now = (rev?.byPeriod?.[DRAFT] || {}).groups || {},
    before = (rev?.byPeriod?.[PREV] || {}).groups || {};
  const list = (rev?.groups || [])
    .map((g) => ({
      id: g.id,
      name: g.name,
      now: cellValue(now[g.id]),
      before: cellValue(before[g.id]),
    }))
    .filter((x) => ok(x.now))
    .sort((a, b) => b.now - a.now);
  if (!list.length) return '';
  const spec = { ...twoYears(ctx, list, 'b27-prihodi'), title: 'Приходи по видове' };
  const { up, down } = biggestMoves(list);
  return block({
    id: 'b27-prihodi',
    title: 'Приходи: откъде идват парите',
    scope: 'kfp',
    ...draftStatus,
    source: ['budget2027'],
    asOf: ctx.data.budget2027?.publication,
    sub: `Основните видове приходи през ${yr(2027)} спрямо очакваното за ${yr(2026)}`,
    share: { period: `${PREV} / ${DRAFT}`, unit: 'млн. €', chart: spec.id },
    body: html`<div class="stack">
      <p class="b27-note">
        ${up ? html`Най-много растат приходите от ${FROM[up.id] || up.name}: с ${bn(up.c.abs)} (${pct(up.c.pct, 1, { sign: true })}).` : ''}
        ${down ? html` Най-много намаляват приходите от ${FROM[down.id] || down.name}: с ${bn(Math.abs(down.c.abs))} (${pct(down.c.pct, 1, { sign: true })}).` : ''}
      </p>
      ${chart(spec)}
      <p class="b27-note small">
        <a href="${ctx.href('S06', {}, { per: DRAFT })}">Всички приходи за 2027 г.</a> ·
        <a href="${ctx.href('S12', {}, { per: DRAFT })}">Мерките, които променят приходите</a>
      </p>
    </div>`,
  });
}

/* ---------------------------------------------------------------- 5 · Разходи */
const FUNCTION_SHORT = {
  'Жилищно строителство, благоустройство, комунално стопанство и опазване на околната среда':
    'Жилища, благоустройство и околна среда',
  'Социално осигуряване, подпомагане и грижи': 'Социално осигуряване и подпомагане',
  'Култура, спорт, почивни дейности и религиозно дело': 'Култура и спорт',
  'Р-ди некласифицирани в другите функции': 'Некласифицирани разходи',
};
function razhodi(ctx) {
  const e = ctx.data.expenditure;
  const now = e?.byPeriod?.[DRAFT]?.functions || [],
    before = new Map(
      (e?.byPeriod?.[PREV]?.functions || []).map((f) => [f.label, cellValue(f.cell)]),
    );
  const list = now
    .map((f) => ({
      name: FUNCTION_SHORT[f.label] || f.label,
      full: f.label,
      now: cellValue(f.cell),
      before: before.get(f.label) ?? null,
    }))
    .filter((x) => ok(x.now))
    .sort((a, b) => b.now - a.now);
  if (!list.length) return '';
  const spec = { ...twoYears(ctx, list, 'b27-razhodi'), title: 'Разходи по функции' };
  const { up, down } = biggestMoves(list);
  const low = (s) => s.charAt(0).toLowerCase() + s.slice(1);
  return block({
    id: 'b27-razhodi',
    title: 'Разходи: за какво отиват парите',
    scope: 'kfp',
    ...draftStatus,
    source: ['budget2027'],
    asOf: ctx.data.budget2027?.publication,
    sub: `Разходите по функции през ${yr(2027)} спрямо очакваното за ${yr(2026)}, без вноската в бюджета на ЕС.`,
    share: { period: `${PREV} / ${DRAFT}`, unit: 'млн. €', chart: spec.id },
    body: html`<div class="stack">
      <p class="b27-note">
        ${up ? html`Най-много растат разходите за ${low(up.name)}: с ${bn(up.c.abs)} (${pct(up.c.pct, 1, { sign: true })}).` : ''}
        ${down ? html` Най-много намаляват разходите за ${low(down.name)}: с ${bn(Math.abs(down.c.abs))} (${pct(down.c.pct, 1, { sign: true })}).` : ''}
        Разбивката по вид разход е в сравнението по-горе.
      </p>
      ${chart(spec)}
      <p class="b27-note small">
        <a href="${ctx.href('S07', {}, { per: DRAFT })}">Всички разходи за 2027 г.</a>
      </p>
    </div>`,
  });
}

/* ---------------------------------------------------------------- 6 · Мерки */
function merki(ctx) {
  const f = ctx.data.budget2027?.forecast || {};
  const total = (t) => cellValue(f[t]?.find((r) => r.label === 'Общо:')?.cells?.['0']);
  const all = ['II_7', 'II_8'].flatMap((t) =>
    (f[t] || [])
      .map((r, i) => ({ t, i, r, text: measureText(t, i, r.label), v: cellValue(r.cells?.['0']) }))
      .filter((x) => x.r.label !== 'Общо:' && ok(x.v)),
  );
  const top = [...all].sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 6);
  const word = (x) =>
    x.t === 'II_7'
      ? x.v > 0
        ? 'приходна мярка · повече приходи'
        : 'приходна мярка · по-малко приходи'
      : x.v > 0
        ? 'разходна мярка · повече разходи'
        : 'разходна мярка · по-малко разходи';
  const count = (t) => (f[t] || []).filter((r) => r.label !== 'Общо:').length;
  const rev = total('II_7'),
    exp = total('II_8');
  const list = (key) => ctx.href('S12', {}, { per: DRAFT, spisak: key });
  // the bars show the size of the effect; the CSV keeps its sign
  const csv = () =>
    tableData({
      columns: [
        { key: 'name', label: 'Мярка' },
        { key: 'kind', label: 'Вид' },
        { key: 'table', label: 'Таблица' },
        { key: 'v', label: 'Ефект през 2027 г.', unit: 'млн. €', num: true, d: 1 },
      ],
      rows: top.map((x) => ({
        name: x.text?.name || x.r.label,
        kind: word(x),
        table: x.t.replace('_', '-'),
        v: x.v,
      })),
    });
  return block({
    id: 'b27-merki',
    title: 'Мерки в бюджета',
    scope: {
      key: 'fiscal-measures',
      label: 'Фискални мерки',
      long: 'Приходни и разходни мерки по АСБП 2027–2029',
    },
    ...draftStatus,
    source: ['budget2027'],
    asOf: ctx.data.budget2027?.publication,
    sub: 'Новите промени в данъците, осигуровките и разходите, с които МФ разчита бюджета. Сумите са промяната спрямо предходната година.',
    share: { period: DRAFT, unit: 'млн. €', table: csv },
    body: html`<div class="stack">
      ${kpiGrid(
        [
          kpi({
            label: 'Приходни мерки през 2027 г.',
            value: signed(rev),
            unit: 'млн. €',
            sub: `${num(count('II_7'))} мерки, общо по Табл. II-7.`,
            href: list('prihodni'),
          }),
          kpi({
            label: 'Разходни мерки през 2027 г.',
            value: signed(exp),
            unit: 'млн. €',
            sub: `${num(count('II_8'))} мерки, общо по Табл. II-8. ${ok(exp) ? (exp < 0 ? 'Нетно по-малко разходи.' : 'Нетно повече разходи.') : ''}`,
            href: list('razhodni'),
          }),
        ],
        { label: 'Сборове на мерките за 2027 г.' },
      )}
      <h3 class="b27-sub">Мерките с най-голям ефект през ${yr(2027)}</h3>
      ${ranklist({
        id: 'b27-merki-top',
        caption: 'Ефект през 2027 г., млн. €',
        ordered: true,
        items: top.map((x) => ({
          label: x.text?.name || x.r.label,
          sub: word(x),
          value: Math.abs(x.v),
          raw: x.v,
          href: ctx.href('S12', {}, { per: DRAFT, to: `s12-${x.t}-${x.i}-0` }),
        })),
        fmt: (_, it) => `${signed(it.raw)}${NBSP}млн.${NBSP}€`,
        categoryLabel: 'Мярка',
      })}
      ${linkCard({
        href: ctx.href('S12', {}, { per: DRAFT }),
        kicker: 'Мерки в проекта за 2027',
        title: `Всички ${num(count('II_7') + count('II_8'))} мерки, с откъси от мотивите`,
        text: 'Сборове, приходни и разходни мерки, групирани и по закони.',
      })}
    </div>`,
  });
}

/* ---------------------------------------------------------------- 7 · Ведомства */
function vedomstva(ctx) {
  const doc = ctx.data.budget2027;
  const law = new Map((ctx.data.ministries?.items || []).map((i) => [String(i.id), i]));
  const rows = institutions(doc, 'bill')
    .map((i) => {
      const l = law.get(i.code);
      const now = cellValue(i.expenditure),
        before = ok(l?.expKhil) ? l.expKhil : null;
      const c = change(now, before);
      return {
        name: l?.name || l?.short || i.name,
        of: i.name, // the bill's own form after „на“: „Министерството на отбраната“
        code: i.code,
        before: ok(before) ? before / 1000 : null,
        now: ok(now) ? now / 1000 : null,
        abs: ok(c.abs) ? c.abs / 1000 : null,
        pct: c.pct,
        _href: ctx.href('S11', { code: i.code }, { per: DRAFT }),
      };
    })
    .filter((r) => ok(r.now))
    .sort((a, b) => b.now - a.now);
  if (!rows.length) return '';
  const top = rows.slice(0, 12);
  const grow = [...rows].filter((r) => ok(r.abs)).sort((a, b) => b.abs - a.abs)[0];
  return base(
    ctx,
    'b27-vedomstva',
    'Ведомства: 2027 спрямо 2026 г.',
    html`<div class="stack">
      ${
        grow
          ? html`<p class="b27-note">
            Най-голямо увеличение има бюджетът на ${grow.of}: с ${mlnTxt(grow.abs)}
            (${pct(grow.pct, 1, { sign: true })}) спрямо закона за ${yr(2026)}
          </p>`
          : ''
      }
      ${dataTable({
        id: 'b27-vedomstva-table',
        caption: 'Разходите на дванадесетте най-големи бюджета на ведомства, млн. евро',
        columns: [
          { key: 'name', label: 'Ведомство' },
          { key: 'before', label: '2026 · закон', unit: 'млн. €', num: true, d: 1 },
          { key: 'now', label: '2027 · законопроект', unit: 'млн. €', num: true, d: 1 },
          { key: 'pct', label: 'Промяна, %', num: true, fmt: (x) => (ok(x) ? signed(x) : DASH) },
          { key: 'code', label: 'Код', csvOnly: true },
        ],
        rows: top,
        dense: true,
      })}
      <p class="b27-note small">
        <a href="${ctx.href('S10', {}, { per: DRAFT })}">Всички ${num(rows.length)} ведомства</a> ·
        Разходите са заглавният ред „Разходи“ на бюджета на ведомството: по закона за ${yr(2026)} и по
        законопроекта за ${yr(2027)}
      </p>
    </div>`,
    {
      sub: 'Разходите на най-големите бюджети на ведомства по законопроекта, до приетия закон за 2026 г.',
      scope: INSTITUTIONS,
      share: { period: `2026.law / ${DRAFT}`, unit: 'млн. €' },
    },
  );
}

/* ---------------------------------------------------------------- 8 · Общини */
function obshtini(ctx) {
  const rows = ctx.data.budget2027?.forecast?.annex9 || [];
  const total = rows[0],
    capital = rows.find((r) => /Целева субсидия за капиталови разходи/.test(r.label));
  const at = (r, i) => cellValue(r?.cells?.[String(i)]);
  if (!total) return '';
  return base(
    ctx,
    'b27-obshtini',
    'Трансфери към общините',
    html`<div class="stack">
      ${kpiGrid(
        [
          kpi({
            label: 'Всички трансфери от държавния бюджет, 2027',
            mln: ok(at(total, 0)) ? at(total, 0) / 1000 : null,
            sub: `${yr(2028)}: ${bn(at(total, 1) / 1000)} · ${yr(2029)}: ${bn(at(total, 2) / 1000)}`,
          }),
          kpi({
            label: 'От тях за капиталови разходи, 2027',
            mln: ok(at(capital, 0)) ? at(capital, 0) / 1000 : null,
            sub: `${yr(2028)}: ${bn(at(capital, 1) / 1000)} · ${yr(2029)}: ${bn(at(capital, 2) / 1000)}`,
          }),
        ],
        { label: 'Трансфери към общините' },
      )}
      <p class="b27-note small">
        <a href="${ctx.href('S20', {}, { per: DRAFT })}">Колко получава всяка от 265-те общини</a>
      </p>
    </div>`,
    {
      sub: 'Основните бюджетни взаимоотношения с общините по Приложение 9 към АСБП.',
      scope: MUNICIPAL,
      status: 'real',
      statusLabel: 'Законопроект 2027 и прогноза 2028–2029',
      share: { period: '2027.draft / 2028.forecast / 2029.forecast', unit: 'млн. €' },
    },
  );
}

/* ---------------------------------------------------------------- 9 · Дълг */
function dalg(ctx) {
  const doc = ctx.data.budget2027;
  const d = stateDebt(doc, DRAFT),
    before = stateDebt(doc, PREV);
  const limit = doc?.debtLimits?.['67'];
  if (!d) return '';
  return block({
    id: 'b27-dalg',
    title: 'Държавен дълг',
    scope: 'zdd',
    ...draftStatus,
    source: ['budget2027'],
    asOf: doc.publication,
    sub: 'Прогнозата на МФ за държавния дълг по Закона за държавния дълг и границата в законопроекта.',
    share: { period: `${PREV} / ${DRAFT}`, unit: 'млн. €' },
    body: html`<div class="stack">
      ${kpiGrid(
        [
          kpi({
            label: 'Дълг в края на 2027 г.',
            mln: cellValue(d.total),
            sub: `${pct(cellValue(d.pctGdp), 1)} от БВП`,
          }),
          kpi({
            label: 'Дълг в края на 2026 г. (очаквано)',
            mln: cellValue(before?.total),
            sub: `${pct(cellValue(before?.pctGdp), 1)} от БВП`,
          }),
          kpi({
            label: 'Максимален дълг по законопроекта (чл. 67)',
            value: ok(limit?.value) ? num(limit.value, 1) : null,
            unit: 'млрд. €',
            sub: 'Горна граница в края на 2027 г., не прогноза.',
          }),
        ],
        { label: 'Държавен дълг' },
      )}
      <p class="b27-note small">
        <a href="${ctx.href('S17', {}, { per: DRAFT })}">Дългът, финансирането и границите в законопроекта</a>
      </p>
    </div>`,
  });
}

/* ---------------------------------------------------------------- 10 · Държавен бюджет по чл. 1 */
function chl1(ctx, b) {
  return base(
    ctx,
    's34-bill',
    'Държавен бюджет по чл. 1',
    html`<div class="stack">
      ${variantControl(ctx)}
      ${kpiGrid(
        ['I', 'II'].map((s, i) =>
          kpi({
            label: ['Приходи на държавния бюджет', 'Разходи на държавния бюджет'][i],
            mln: ok(cellValue(headline(b, s))) ? cellValue(headline(b, s)) / 1000 : null,
            sub: `${num(cellValue(headline(b, s)), 1)}${NBSP}хил.${NBSP}€, както е в законопроекта`,
          }),
        ),
      )}
      <p class="b27-note small">
        Държавният бюджет е част от КФП. Разходите му не включват трансферите към общините, осигурителните
        фондове и сметките за европейски средства, които са на отделен ред.
        <a href="${ctx.href('S11', { code: 'art1' }, keep(ctx))}">Целият чл. 1 ред по ред</a>
      </p>
    </div>`,
    { sub: 'Основен проект. Вариантът на Министерския съвет съдържа само чл. 1 и 2.' },
  );
}

/* ---------------------------------------------------------------- 11 · Още */
function more(ctx) {
  const cards = [
    [
      ctx.href('S13', {}, { per: DRAFT }),
      'Прогноза',
      'Накъде вървим? 2027–2029',
      'Прогнозата на МФ до 2029 г. и макрорамката.',
    ],
    [
      ctx.href('S10', {}, { per: DRAFT }),
      'Ведомства',
      'Кой харчи? Бюджетите на ведомствата',
      'Всички 47 бюджета по законопроекта, с търсене.',
    ],
    [
      ctx.href('S12', {}, { per: DRAFT }),
      'Мерки',
      'Мерки в проекта за 2027',
      'Всяка мярка с откъс от мотивите.',
    ],
    [
      ctx.href('S20', {}, { per: DRAFT }),
      'Общини',
      'Трансферите към всяка община',
      '265 общини по чл. 52 и 53.',
    ],
    [
      ctx.href('S17', {}, { per: DRAFT }),
      'Дълг',
      'Колко дължим?',
      'Дългът по ЗДД и границите за 2027 г.',
    ],
    [
      ctx.href('S34', {}, { dokument: 'plan' }),
      'Предходна публикация',
      'Проект на бюджетен план до ЕК',
      'От 15.10.2026, по ЕСС 2010.',
    ],
  ];
  return html`<section class="b27-more" aria-labelledby="b27-more-h">
    <h2 class="b27-more-h" id="b27-more-h">Разгледай подробно</h2>
    <div class="grid grid-2">${cards.map(([href, kicker, title, text]) => linkCard({ href, kicker, title, text }))}</div>
  </section>`;
}

/** the main view of the November bill */
export function overview(ctx, doc, b) {
  const m = model(ctx);
  const annual = !!(ctx.data.outlook && ctx.data.revenue && ctx.data.expenditure);
  const rev = m.v('rev'),
    exp = m.v('exp'),
    bal = m.v('bal'),
    capex = m.v('exp.capex');
  return {
    title: 'Бюджет 2027',
    answer:
      annual && ok(rev) && ok(exp) && ok(bal)
        ? `По законопроекта за 2027 г. приходите са ${bn(rev)}, разходите ${bn(exp)}, ${bal < 0 ? 'дефицитът' : 'излишъкът'} ${bn(Math.abs(bal))}${ok(m.at('bal')?.pctGdp) ? ` (${pct(Math.abs(m.at('bal').pctGdp), 1)} от БВП)` : ''}, а капиталовите разходи ${bn(capex)}.`
        : '',
    lede: 'Проектът на бюджета за 2027 г. и прогнозата за 2028–2029 г., публикувани от Министерството на финансите на 06.11.2026. Колко пари влизат и излизат, какво се променя спрямо 2026 и 2025 г., капиталовите разходи, мерките, ведомствата и общините.',
    context: html`<span>Законопроект, не е приет закон · МФ, 06.11.2026</span>`,
    body: html`
      ${onThisPage(ctx)}
      ${annual ? nakratko(ctx, m) : ''}
      ${annual ? sravnenie(ctx, m) : ''}
      ${annual ? kapitalovi(ctx, m) : ''}
      ${annual ? prihodi(ctx) : ''}
      ${annual ? razhodi(ctx) : ''}
      ${merki(ctx)}
      ${ctx.data.ministries ? vedomstva(ctx) : ''}
      ${projectsBlocks(ctx, doc)}
      ${obshtini(ctx)}
      ${dalg(ctx)}
      ${chl1(ctx, b)}
      ${more(ctx)}
      ${publication(doc)}`,
  };
}
