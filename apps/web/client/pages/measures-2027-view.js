// S12 for the framework periods (2027.draft, 2028.forecast, 2029.forecast): the measures of tables II-7 and II-8 of the АСБП 2027–2029,
// laid out like the 2026 measures: the sums first, then one list per kind and one by law, each measure a card with its own title, its
// effect in 2027, 2028 and 2029 and the paragraph of the motives that explains it. The amounts and blanks are the release's
// (budget2027.json forecast.II_7 / II_8); titles, plain sentences and quotes are the checked companion in ../measures-2027.js.
// Every effect cell keeps the id the search links to (s12-II_7-<row>-<year index>); the printed table with the provenance of every cell
// stays as the CSV of each list, folded under the cards.
import { html } from '../html.js';
import { num, plural, NBSP, DASH } from '../format.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { dataTable, tableData } from '../ui/table.js';
import { tabs } from '../ui/tabs.js';
import { disclosure } from '../ui/disclosure.js';
import { callout, facts } from '../ui/cards.js';
import { gl } from '../ui/gl.js';
import { FRAMEWORK, cellValue } from '../budget-2027.js';
import { measureText, LAWS } from '../measures-2027.js';
import { periodByKey } from '../periods.js';
import {
  base,
  cellRow,
  cellColumns,
  frameworkRow,
  frameworkStatus,
  publication,
  unavailable,
  gap,
} from './bill-views.js';

const ok = (v) => typeof v === 'number' && Number.isFinite(v);
const yr = (y) => `${y}${NBSP}г.`;
const signed = (v) => (ok(v) ? num(v, 1, { sign: true }) : DASH);
const YEARS = FRAMEWORK.map((k) => periodByKey(k).year);
const TOTAL = 'Общо:';
const KIND = { II_7: 'revenue', II_8: 'expenditure' };
const KIND_LABEL = { II_7: 'Приходна мярка', II_8: 'Разходна мярка' };
const share = { period: FRAMEWORK.join(' / '), unit: 'млн. €' };

/** the measures of one table: printed row, its companion text, the three effects and the blank cells */
function measuresOf(doc, table) {
  return (doc.forecast?.[table] || [])
    .map((row, i) => ({
      table,
      i,
      row,
      text: measureText(table, i, row.label),
      v: FRAMEWORK.map((_, k) => cellValue(row.cells?.[String(k)])),
      gaps: row.gaps || {},
    }))
    .filter((m) => m.row.label !== TOTAL);
}
const totalOf = (doc, table) => {
  const row = (doc.forecast?.[table] || []).find((r) => r.label === TOTAL);
  return FRAMEWORK.map((_, k) => cellValue(row?.cells?.[String(k)]));
};
const titleOf = (m) => m.text?.name || m.row.label;
const anchor = (m) => (m.text ? `m27-${m.text.id}` : `m27-${m.table}-${m.i}`);

/** what the 2027 sign means for this kind of measure */
function effectWords(table, v) {
  if (!ok(v) || v === 0) return '';
  if (table === 'II_7') return v > 0 ? 'повече приходи' : 'по-малко приходи';
  return v > 0 ? 'повече разходи' : 'по-малко разходи';
}

/* ---------------------------------------------------------------- one measure */
function years(m) {
  return html`<div class="s12-years-box">
    <p class="s12-years-h">Промяна спрямо предходната година, млн. €</p>
    <dl class="s12-years">${YEARS.map((y, k) => {
      const v = m.v[k];
      return html`<div class="m27-year" id="s12-${m.table}-${m.i}-${k}" tabindex="-1"><dt>${yr(y)}</dt><dd>${
        ok(v)
          ? html`<span class="num">${signed(v)}</span>`
          : html`<span class="muted" title="Празна клетка в таблицата">${DASH}</span><span class="sr-only"> ${m.gaps[String(k)] || 'Празна печатна клетка.'}</span>`
      }</dd></div>`;
    })}</dl>
  </div>`;
}
function quote(m) {
  const t = m.text;
  const tableName = `Табл. ${m.table.replace('_', '-')}`;
  const pages = t ? `стр.${NBSP}${t.page}${t.to && t.to !== t.page ? `–${t.to}` : ''}` : '';
  return html`<details class="s12-quote">
    <summary>${t ? html`Откъс от мотивите · ${pages}` : html`Текстът в ${tableName}`}</summary>
    ${t ? html`<blockquote class="s12-quote-text" data-gl-skip>${t.quote}</blockquote>` : ''}
    <p class="m27-row small muted" data-gl-skip>
      Редът в ${tableName}${t ? `, стр.${NBSP}${t.tablePage}` : ''}: „${m.row.label}“
    </p>
  </details>`;
}
function card(m) {
  const t = m.text;
  const words = effectWords(m.table, m.v[0]);
  const lawKey = t?.law;
  const rows = [
    {
      k: `Ефект през ${yr(YEARS[0])}`,
      v: ok(m.v[0])
        ? html`<span class="s12-eff num">${signed(m.v[0])}${NBSP}млн.${NBSP}€</span>${words ? html` <span class="s12-eff-words">· ${words}</span>` : ''}`
        : html`<span class="muted">Без сума за ${yr(YEARS[0])} Ефектът е от ${yr(YEARS[m.v.findIndex(ok)] ?? YEARS[1])}</span>`,
    },
    lawKey
      ? {
          k: 'Закон',
          v: LAWS[lawKey] && LAWS[lawKey] !== lawKey ? `${LAWS[lawKey]} (${lawKey})` : lawKey,
        }
      : null,
  ].filter(Boolean);
  return html`<article class="s12-card m27-card" id="${anchor(m)}" data-kind="${KIND[m.table]}" aria-labelledby="${anchor(m)}-h">
    <p class="s12-kind">${KIND_LABEL[m.table]}${t?.area ? html` · <span class="m27-area">${t.area}</span>` : ''}</p>
    <h3 class="s12-name" id="${anchor(m)}-h">${titleOf(m)}</h3>
    ${t?.text ? html`<p class="s12-text">${t.text}</p>` : ''}
    ${facts(rows, { cls: 's12-facts' })}
    ${years(m)}
    ${quote(m)}
  </article>`;
}
const cards = (list) => html`<div class="s12-cards">${list.map(card)}</div>`;
const byEffect = (list) =>
  [...list].sort(
    (a, b) => Math.abs(b.v.find(ok) ?? 0) - Math.abs(a.v.find(ok) ?? 0) || a.i - b.i, // the first year with an amount decides
  );

/* ---------------------------------------------------------------- the printed table: CSV and expert view */
function printedTable(doc, table) {
  const rows = doc.forecast[table].flatMap((r, rowIndex) =>
    FRAMEWORK.map((key, k) =>
      cellRow(r.label, r.cells[k], {
        ...frameworkRow(key),
        gap: r.gaps[k] || '',
      }),
    ),
  );
  return {
    rows,
    html: disclosure({
      id: `s12-${table}-d`,
      cls: 'm27-table',
      title: 'Покажи като таблица',
      meta: `${plural(rows.length, 'ред', 'реда')}, както в ${table.replace('_', '-')}`,
      open: false,
      body: dataTable({
        id: 's12-' + table + '-table',
        caption: `Таблица ${table.replace('_', '-')}, АСБП 2027–2029`,
        columns: [
          { key: 'period', label: 'Период' },
          ...cellColumns('млн. €'),
          { key: 'gap', label: 'Липсваща стойност' },
        ],
        rows,
        dense: true,
      }),
    }),
  };
}

/* ---------------------------------------------------------------- the lists */
function group(title, sub, list) {
  if (!list.length) return '';
  return html`<section class="m27-group">
    <h3 class="m27-group-h">${title} <span class="s12-count">${plural(list.length, 'мярка', 'мерки')}</span></h3>
    ${sub ? html`<p class="s12-intro small muted">${sub}</p>` : ''}
    ${cards(byEffect(list))}
  </section>`;
}
function revenuePanel(ctx, doc, list) {
  const first = YEARS[0];
  const more = list.filter((m) => ok(m.v[0]) && m.v[0] > 0),
    less = list.filter((m) => ok(m.v[0]) && m.v[0] < 0),
    later = list.filter((m) => !ok(m.v[0]));
  const t = printedTable(doc, 'II_7');
  return base(
    ctx,
    's12-II_7',
    'Приходни мерки 2027–2029',
    html`<div class="stack-lg">
      ${group(`Повече приходи през ${yr(first)}`, 'Нови данъци, по-високи ставки, осигуровки и такси и по-добро събиране.', more)}
      ${group(`По-малко приходи през ${yr(first)}`, 'Облекчения и по-висок праг за регистрация по ЗДДС.', less)}
      ${group(`С ефект от ${yr(YEARS[1])}`, `За ${yr(first)} в таблицата няма сума.`, later)}
      ${t.html}
    </div>`,
    {
      sub: html`Табл. II-7 на АСБП 2027–2029. ${gl('prihodna-myarka', 'Приходните мерки')} променят данъците, осигуровките и таксите. <span class="s12-count">${plural(list.length, 'мярка', 'мерки')}.</span>`,
      ...frameworkStatus,
      share,
    },
  );
}
function expenditurePanel(ctx, doc, list) {
  const first = YEARS[0];
  const more = list.filter((m) => ok(m.v[0]) && m.v[0] > 0),
    less = list.filter((m) => ok(m.v[0]) && m.v[0] <= 0);
  const t = printedTable(doc, 'II_8');
  return base(
    ctx,
    's12-II_8',
    'Разходни мерки 2027–2029',
    html`<div class="stack-lg">
      ${group(`Повече разходи през ${yr(first)}`, 'Заплати и социална подкрепа.', more)}
      ${group(`По-малко разходи през ${yr(first)}`, 'Оптимизиране на персонала, по-строг контрол и по-малки плащания.', less)}
      ${t.html}
    </div>`,
    {
      sub: html`Табл. II-8 на АСБП 2027–2029. ${gl('razhodna-myarka', 'Разходните мерки')} променят заплатите, социалните плащания и другите разходи. За ${yr(YEARS[1])} и ${yr(YEARS[2])} таблицата няма суми. <span class="s12-count">${plural(list.length, 'мярка', 'мерки')}.</span>`,
      ...frameworkStatus,
      share,
    },
  );
}
function lawsPanel(ctx, all) {
  const byLaw = new Map();
  for (const m of all) {
    const law = m.text?.law;
    if (law) byLaw.set(law, [...(byLaw.get(law) || []), m]);
  }
  const laws = [...byLaw].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'bg'),
  );
  const none = all.filter((m) => !m.text?.law).length;
  const link = (m) => ctx.href('S12', {}, { per: ctx.period.key, to: anchor(m) });
  return block({
    id: 's12-27-zakoni',
    title: 'Мерките по закони',
    status: 'text',
    share: false,
    sub: `Законите, които мотивите посочват за мерките. За ${plural(none, 'мярка', 'мерки')} мотивите не посочват закон.`,
    body: html`<div class="m27-laws">${laws.map(
      ([law, list]) => html`<section class="m27-law">
        <h3 class="m27-group-h">${LAWS[law] || law}${LAWS[law] && LAWS[law] !== law ? html` <span class="m27-abbr">${law}</span>` : ''}</h3>
        <ul class="m27-law-list">${list.map(
          (m) =>
            html`<li><a href="${link(m)}">${titleOf(m)}</a> <span class="small muted">· ${KIND_LABEL[m.table].toLowerCase()}</span></li>`,
        )}</ul>
      </section>`,
    )}</div>`,
  });
}

/* ---------------------------------------------------------------- the sums */
function sums(doc, rev, exp, counts) {
  const balance = ok(rev[0]) && ok(exp[0]) ? Math.round((rev[0] - exp[0]) * 10) / 10 : null;
  const later = (v) =>
    YEARS.slice(1)
      .map((y, k) => `${yr(y)}: ${signed(v[k + 1])}`)
      .join(' · ');
  const csv = () =>
    tableData({
      columns: [
        { key: 'name', label: 'Мерки' },
        ...YEARS.map((y, k) => ({
          key: 'y' + k,
          label: String(y),
          unit: 'млн. €',
          num: true,
          d: 1,
        })),
      ],
      rows: [
        {
          name: 'Приходни мерки (Табл. II-7)',
          ...Object.fromEntries(rev.map((v, k) => ['y' + k, v])),
        },
        {
          name: 'Разходни мерки (Табл. II-8)',
          ...Object.fromEntries(exp.map((v, k) => ['y' + k, v])),
        },
      ],
    });
  return block({
    id: 's12-27-sums',
    title: 'Сборове по мерките',
    ...frameworkStatus,
    source: ['budget2027'],
    asOf: doc.publication,
    sub: 'Общите редове на двете таблици. Сумите са промяната спрямо предходната година.',
    share: {
      ...share,
      table: csv,
      text: `Мерките в проекта за бюджет 2027: приходни ${signed(rev[0])} млн. €, разходни ${signed(exp[0])} млн. € през 2027 г.`,
    },
    foot: 'Ефектът върху салдото е наше пресмятане: приходните мерки минус разходните.',
    body: kpiGrid(
      [
        kpi({
          label: `Приходни мерки през ${yr(YEARS[0])}`,
          value: signed(rev[0]),
          unit: 'млн. €',
          sub: `${plural(counts.II_7, 'мярка', 'мерки')}. ${later(rev)} млн. €.`,
        }),
        kpi({
          label: `Разходни мерки през ${yr(YEARS[0])}`,
          value: signed(exp[0]),
          unit: 'млн. €',
          sub: `${plural(counts.II_8, 'мярка', 'мерки')}. ${ok(exp[0]) ? (exp[0] < 0 ? 'Нетно по-малко разходи.' : 'Нетно повече разходи.') : ''}`,
        }),
        kpi({
          label: `Ефект върху салдото през ${yr(YEARS[0])}`,
          value: signed(balance),
          unit: 'млн. €',
          sub: ok(balance) ? (balance > 0 ? 'Подобрява салдото.' : 'Влошава салдото.') : '',
        }),
      ],
      { label: 'Сборове по мерките' },
    ),
  });
}

function howTo(doc) {
  const windfall = (doc.forecast?.II_7 || []).find(
    (r, i) => measureText('II_7', i, r.label)?.id === 'svrahpechalba',
  );
  const w = windfall ? FRAMEWORK.map((_, k) => cellValue(windfall.cells?.[String(k)])) : [];
  const items = [
    html`Сумите са в милиони евро на ${gl('nachislena-osnova', 'начислена основа')}. Всяка показва промяната спрямо предходната година, не цялата сума за годината.`,
    'При приходна мярка плюс значи повече приходи, минус — по-малко. При разходна мярка плюс значи повече разходи, минус — по-малко.',
    ok(w[0]) && ok(w[1])
      ? `Еднократна мярка се връща през следващата година: данъкът върху свръхпечалбата е ${signed(w[0])} млн. € през ${yr(YEARS[0])} и ${signed(w[1])} млн. € през ${yr(YEARS[1])}`
      : '',
    'Тире (—) значи празна клетка в таблицата на МФ. То не е нула.',
    'Заглавията и краткото описание са на редакцията. Откъсите са дословно от мотивите, със страницата им.',
  ].filter(Boolean);
  return disclosure({
    id: 's12-27-howto',
    title: 'Как да четеш числата',
    body: html`<ul class="s12-howto">${items.map((t) => html`<li>${t}</li>`)}</ul>`,
  });
}

/** the page */
export function measuresView(ctx) {
  if (unavailable(ctx)) return unavailable(ctx);
  const doc = ctx.data.budget2027;
  if (ctx.params.id)
    return {
      body: html`${gap('Мярката е от бюджета за 2026 г.', 'Мерките от АСБП 2027–2029 са в общия списък.')}<p><a href="${ctx.href('S12', {}, { per: '2027.draft' })}">Мерки в проекта за 2027</a></p>`,
      next: [
        { href: ctx.href('S12', {}, { per: '2027.draft' }), title: 'Мерки в проекта за 2027' },
      ],
    };
  const rev = measuresOf(doc, 'II_7'),
    exp = measuresOf(doc, 'II_8');
  const counts = { II_7: rev.length, II_8: exp.length };
  const lawCount = new Set([...rev, ...exp].map((m) => m.text?.law).filter(Boolean)).size;
  const active = ['prihodni', 'razhodni', 'zakoni'].includes(ctx.query.spisak)
    ? ctx.query.spisak
    : 'prihodni';
  return {
    title: 'Мерки в проекта за бюджет 2027',
    lede: 'Промените в данъците, осигуровките и разходите, с които МФ разчита бюджета за 2027 г. и прогнозата за 2028–2029 г. За всяка мярка: какво се променя, колко пари носи или струва по години и какво пише в мотивите.',
    body: html`<div class="stack-lg m27">
      ${callout({
        kind: 'info',
        id: 's12-27-stage',
        title: 'Числата са по законопроекта, не по приет закон',
        body: html`<p>Мерките са от таблици II-7 и II-8 на АСБП 2027–2029, публикувани от МФ на 06.11.2026. Народното събрание още не е приело бюджета.</p>`,
      })}
      ${sums(doc, totalOf(doc, 'II_7'), totalOf(doc, 'II_8'), counts)}
      ${howTo(doc)}
      ${tabs({
        id: 's12-27-lists',
        label: 'Списъци с мерки',
        query: 'spisak',
        active,
        tabs: [
          {
            key: 'prihodni',
            label: 'Приходни',
            count: rev.length,
            body: revenuePanel(ctx, doc, rev),
          },
          {
            key: 'razhodni',
            label: 'Разходни',
            count: exp.length,
            body: expenditurePanel(ctx, doc, exp),
          },
          {
            key: 'zakoni',
            label: 'По закони',
            count: lawCount,
            body: lawsPanel(ctx, [...rev, ...exp]),
          },
        ],
      })}
      ${publication(doc)}
      <p><a href="${ctx.href('S12', {}, { per: '2026.law' })}">Мерките в бюджета за 2026 г.</a></p>
    </div>`,
  };
}
