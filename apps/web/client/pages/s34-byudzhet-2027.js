// S34 · Бюджет 2027 (проект) · #/byudzhet-2027 · next S13 · periods none
// Data: dbp2027.json (D34), built by pipeline/budget_pipeline/build/budget_plan.py from the Draft Budgetary Plan of Bulgaria for 2027 (Министерство на финансите, 15.10.2026).
// Every number printed here is read from `figures` (each has the page of the plan, the unit and the basis) or is a plain sum/difference of two such numbers
// that the text names. The plan is on the ESA 2010 accrual basis (the whole „Държавно управление“ sector), NOT on the cash КФП basis: the two never share a chart or
// a table on this screen. The document is a forecast and a draft; nothing here is adopted. The screen has no period line (periods: none) and no controls.
import { html } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { chart } from '../ui/chart.js';
import { facts, callout } from '../ui/cards.js';
import { dataTable } from '../ui/table.js';
import { disclosure } from '../ui/disclosure.js';
import { timeline } from '../ui/timeline.js';
import { gl } from '../ui/gl.js';
import { byId } from '../routes.js';
import { num, pct, delta, money, moneyParts, date, NBSP } from '../format.js';

export const needs = ['core', 'dbp2027'];
export const styles = ['s34-byudzhet-2027'];

/* ---------------------------------------------------------------- helpers */
const ok = v => typeof v === 'number' && Number.isFinite(v);
const yr = y => `${y}${NBSP}г.`;
/** a number of the measures tables: whole numbers without decimals, the rest with one */
const dec = v => (Number.isInteger(v) ? 0 : 1);
const SRC = {
  plan: 'проектът на плана',
  'ec-edp-bg': 'страницата на Комисията за ППД на България',
  'ec-fiscal-bg': 'страницата на Комисията за фискалния надзор на България',
  'ec-dbp': 'страницата на Комисията за проектите на бюджетни планове'
};
const PROJECT = { status: 'forecast', statusLabel: 'Проект, не е прието' };

/** the figures of dbp2027.json and the small formatters used in the prose (a missing number prints an em dash, never a guess) */
function fx(ctx) {
  const d = ctx.data.dbp2027, F = d.figures || {};
  const v = id => (ok(F[id]?.v) ? F[id].v : null);
  const abs = id => (v(id) == null ? null : Math.abs(v(id)));
  return {
    d, F, v, asOf: d.meta.asOf,
    P: (id, dd = 1) => pct(v(id), dd),                        // 4,3%
    A: (id, dd = 1) => pct(abs(id), dd),                      // |−4,3| -> 4,3%
    N: (id, dd = 1) => num(v(id), dd),                        // 4,3
    X: (id, dd = 1) => num(abs(id), dd),                      // |−4,3| -> 4,3
    PP: (id, dd = 1) => (v(id) == null ? '—' : `${num(v(id), dd)}${NBSP}пр.п.`),
    M: (id, dd = 1) => money(v(id), { scale: 'mln', d: dd }), // 3 428,4 млн. €
    B: (id, dd = 1) => money(Math.round(v(id) * 1000), { scale: 'mlrd', d: dd }) // the figures are in млрд. €, money() takes млн. €: 47,1 -> 47,1 млрд. €
  };
}

/** every block of the screen carries the same four things: scope chip, status, the date of the data and a source button */
const common = (f, extra = {}) => ({ ...PROJECT, asOf: f.asOf, source: ['dbp2027'], ...extra });

/* ---------------------------------------------------------------- 1 · Накратко */
function kratkoBlock(f) {
  const { v, P, A, N, X, M, B } = f;
  const deficitEur = v('deficit.2027.eur');
  const measures = moneyParts(v('m.REV_TOTAL.2027'), { d: 2 });
  const tiles = kpiGrid([
    kpi({
      label: 'Дефицит през 2027 г.', gl: 'byudzheten-defitsit', value: X('n27.DEF', 1), unit: '% от БВП',
      sub: html`${deficitEur == null ? '' : `Около ${money(Math.abs(deficitEur), { scale: 'mlrd', d: 1 })} (наше пресмятане, планът не го изписва). `}През ${yr(2026)}: ${f.A('n26.DEF_FORECAST')} по прогнозата на МФ.`
    }),
    kpi({
      label: 'Приходи и разходи през 2027 г.', value: `${N('t4.rev.TR.pct.2027', 1)} / ${N('n27.EXP_SHARE', 1)}`, unit: '% от БВП',
      sub: 'Разликата между тях е дефицитът.'
    }),
    kpi({
      label: 'Дълг по Маастрихт в края на 2027 г.', value: N('t4.debt.GROSS.pct.2027', 1), unit: '% от БВП', scope: 'maastricht',
      sub: `${B('d.GROSS.2027')}. Референтната стойност в ЕС е ${pct(v('rule.REF_DEBT'), 0)}.`
    }),
    kpi({
      label: 'Нови приходни мерки през 2027 г.', value: measures.v, unit: measures.u,
      sub: `${pct(v('m.REV_TOTAL.2027.pct'), 2)} от БВП. Най-голям е еднократният данък върху свръхпечалбата: ${M('m27.WINDFALL', 0)}.`
    }),
    kpi({
      label: 'Разходи за отбрана през 2027 г.', value: N('def.SHARE', 1), unit: '% от БВП',
      sub: `${M('def.ESA.2027')} по ЕСС, ${delta(v('def.GROWTH.2027'), 1)} спрямо ${yr(2026)}`
    })
  ], { label: 'Основни числа от проекта на плана за 2027 г.' });

  return block({
    id: 's34-kratko', title: 'Накратко', scope: 'esa', ...common(f),
    sub: 'Най-важното от проекта на бюджетния план за 2027 г.',
    share: { text: `Проект на бюджетен план за 2027 г. (не е прието, ЕСС 2010): дефицит ${A('n27.DEF')} от БВП, дълг по Маастрихт ${P('t4.debt.GROSS.pct.2027')} от БВП.` },
    body: html`<div class="stack">
      ${tiles}
      <p class="s34-note">Всички числа са прогноза на Министерството на финансите, не са отчет. Не са приети от Народното събрание.</p>
      ${facts([
        { k: 'Какво е', v: html`${gl('proekt-na-byudzheten-plan', 'Проект на бюджетен план')} за 2027 г. Всяка година държавите от еврозоната го изпращат до Европейската комисия и до Еврогрупата до 15 октомври (Регламент (ЕС) № 473/2013).` },
        { k: 'Кой го прави', v: 'Министерството на финансите. Министерският съвет го е одобрил и е изпратил на Народното събрание „за информация“.' },
        { k: 'Какво не е', v: html`Не е законът за държавния бюджет за 2027 г. (ЗДБРБ 2027). Не е и план или отчет по ${gl('kfp', 'КФП')}.` },
        { k: 'Как са смятани числата', v: html`По ${gl('ess-2010', 'ЕСС 2010')}: на начислена основа, за целия ${gl('sektor-darzhavno-upravlenie', 'сектор „Държавно управление“')}. Затова не съвпадат с числата по КФП. Дяловете са ${gl('dyal-ot-bvp', '% от БВП')}.` }
      ])}
    </div>`
  });
}

/* ---------------------------------------------------------------- 2 · ППД и правилата на ЕС */
function capsSpec(f) {
  const { v, P } = f;
  const ys = [2026, 2027, 2028, 2029];
  const cap = ys.map(y => v(`rule.NETEXP_CAP.${y}`));
  const cum = ys.map(y => v(`rule.NETEXP_CUM.${y}`));
  const mf = ys.map(y => v(`t4.netexp.growth.${y}`));
  const tx = x => pct(x, 1);
  return {
    id: 's34-caps', type: 'bar', title: 'Ръст на нетните разходи: таван и оценка на МФ', sub: '% спрямо предходната година',
    categories: ys.map(String), categoryLabel: 'Година', interval: 0, min: 0, d: 1, fmt: tx, unit: '%', height: 300, labels: 'top',
    series: [
      { name: 'Таван по препоръката на Съвета', color: 1, data: cap },
      { name: 'Оценка на МФ (проект на плана)', color: 2, data: mf }
    ],
    desc: `Таван на годишния ръст на нетните разходи по препоръката на Съвета на ЕС: ${ys.map((y, i) => `${tx(cap[i])} през ${yr(y)}`).join(', ')}. Оценка на МФ по проекта на плана: ${P('t4.netexp.growth.2026')} през ${yr(2026)} и ${P('t4.netexp.growth.2027')} през ${yr(2027)} За ${yr(2028)} и ${yr(2029)} планът не дава оценка.`,
    table: {
      columns: [{ key: 'y', label: 'Година' }, { key: 'cap', label: 'Таван на годишния ръст', unit: '%', d: 1, num: true }, { key: 'cum', label: 'Таван, натрупано от 2026 г.', unit: '%', d: 1, num: true }, { key: 'mf', label: 'Оценка на МФ', unit: '%', d: 1, num: true }],
      rows: ys.map((y, i) => ({ y: String(y), cap: cap[i], cum: cum[i], mf: mf[i] }))
    }
  };
}

function ppdBlock(ctx, f) {
  const { d, v, P, A, PP } = f;
  const steps = (d.edp?.steps || []).map(s => ({
    date: String(s.d), kind: s.kind, title: s.title,   // a year is stored as a number (the data validator refuses numeric strings), the timeline prints a string
    text: html`${s.text} <span class="s34-src">Източник: ${SRC[s.src] || s.src}${ok(s.p) ? `, стр.${NBSP}${s.p}` : ''}.</span>`
  }));
  const spec = capsSpec(f);

  const warn = callout({
    kind: 'warn', title: 'България е в процедура при прекомерен дефицит.',
    body: html`<p>Според проекта на плана Съветът на ЕС я е открил на ${date('2026-07-10')}${NBSP}г. с Решение (ЕС) 2026/1758. Причината е дефицитът: по прогнозата на Комисията той е ${A('n26.EC_FORECAST')} от БВП през ${yr(2026)}, а според плана ще остане над ${pct(v('rule.REF_DEFICIT'), 0)} и през ${yr(2027)}</p>`
  });

  return block({
    id: 's34-ppd', title: 'Процедура при прекомерен дефицит и правилата на ЕС', scope: 'esa', cls: 's34-ppd',
    ...common(f, { source: ['dbp2027', 'ec-edp-bg', 'ec-fiscal-bg', 'ec-dbp'] }),
    sub: 'Какво означава за България и докъде е стигнала процедурата.',
    share: { text: `България е в процедура при прекомерен дефицит. Според проекта на плана срокът за връщане под ${pct(v('rule.REF_DEFICIT'), 0)} от БВП е ${v('rule.EDP_END')}${NBSP}г. Оценката на Комисията за плана е най-късно до 30.11.2026.` },
    body: html`<div class="stack">
      ${warn}
      <h3 class="s34-sub">Какво означава това</h3>
      <p class="s34-note">${gl('protsedura-pri-prekomeren-defitsit', 'Процедурата при прекомерен дефицит')} (ППД) е мярка на ЕС. ЕС има две референтни стойности: дефицит до ${pct(v('rule.REF_DEFICIT'), 0)} от БВП и дълг до ${pct(v('rule.REF_DEBT'), 0)} от БВП. По числата на плана България е над първата (дефицит ${A('n27.DEF')} през ${yr(2027)}) и под втората (дълг ${P('t4.debt.GROSS.pct.2027')}).</p>
      <p class="s34-note">Съветът дава срок и път за връщане под ${pct(v('rule.REF_DEFICIT'), 0)}. Според плана срокът е ${v('rule.EDP_END')}${NBSP}г. Пътят е записан като таван за годишния ръст на ${gl('netni-razhodi', 'нетните разходи')}.</p>
      <p class="s34-note">Според плана бюджетът за ${yr(2026)} е приет късно и за мерките са останали около пет месеца (стр.${NBSP}8). По оценката на МФ ръстът на нетните разходи през ${yr(2026)} е ${P('t4.netexp.growth.2026')} и е над тавана (${P('rule.NETEXP_CAP.2026')}). През ${yr(2027)} е ${P('t4.netexp.growth.2027')} и е под тавана (${P('rule.NETEXP_CAP.2027')}).</p>
      ${chart(spec)}
      <h3 class="s34-sub">Докъде е стигнала процедурата</h3>
      ${timeline({ label: 'Стъпки на процедурата при прекомерен дефицит за България', items: steps })}
      <p class="s34-note">Комисията оценява проектите на бюджетни планове като „съответстващи“, „съответстващи до голяма степен“ или „с риск от несъответствие“. Не е потвърдено каква ще е оценката за България.</p>
      <h3 class="s34-sub">Контролна сметка</h3>
      <p class="s34-note">Контролната сметка записва натрупаните отклонения на нетните разходи от пътя, определен от Съвета (бележка 6, стр.${NBSP}9 на плана). Положителното число значи, че разходите са над пътя.</p>
      ${facts([
        { k: 'След 2026 г.', v: f.PP('rule.CONTROL.2026') + ' от БВП' },
        { k: 'След 2027 г., без клаузата за отбрана', v: PP('rule.CONTROL_PRE.2027') + ' от БВП' },
        { k: 'След 2027 г., с клаузата за отбрана', v: PP('rule.CONTROL.2027') + ' от БВП' },
        { k: 'Допустимо натрупано отклонение', v: 'до ' + PP('rule.CONTROL_MAX.2027') + ' от БВП' }
      ])}
      <p class="s34-note">Според плана към ${yr(2027)} отклонението е в съответствие с изискванията, ако се ползва клаузата за отбрана.</p>
      <h3 class="s34-sub">Три числа за дефицита през ${yr(2026)}</h3>
      <p class="s34-note">Идват от различни източници и не са едно и също число.</p>
      ${facts([
        { k: 'Прогноза на Европейската комисия (цитирана в плана)', v: A('n26.EC_FORECAST') + ' от БВП' },
        { k: 'Прогноза на МФ (проект на плана)', v: A('n26.DEF_FORECAST') + ' от БВП' },
        { k: 'Заложено в ЗДБРБ 2026', v: A('n26.DEF_TARGET') + ' от БВП' }
      ])}
      ${disclosure({
        id: 's34-sp1', title: 'Препоръка 1 към България от 10.07.2026 г.', meta: 'според таблица 8 на плана, стр. 37',
        body: html`<ul class="s34-list">
          <li>Да се придържа към тавана на нетните разходи и да ползва клаузата за отбрана.</li>
          <li>Да увеличи разходите за отбрана и сигурност, като пази устойчивостта на дълга.</li>
          <li>Мерките срещу поскъпването на енергията да са временни и насочени към уязвимите.</li>
          <li>Да се бори със сивата икономика.</li>
          <li>Да събира по-добре данъците.</li>
        </ul>`
      })}
      ${disclosure({
        id: 's34-ne-potvardeno', title: 'Какво не е потвърдено', meta: 'за процедурата',
        body: html`<ul class="s34-list">
          <li>Точният срок в препоръката на Съвета за „ефективни действия“. Текстът на препоръката не се отвори за проверка (EUR-Lex). Датата 15.10.2026 е по плана.</li>
          <li>Номерът на решението (2026/1758) и прогнозата на Комисията от ${A('n26.EC_FORECAST')}: те са само в плана. Датата на решението (10.07.2026) е и на страницата на Комисията.</li>
          <li>Дали Комисията вече е започнала оценката. На нейната страница към ${date('2026-10-16')}${NBSP}г. за България има само самият проект, без становище.</li>
        </ul>`
      })}
    </div>`,
    foot: 'Стр. 6, 8, 9 и 37 на плана; страниците на Комисията, посочени в бутона „Източник“.'
  });
}

/* ---------------------------------------------------------------- 3 · Какво правят новите мерки */
function measuresSpec(f) {
  const { v } = f;
  const ys = [2026, 2027];
  const none = ys.map(y => (v(`t6.bal.NL.${y}`) == null ? null : Math.abs(v(`t6.bal.NL.${y}`))));
  const plan = ys.map(y => (v(`t4.bal.NET_LENDING.pct.${y}`) == null ? null : Math.abs(v(`t4.bal.NET_LENDING.pct.${y}`))));
  const tx = x => pct(x, 1);
  return {
    id: 's34-deficit', type: 'bar', title: 'Дефицит без мерките и по плана', sub: '% от БВП (без знак)',
    categories: ys.map(String), categoryLabel: 'Година', interval: 0, min: 0, d: 1, fmt: tx, unit: '%', height: 280, labels: 'top',
    series: [
      { name: 'С непроменени политики (Табл. 6)', color: 'other', data: none },
      { name: 'По проекта на плана (Табл. 4)', color: '--esa', data: plan }
    ],
    desc: `Дефицит като дял от БВП. С непроменени политики: ${tx(none[0])} през ${yr(2026)} и ${tx(none[1])} през ${yr(2027)} По проекта на плана: ${tx(plan[0])} през ${yr(2026)} и ${tx(plan[1])} през ${yr(2027)}`,
    table: {
      columns: [{ key: 'y', label: 'Година' }, { key: 'none', label: 'С непроменени политики', unit: '% от БВП', d: 1, num: true }, { key: 'plan', label: 'По проекта на плана', unit: '% от БВП', d: 1, num: true }],
      rows: ys.map((y, i) => ({ y: String(y), none: none[i], plan: plan[i] }))
    }
  };
}

function measuresBlock(f) {
  const { d, v, M, P } = f;
  const money1 = x => (ok(x) ? html`${num(x, dec(x))}` : '—');
  const col = (label, unit) => ({ key: 'v', label, unit, num: true, fmt: money1 });
  const rows = list => list.map(m => ({ label: m.label, v: v(m.id), p: m.p }));
  const rev = rows(d.measures.revenue).sort((a, b) => b.v - a.v);
  const exp = rows(d.measures.expense).sort((a, b) => b.v - a.v);
  const nameCol = { key: 'label', label: 'Мярка', fmt: (val, row) => html`${val} <span class="s34-pg">· стр.${NBSP}${row.p}</span>` };   // the page of the plan sits in the name cell: a third column would scroll sideways on a phone
  return block({
    id: 's34-merki', title: 'Какво правят новите мерки', scope: 'esa', ...common(f),
    sub: 'Дефицитът без мерките и с мерките, и кои мерки са посочени в плана.',
    share: { text: `По проекта на плана дефицитът през ${yr(2027)} е ${f.A('n27.DEF')} от БВП, а при непроменени политики щеше да е ${pct(Math.abs(v('t6.bal.NL.2027')), 1)}. Новите приходни мерки са ${M('m.REV_TOTAL.2027')}.` },
    body: html`<div class="stack">
      <p class="s34-note">Според плана дефицитът при „непроменени политики“ е ${pct(Math.abs(v('t6.bal.NL.2026')), 1)} през ${yr(2026)} и ${pct(Math.abs(v('t6.bal.NL.2027')), 1)} през ${yr(2027)} С мерките той е ${f.A('t4.bal.NET_LENDING.pct.2026')} и ${f.A('n27.DEF')}.</p>
      ${chart(measuresSpec(f))}
      ${callout({ kind: 'info', title: 'Внимание при сравнението', body: html`<p>Планът не обяснява какво включва „непроменени политики“. Затова разликата не е сборът на мерките по-долу. Мерките за ${yr(2027)} са ${M('m.REV_TOTAL.2027')} приходи (${P('m.REV_TOTAL.2027.pct', 2)} от БВП).</p>` })}
      <h3 class="s34-sub">Приходни мерки</h3>
      <p class="s34-note">Най-голямата ${gl('prihodna-myarka', 'приходна мярка')} е ${gl('ednokraten-danak-svrahpechalba', 'еднократният данък върху свръхпечалбата')}: ставка ${f.N('m27.WINDFALL_RATE', 0)}% за ${yr(2027)} От данъка ${f.N('m27.WINDFALL_REBATE', 0)}% се преотстъпват за капиталови буфери или инвестиции. Ефектът е ${M('m27.WINDFALL', 0)}. Засяга банки, застрахователи, големи хранителни вериги, телекоми, обменни бюра и бързи кредити. Още не е приет.</p>
      ${dataTable({
        id: 's34-t-rev', caption: 'Приходни мерки за 2027 г., изброени в плана', columns: [nameCol, col('Ефект', 'млн. €')], rows: rev,
        total: { label: 'Общо по плана (включва и неизброени мерки)', values: { v: v('m.REV_TOTAL.2027') } }, dense: true
      })}
      <h3 class="s34-sub">Мерки по разходите</h3>
      <p class="s34-note">При ${gl('razhodna-myarka', 'разходните мерки')} положително число значи повече разходи, отрицателно — по-малко.</p>
      ${dataTable({
        id: 's34-t-exp', caption: 'Мерки по разходите за 2027 г., изброени в плана', columns: [nameCol, col('Ефект', 'млн. €')], rows: exp,
        total: { label: 'Общо по плана (включва и неизброени мерки)', values: { v: v('m.EXP_TOTAL.2027') } }, dense: true
      })}
      <p class="s34-note">Общите суми не са сбор от изброените редове: планът включва и мерки, които не са изброени. Нетното подобрение на дефицита от мерките е ${M('m27.NET_IMPROVEMENT')} (стр.${NBSP}32).</p>
    </div>`,
    foot: 'Стр. 21–22, 31–32 и 34–35 на плана.'
  });
}

/* ---------------------------------------------------------------- 4 · Приходи */
const REV_ROWS = [
  { c: 'D2', name: 'Данъци върху производството и вноса (ДДС, акцизи)' },
  { c: 'D5', name: 'Данъци върху доходите и богатството' },
  { c: 'D61', name: 'Социални осигуровки' },
  { c: 'OTHER_CUR', name: 'Други текущи приходи' },
  { c: 'D91', name: 'Данъци върху капитала' },
  { c: 'OTHER_CAP', name: 'Други капиталови приходи' }
];

function revenueSpec(f) {
  const { v } = f;
  const ys = [2025, 2026, 2027];
  const tx = x => pct(x, 1);
  const at = (c, y) => v(`t4.rev.${c}.pct.${y}`);
  return {
    id: 's34-rev', type: 'bar', stack: true, title: 'Приходи по видове', sub: '% от БВП',
    categories: ys.map(String), categoryLabel: 'Година', interval: 0, min: 0, d: 1, fmt: tx, unit: '%', height: 320,
    series: REV_ROWS.map((r, i) => ({ name: r.name, color: i + 1, data: ys.map(y => at(r.c, y)) })),
    desc: `Приходи като дял от БВП по видове за ${yr(2025)}, ${yr(2026)} и ${yr(2027)} Общо приходите са ${tx(at('TR', 2025))}, ${tx(at('TR', 2026))} и ${tx(at('TR', 2027))} от БВП. Числата за ${yr(2026)} и ${yr(2027)} са прогноза, за ${yr(2025)} — предварителни данни.`,
    table: {
      columns: [{ key: 'y', label: 'Година' }, ...REV_ROWS.map(r => ({ key: r.c, label: r.name, unit: '% от БВП', d: 1, num: true })),
        { key: 'TR', label: 'Общо приходи', unit: '% от БВП', d: 1, num: true }, { key: 'EU', label: 'От тях: трансфери от ЕС', unit: '% от БВП', d: 1, num: true }, { key: 'NOEU', label: 'Общо без трансфери от ЕС', unit: '% от БВП', d: 1, num: true }],
      rows: ys.map(y => ({ y: String(y), ...Object.fromEntries(REV_ROWS.map(r => [r.c, at(r.c, y)])), TR: at('TR', y), EU: at('EU_TR', y), NOEU: at('TR_NOEU', y) }))
    }
  };
}

function revenueBlock(f) {
  const { v, P, N, M } = f;
  return block({
    id: 's34-prihodi', title: 'Приходи', scope: 'esa', ...common(f),
    sub: `Откъде според плана идват парите през ${yr(2027)}`,
    share: { text: `Според проекта на плана приходите през ${yr(2027)} са ${num(v('n27.REV_TOTAL'), 0)}${NBSP}млн.${NBSP}€, ${P('t4.rev.TR.pct.2027')} от БВП (ЕСС 2010).` },
    body: html`<div class="stack">
      ${chart(revenueSpec(f))}
      <p class="s34-note">Приходите през ${yr(2027)} са ${num(v('n27.REV_TOTAL'), 0)}${NBSP}млн.${NBSP}€, с ${M('n27.REV_DELTA', 0)} (${delta(v('n27.REV_GROWTH'), 1)}) повече от ${yr(2026)} Като дял от БВП падат от ${P('t4.rev.TR.pct.2026')} на ${P('t4.rev.TR.pct.2027')}. Трансферите от ЕС падат от ${P('t4.rev.EU_TR.pct.2026')} на ${P('t4.rev.EU_TR.pct.2027')} от БВП.</p>
      <p class="s34-note">Ето какво се променя при ${gl('dds', 'ДДС')}, ${gl('aktsiz', 'акцизите')} и осигуровките.</p>
      ${facts([
        { k: 'ДДС', v: `${delta(v('n27.VAT_GROWTH'), 1)}, около ${num(v('n27.VAT_DELTA'), 0)}${NBSP}млн.${NBSP}€ повече` },
        { k: 'Акцизи', v: `${delta(v('n27.EXCISE_GROWTH'), 1)}, около ${num(v('n27.EXCISE_DELTA'), 0)}${NBSP}млн.${NBSP}€ повече` },
        { k: 'Социални осигуровки', v: `${delta(v('n27.SOC_GROWTH'), 1)}, около ${num(v('n27.SOC_DELTA'), 0)}${NBSP}млн.${NBSP}€ повече. Максималният осигурителен доход става ${num(v('m27.MOD_LEVEL'), 0)}${NBSP}€ от 01.01.2027${NBSP}г.` },
        { k: 'Данъци върху доходите и богатството', v: `${delta(v('n27.D5_GROWTH'), 1)}. Най-голямо влияние има еднократният данък върху свръхпечалбата.` }
      ])}
      <p class="s34-note small muted">Сборът на видовете може да се различава с 0,1 пр.п. от общата сума: планът предупреждава, че закръгляването може да засегне общите суми (стр.${NBSP}6). В текста на плана спадът на приходите е ${f.N('n27.FALL_REV_TEXT')} пр.п., а таблицата дава ${num(v('t4.rev.TR.pct.2026') - v('t4.rev.TR.pct.2027'), 1)} пр.п.</p>
    </div>`,
    foot: 'Таблица 4 и текстът на стр. 22–24 на плана.'
  });
}

/* ---------------------------------------------------------------- 5 · Разходи */
const EXP_ROWS = [
  { c: 'COMP', name: 'Заплати и възнаграждения на наетите' },
  { c: 'INTERM', name: 'Стоки и услуги (междинно потребление)' },
  { c: 'INTEREST', name: 'Лихви' },
  { c: 'SOC_CASH', name: 'Пенсии и социални помощи' },
  { c: 'SOC_KIND', name: 'Социални плащания в натура (здравеопазване)' },
  { c: 'SUBS', name: 'Субсидии' },
  { c: 'OTHER_CUR', name: 'Други текущи разходи' },
  { c: 'GFCF', name: 'Инвестиции (основен капитал)' },
  { c: 'CAP_TR', name: 'Капиталови трансфери' }
];

function expenseSpec(f) {
  const { v } = f;
  const tx = x => pct(x, 1);
  const at = (c, y) => v(`t4.exp.${c}.pct.${y}`);
  const rows = EXP_ROWS.map(r => ({ y: r.name, 2025: at(r.c, 2025), 2026: at(r.c, 2026), 2027: at(r.c, 2027) }));
  rows.push({ y: 'Общо разходи', 2025: at('TE', 2025), 2026: at('TE', 2026), 2027: at('TE', 2027) });
  return {
    id: 's34-exp', type: 'barh', title: 'Разходи по видове, 2026 и 2027', sub: '% от БВП',
    categories: EXP_ROWS.map(r => r.name), categoryLabel: 'Вид разход', min: 0, d: 1, fmt: tx, unit: '%', labels: 'right', labelWidth: 'auto', labelOverflow: 'break', height: EXP_ROWS.length * 64 + 60,
    series: [{ name: yr(2026), color: 'other', data: EXP_ROWS.map(r => at(r.c, 2026)) }, { name: yr(2027), color: '--esa', data: EXP_ROWS.map(r => at(r.c, 2027)) }],
    desc: `Разходи по видове като дял от БВП за ${yr(2026)} и ${yr(2027)} Общо разходите са ${tx(at('TE', 2026))} през ${yr(2026)} и ${tx(at('TE', 2027))} през ${yr(2027)} Числата са прогноза по проекта на плана.`,
    table: {
      columns: [{ key: 'y', label: 'Вид разход' }, ...[2025, 2026, 2027].map(y => ({ key: String(y), label: yr(y), unit: '% от БВП', d: 1, num: true }))],
      rows
    }
  };
}

function expenseBlock(f) {
  const { v, P, N, M } = f;
  return block({
    id: 's34-razhodi', title: 'Разходи', scope: 'esa', ...common(f),
    sub: `За какво според плана отиват парите през ${yr(2027)}`,
    share: { text: `Според проекта на плана разходите през ${yr(2027)} са ${P('n27.EXP_SHARE')} от БВП (ЕСС 2010), с ${f.N('n27.FALL_EXP_TEXT')} пр.п. по-малко от ${yr(2026)}` },
    body: html`<div class="stack">
      <p class="s34-note">Общо разходите са ${P('n27.EXP_SHARE')} от БВП през ${yr(2027)}, с ${f.N('n27.FALL_EXP_TEXT')} пр.п. по-малко от ${yr(2026)} (${P('t4.exp.TE.pct.2026')}).</p>
      ${chart(expenseSpec(f))}
      ${facts([
        { k: 'Разходи, финансирани от ЕС', v: `${N('t4.exp.EU_EXP.pct.2026')}% от БВП през ${yr(2026)} и ${N('t4.exp.EU_EXP.pct.2027')}% през ${yr(2027)}` },
        { k: 'Заплати и възнаграждения', v: `${delta(v('n27.COMP_GROWTH'), 1)} през ${yr(2027)}` },
        { k: 'Субсидии', v: `по-малко с ${num(Math.abs(v('n27.SUBS_DELTA')), 0)}${NBSP}млн.${NBSP}€ спрямо ${yr(2026)}` },
        { k: 'Инвестиции', v: `${N('t4.exp.GFCF.pct.2026')}% от БВП през ${yr(2026)} и ${P('n27.GFCF_SHARE')} през ${yr(2027)}: ${N('n27.CAPEX_NAT')} от национални средства и ${N('n27.CAPEX_EU')} по програми на ЕС (с разлика от закръгляването)` },
        { k: 'Лихви', v: `${P('t4.exp.INTEREST.pct.2027')} от БВП през ${yr(2027)}` }
      ])}
    </div>`,
    foot: 'Таблица 4 и текстът на стр. 23–26 на плана.'
  });
}

/* ---------------------------------------------------------------- 6 · Дълг */
function debtSpec(f) {
  const { v, P } = f;
  const ys = [2024, 2025, 2026, 2027];
  const lvl = [v('d.GROSS.2024'), v('t4.debt.GROSS.lvl.2025'), v('d.GROSS.2026'), v('d.GROSS.2027')];
  const share = [v('d.GROSS.pct.2024'), v('t4.debt.GROSS.pct.2025'), v('t4.debt.GROSS.pct.2026'), v('t4.debt.GROSS.pct.2027')];
  const tx = x => `${num(x, 1)}${NBSP}млрд.${NBSP}€`;
  const kind = ['Данни', 'Предварителни данни', 'Прогноза', 'Прогноза'];
  return {
    id: 's34-debt', type: 'bar', title: 'Дълг по Маастрихт в края на годината', sub: 'млрд. €',
    categories: ys.map(y => `${y}\n${y <= 2025 ? 'данни' : 'прогноза'}`), categoryLabel: 'Година', interval: 0, min: 0, d: 1, fmt: x => num(x, 1), unit: 'млрд. €', height: 300, labels: 'top',
    series: [
      { name: 'Данни до 2025 г.', color: '--data', data: lvl.map((x, i) => (i <= 1 ? x : null)) },
      { name: 'Прогноза', color: 'other', data: lvl.map((x, i) => (i >= 2 ? x : null)) }
    ],
    desc: `Дългът на сектор „Държавно управление“ по методиката на Маастрихт в края на годината: ${ys.map((y, i) => `${tx(lvl[i])} (${pct(share[i], 1)} от БВП) в края на ${yr(y)}`).join(', ')}. Данните за ${yr(2025)} са предварителни, за ${yr(2026)} и ${yr(2027)} — прогноза.`,
    table: {
      columns: [{ key: 'y', label: 'Година' }, { key: 'k', label: 'Вид данни' }, { key: 'lvl', label: 'Дълг', unit: 'млрд. €', d: 1, num: true }, { key: 'sh', label: 'Дял от БВП', unit: '%', d: 1, num: true }],
      rows: ys.map((y, i) => ({ y: String(y), k: kind[i], lvl: lvl[i], sh: share[i] }))
    }
  };
}

function debtBlock(ctx, f) {
  const { v, P, N, M, B } = f;
  return block({
    id: 's34-dalg', title: 'Дълг', scope: 'maastricht', ...common(f),
    sub: 'Колко ще дължи според плана държавата в края на 2027 г. по методиката на Маастрихт.',
    share: { text: `Според проекта на плана дългът по Маастрихт в края на ${yr(2027)} е ${B('d.GROSS.2027')}, ${P('t4.debt.GROSS.pct.2027')} от БВП. Референтната стойност в ЕС е ${pct(v('rule.REF_DEBT'), 0)}.` },
    body: html`<div class="stack">
      ${chart(debtSpec(f))}
      <p class="s34-note">${gl('darzhaven-dalg', 'Дългът')} расте от ${B('d.GROSS.2024')} в края на ${yr(2024)} до ${B('d.GROSS.2027')} в края на ${yr(2027)} Като дял от БВП това е от ${P('d.GROSS.pct.2024')} на ${P('t4.debt.GROSS.pct.2027')}. Остава под референтната стойност от ${pct(v('rule.REF_DEBT'), 0)}.</p>
      <p class="s34-note">Според плана дългът расте заради планираните дефицити, рефинансирането на стар дълг, растежа на разходите за отбрана и капитализирането на държавни дружества. Данните за ${yr(2025)} са предварителни (стр.${NBSP}28).</p>
      ${facts([
        { k: 'Заем по инструмента SAFE за отбрана', v: `${M('d.SAFE_LOAN')}. Споразумението е ратифицирано от Народното събрание. Получен е авансът от 15%: ${M('d.SAFE_ADVANCE', 0)}.` }
      ])}
      <p class="s34-links small">Дългът по КФП е друго число и е на друг екран: „<a href="${ctx.href('S17')}?obhvat=maastricht">${byId.S17.title}</a>“. Не ги сравнявай директно.</p>
    </div>`,
    foot: 'Стр. 28–29 и таблица 4 на плана.'
  });
}

/* ---------------------------------------------------------------- 7 · Защо ЕСС и КФП се различават */
function esaKfpBlocks(f) {
  const { v, P, N, M } = f;
  const explain = block({
    id: 's34-esa-kfp', title: 'Защо числата не съвпадат с КФП', scope: 'esa', ...common(f),
    sub: 'Пример: разходите за отбрана.',
    share: { text: 'Проектът на плана е по ЕСС 2010 (начислена основа), а КФП е на касова основа. Затова един и същ разход може да е в различна година.' },
    body: html`<div class="stack">
      <p class="s34-note">КФП отчита парите, когато са платени (${gl('kasova-osnova', 'касова основа')}). Проектът на плана е по ЕСС 2010 и записва разхода, когато възниква (${gl('nachislena-osnova', 'начислена основа')}). Затова един и същ разход може да е в различна година.</p>
      <p class="s34-note">Планът го казва за отбраната: към касовите разходи по КФП се прибавят „корекции за времево изместване“ според очакваните доставки на техника. Корекцията е ${M('def.ADJ.2026')} за ${yr(2026)} и ${num(v('def.ADJ.2027'), 1, { sign: true })}${NBSP}млн.${NBSP}€ за ${yr(2027)} (стр.${NBSP}27).</p>
      <p class="s34-note">Двете числа са на отделни места по-долу. Не ги слагаме на една графика или таблица: различните основи дават различни числа.</p>
      <div class="s34-pair">
        ${block({
    id: 's34-kfp-def', level: 3, title: 'Отбрана на касова основа (КФП)', scope: 'kfp', ...common(f),
    sub: 'Както е посочено в плана.',
    body: html`<div class="stack">${facts([
      { k: yr(2026), v: M('def.KFP_CASH.2026') },
      { k: yr(2027), v: M('def.KFP_CASH.2027') }
    ])}<p class="s34-note small muted">Това не е отделен план по КФП за 2027 г.: числото е само по функция „Отбрана“, както е в плана (стр.${NBSP}27).</p></div>`
  })}
        ${block({
    id: 's34-esa-def', level: 3, title: 'Отбрана на начислена основа (ЕСС)', scope: 'esa', ...common(f),
    sub: 'Числата, използвани в плана.',
    body: html`<div class="stack">${facts([
      { k: yr(2025), v: `${M('def.ESA.2025')} · ${N('t4.def.TOTAL.pct.2025')}% от БВП` },
      { k: yr(2026), v: `${M('def.ESA.2026')} · ${N('t4.def.TOTAL.pct.2026')}% от БВП` },
      { k: yr(2027), v: `${M('def.ESA.2027')} · ${N('def.SHARE')}% от БВП` },
      { k: `Растеж през ${yr(2027)}`, v: delta(v('def.GROWTH.2027'), 1) }
    ])}<p class="s34-note small muted">Растежът идва най-вече от капиталови разходи за очаквани доставки: боен самолет, патрулен кораб, бойна техника (стр.${NBSP}27).</p></div>`
  })}
      </div>
    </div>`
  });
  return explain;
}

/* ---------------------------------------------------------------- 8 · Какво още липсва */
function missingBlock(f) {
  const { d } = f;
  return block({
    id: 's34-lipsva', title: 'Какво още липсва', scope: 'esa', status: 'pending', statusLabel: 'Липсва · не е потвърдено', asOf: f.asOf, source: ['dbp2027', 'ec-dbp'],
    sub: 'Неща, които този екран не може да покаже, и защо.',
    share: false,
    body: html`<div class="stack">
      ${facts((d.missing || []).map(m => ({ k: m.title, v: m.text })))}
      <p class="s34-note">Проверихме документа и страниците на Комисията. Някои сайтове (на Министерството на финансите, на Съвета на ЕС, EUR-Lex и страницата на Народното събрание със законопроектите) не се отвориха за автоматична проверка. Затова не можем да потвърдим дали законопроектът за бюджета и средносрочната прогноза вече са публикувани.</p>
    </div>`
  });
}

/* ---------------------------------------------------------------- the screen */
export function render(ctx) {
  const f = fx(ctx);
  const when = date(f.d.doc.date);
  return {
    lede: `Това е проектът на плана, който България изпрати на Европейската комисия на ${when}${NBSP}г. Не е приет бюджет и не е законът за 2027${NBSP}г. Числата са прогноза на Министерството на финансите.`,
    context: `Проект, не е прието · ЕСС 2010 (не КФП) · МФ, ${when}`,
    body: html`
      ${kratkoBlock(f)}
      ${ppdBlock(ctx, f)}
      ${measuresBlock(f)}
      ${revenueBlock(f)}
      ${expenseBlock(f)}
      ${debtBlock(ctx, f)}
      ${esaKfpBlocks(f)}
      ${missingBlock(f)}
      <p class="s34-links small">Още по темата: <a href="${ctx.href('S13')}">${byId.S13.title}</a> · <a href="${ctx.href('S12')}">${byId.S12.title}</a> · <a href="${ctx.href('S17')}">${byId.S17.title}</a></p>`
  };
}
