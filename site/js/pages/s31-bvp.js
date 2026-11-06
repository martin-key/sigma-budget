// S31 · БВП: колко расте икономиката? · #/bvp · next S13 · periods none
// Data: outlook.json (D01+D02+D15) and gva-sectors.json (D31, Eurostat copy of the NSI national accounts: gross value added by branch, 2019–2025).
// `gdp.mln` is the LEVEL of БВП in млн. €; `macroRows` gdpGrowth / consumption / gfcf / exports / imports are
// REAL growth rates in % against the previous year (never levels); `macroVintage` says per year whether the number is a report or a forecast;
// `kfp` and core.kpis.debt give the 2026 plan shares of БВП for the „Защо БВП е важен“ block. Every figure on the screen is read or computed
// from those files. The screen has its own year switch (?y=), because the shell shows no period line here (periods: none). The block „От какво е съставена
// икономиката“ has its own year switch (?sy=): shares of gross value added by branch (ten branches; manufacturing is shown inside industry); the
// branches add up to the gross value added, which together with the taxes on products less subsidies gives БВП (checked by tools/gva_sectors_v5.py).
import { html, esc } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { chart } from '../ui/chart.js';
import { seg } from '../ui/seg.js';
import { facts } from '../ui/cards.js';
import { ranklist } from '../ui/ranklist.js';
import { gl } from '../ui/gl.js';
import { scopeChip } from '../ui/scope.js';
import { byId } from '../routes.js';
import { chartUnit } from '../view.js';
import { num, pct, delta, money, date, NBSP } from '../format.js';

export const needs = ['core', 'outlook', 'gva-sectors'];
export const styles = ['s31-bvp'];

/* ---------------------------------------------------------------- words and small helpers */
const ok = v => typeof v === 'number' && Number.isFinite(v);
/** under the year on the axis (a line break keeps five categories readable on a phone) */
const WORD = { actual: 'отчет', forecast: 'прогноза' };
const LONG = { actual: 'Отчет', forecast: 'Прогноза' };
const list = (a, n) => (Array.isArray(a) && a.length === n ? a : Array.from({ length: n }, () => null));
const pick = (a, i) => (Array.isArray(a) && ok(a[i]) ? a[i] : null);
/** „2026 г.“ with a no-break space, so that „г.“ never stands alone on a line */
const yr = y => `${y}${NBSP}г.`;
const yearsText = ys => (ys.length === 1 ? yr(ys[0]) : `${ys.slice(0, -1).join(', ')} и ${yr(ys[ys.length - 1])}`);

/** the five lines of the growth chart: БВП as a whole, then its four parts. `of` is the name in „растежът на …“ */
const ROWS = [
  { id: 'gdpGrowth', name: 'БВП общо', of: 'БВП', color: '--ink' },
  { id: 'consumption', name: 'Потребление', of: 'потреблението', color: 3 },
  { id: 'gfcf', name: 'Инвестиции', of: 'инвестициите', color: 2 },
  { id: 'exports', name: 'Износ', of: 'износа', color: 1 },
  { id: 'imports', name: 'Внос', of: 'вноса', color: 7 }
];

/** everything the screen needs from outlook.json, in one place; arrays are aligned to `years` */
function frame(ctx) {
  const o = ctx.data.outlook;
  const years = Array.isArray(o.years) ? o.years : [];
  const n = years.length;
  const kinds = years.map((_, i) => (o.macroVintage?.[i] === 'actual' ? 'actual' : 'forecast'));
  const rows = Array.isArray(o.macroRows) ? o.macroRows : [];
  const g = Object.fromEntries(ROWS.map(r => [r.id, list(rows.find(x => x.id === r.id)?.values, n)]));
  const plan = Array.isArray(o.vintage) ? o.vintage.indexOf('plan') : -1;     // the year of the budget bill (2026)
  const firstFc = kinds.indexOf('forecast');
  const at = years.indexOf(Number(ctx.query?.y));
  return {
    o, years, n, kinds, g, plan, firstFc, gdp: list(o.gdp?.mln, n), asOf: o.macroAsOf || o.meta?.asOf,
    sel: at >= 0 ? at : plan >= 0 ? plan : Math.max(firstFc, 0),
    span: n ? `${years[0]}–${years[n - 1]}` : ''
  };
}

const cats = f => f.years.map((y, i) => `${y}\n${WORD[f.kinds[i]]}`);

/** tooltip: the year and the kind of numbers in the heading, one row per name (a dashed line is drawn as two halves of one name) */
const tip = (f, text) => ps => {
  const seen = new Set();
  const rows = [].concat(ps).filter(p => ok(p.value)).filter(p => { if (seen.has(p.seriesName)) return false; seen.add(p.seriesName); return true; });
  if (!rows.length) return '';
  const i = rows[0].dataIndex;
  const sw = c => `<span style="display:inline-block;width:10px;height:10px;border-radius:var(--r-1);margin-right:6px;background:${esc(c)}"></span>`;
  return `<div style="font-weight:700;margin-bottom:4px">${esc(`${yr(f.years[i])} · ${LONG[f.kinds[i]]}`)}</div>`
    + rows.map(p => `<div style="display:flex;gap:12px;justify-content:space-between;align-items:center"><span>${sw(p.color)}${esc(p.seriesName)}</span><b style="font-variant-numeric:tabular-nums">${esc(text(p.value))}</b></div>`).join('');
};

/** one plain sentence about a series: the accessible name of the chart and the text of „Сподели“ */
function describe(name, verbs, years, vals, tx) {
  const pts = vals.map((v, i) => ({ v, y: years[i] })).filter(p => ok(p.v));
  if (pts.length < 2) return '';
  const a = pts[0], b = pts[pts.length - 1];
  const rises = pts.every((p, i) => !i || p.v >= pts[i - 1].v), falls = pts.every((p, i) => !i || p.v <= pts[i - 1].v);
  if (rises && falls) return `${name}: ${tx(a.v)} във всички години.`;
  if (rises || falls) return `${name} ${rises ? verbs[0] : verbs[1]} от ${tx(a.v)} през ${yr(a.y)} до ${tx(b.v)} през ${yr(b.y)}.`;
  const hi = Math.max(...pts.map(p => p.v)), lo = Math.min(...pts.map(p => p.v));
  const when = x => yearsText(pts.filter(p => p.v === x).map(p => p.y));
  return `${name}: най-голямата стойност е ${tx(hi)} през ${when(hi)}, най-малката — ${tx(lo)} през ${when(lo)}.`;
}
const forecastNote = f => {
  const ys = f.years.filter((_, i) => f.kinds[i] === 'forecast');
  return ys.length ? ` Числата за ${yearsText(ys)} са прогноза.` : '';
};

/* ---------------------------------------------------------------- the two charts */
function levelSpec(ctx, f) {
  const u = chartUnit(ctx, { pct: false, max: Math.max(0, ...f.gdp.filter(ok)) });
  const vals = f.gdp.map(v => u.conv(v, null));
  const tx = v => `${u.fmt(v)}${NBSP}${u.unit}`;
  const groups = [{ k: 'actual', name: 'Отчет', color: '--data' }, { k: 'forecast', name: 'Прогноза', color: 'other' }].filter(x => f.kinds.includes(x.k));
  return {
    id: 's31-level', type: 'bar', stack: true, title: `БВП по години, ${f.span}`, sub: u.unit,
    categories: cats(f), categoryLabel: 'Година', interval: 0, min: 0, d: u.d, fmt: u.fmt, height: 300,
    option: { ...u.option(), tooltip: { formatter: tip(f, tx) } },
    series: groups.map(x => ({ name: x.name, color: x.color, data: vals.map((v, i) => (f.kinds[i] === x.k ? v : null)) })),
    desc: describe('БВП', ['нараства', 'намалява'], f.years, vals, tx) + forecastNote(f),
    // the twin always gives the exact млн. €, whatever unit the chart shows
    table: {
      columns: [{ key: 'y', label: 'Година' }, { key: 'k', label: 'Вид данни' }, { key: 'v', label: 'БВП', unit: 'млн. €', d: 0, num: true }],
      rows: f.years.map((y, i) => ({ y: String(y), k: LONG[f.kinds[i]], v: f.gdp[i] }))
    }
  };
}

/** the sentence about the growth chart: the largest number on it and the lowest one (a fall is named a fall) */
function extremes(f) {
  const pts = [];
  ROWS.forEach(r => f.g[r.id].forEach((v, i) => { if (ok(v)) pts.push({ v, of: r.of, y: f.years[i] }); }));
  if (pts.length < 2) return '';
  const hi = pts.reduce((a, b) => (b.v > a.v ? b : a)), lo = pts.reduce((a, b) => (b.v < a.v ? b : a));
  if (hi.v === lo.v) return '';
  const falls = pts.filter(p => p.v < 0).length;
  const low = falls === 1 ? `Единственият спад е при ${lo.of} през ${yr(lo.y)} (${pct(lo.v, 1)}).`
    : falls > 1 ? `Най-голям е спадът при ${lo.of} през ${yr(lo.y)} (${pct(lo.v, 1)}).`
      : `Най-малък е растежът на ${lo.of} през ${yr(lo.y)} (${pct(lo.v, 1)}).`;
  return ` Най-голям е растежът на ${hi.of} през ${yr(hi.y)} (${pct(hi.v, 1)}). ${low}`;
}

function growthSpec(f) {
  const total = f.g.gdpGrowth;
  return {
    id: 's31-growth', type: 'line', title: `Реален растеж по години, ${f.span}`, sub: '% спрямо предходната година',
    categories: cats(f), categoryLabel: 'Година', interval: 0, d: 1, fmt: v => pct(v, 1), unit: '%', height: 340,
    option: { yAxis: { axisLabel: { formatter: v => (ok(v) ? `${num(v, Number.isInteger(v) ? 0 : 1)}%` : '') } }, tooltip: { formatter: tip(f, v => delta(v, 1)) } },
    series: ROWS.map(r => ({ name: r.name, color: r.color, data: f.g[r.id], dashFrom: f.firstFc >= 0 ? f.firstFc : undefined })),
    desc: describe('Реалният растеж на БВП', ['се ускорява', 'се забавя'], f.years, total, v => pct(v, 1)) + extremes(f) + forecastNote(f),
    table: {
      columns: [{ key: 'y', label: 'Година' }, { key: 'k', label: 'Вид данни' }, ...ROWS.map(r => ({ key: r.id, label: r.name, unit: '%', d: 1, num: true }))],
      rows: f.years.map((y, i) => ({ y: String(y), k: LONG[f.kinds[i]], ...Object.fromEntries(ROWS.map(r => [r.id, f.g[r.id][i]])) }))
    }
  };
}

/* ---------------------------------------------------------------- controls and blocks */
function controls(f) {
  return html`<div class="s31-controls">
    <span class="s31-controls-label">Покажи числата за:</span>
    ${seg({ name: 's31-y', label: 'Година', value: String(f.years[f.sel]), query: 'y', options: f.years.map(y => ({ value: String(y), label: String(y) })) })}
    <p class="s31-howto small muted">Под всяка година в графиките пише дали числата са отчет или прогноза. Пунктирът в линиите и сивите колони показват прогноза.</p>
  </div>`;
}

function tilesBlock(f) {
  const i = f.sel, y = f.years[i], kind = f.kinds[i];
  const grow = (id, label, sub, slug) => { const v = pick(f.g[id], i); return kpi({ label, gl: slug, value: ok(v) ? delta(v, 1) : null, sub }); };
  const gdp = pick(f.gdp, i);
  return block({
    id: 's31-kpis', title: `Числата за ${yr(y)}`, status: kind === 'forecast' ? 'forecast' : 'real', statusLabel: LONG[kind],
    sub: 'Растежът е реален: спрямо предходната година и без поскъпването.',
    source: ['asbp'], asOf: f.asOf,
    share: { text: `${yr(y)} (${LONG[kind].toLowerCase()}): БВП ${money(gdp)}, реален растеж ${pct(pick(f.g.gdpGrowth, i), 1)}.` },
    body: kpiGrid([
      kpi({ label: 'БВП', gl: 'bvp', mln: gdp, sub: 'Размерът на икономиката за годината.' }),
      grow('gdpGrowth', 'Реален растеж на БВП', 'Промяната в стоките и услугите, които страната създава.', 'realen-rast'),
      grow('consumption', 'Потребление', 'Стоки и услуги за текущи нужди.'),
      grow('gfcf', 'Инвестиции', 'Вложения в машини, сгради, пътища.'),
      grow('exports', 'Износ', 'Стоки и услуги, продадени в чужбина.'),
      grow('imports', 'Внос', 'Стоки и услуги, купени от чужбина.')
    ], { label: `Основни числа за ${yr(y)}` })
  });
}

/** why the euro sum and the real growth differ: the plain words, and the numbers of the selected year when the year before it exists and the sum really grew faster */
function nominalNote(f) {
  const i = f.sel, a = pick(f.gdp, i), b = pick(f.gdp, i - 1), g = pick(f.g.gdpGrowth, i);
  const first = html`<p class="s31-note">Реалният растеж не включва поскъпването. В сумата в евро то е включено (${gl('nominalen-rast', 'номинален ръст')}).</p>`;
  if (a == null || b == null || b === 0 || g == null) return first;
  const nom = ((a - b) / b) * 100;
  if (!(nom > g)) return first;          // "the difference is the rise in prices" is only true when the sum in euro grew faster than the volume
  return html`${first}<p class="s31-note">Пример: през ${yr(f.years[i])} БВП е с ${pct(nom, 1)} повече в евро спрямо ${yr(f.years[i - 1])}, а реалният растеж е ${pct(g, 1)}. Разликата е поскъпването.</p>`;
}

function levelBlock(ctx, f) {
  const spec = levelSpec(ctx, f);
  return block({
    id: 's31-b-level', title: 'Колко е голям БВП', sub: 'Стойността на всичко, което страната създава за година, в евро.',
    status: 'forecast', statusLabel: 'Отчет и прогноза', source: ['asbp'], asOf: f.asOf, share: { text: spec.desc },
    body: html`<div class="stack">${chart(spec)}${nominalNote(f)}</div>`
  });
}

function growthBlock(f) {
  const spec = growthSpec(f);
  return block({
    id: 's31-b-growth', title: 'Как расте икономиката и нейните части', sub: 'Реален растеж по години: БВП общо, потребление, инвестиции, износ и внос.',
    status: 'forecast', statusLabel: 'Отчет и прогноза', source: ['asbp'], asOf: f.asOf, share: { text: spec.desc },
    body: html`<div class="stack">${chart(spec)}<p class="s31-note small muted">Процентите не се събират: растежът на БВП не е сборът от растежа на частите.</p></div>`
  });
}

/* ---------------------------------------------------------------- the branches of the economy */
/** B-E minus C: mining, power, water and waste (the part of industry that is not manufacturing) */
const REST_OF_INDUSTRY = { name: 'Добив, ток, вода и отпадъци', desc: 'Мини и кариери, електро- и топлоенергия, водоснабдяване, събиране на отпадъци.' };

function sectorsFrame(ctx) {
  const g = ctx.data['gva-sectors'];
  const ys = g.years, last = ys.length - 1;
  const at = ys.indexOf(Number(ctx.query?.sy));
  const i = at >= 0 ? at : last;
  return { g, ys, i, y: ys[i], prov: (g.meta.provisionalYears || []).includes(ys[i]) };
}

/** the sentences under the list: who is the largest, and what changed since the first year (computed, never typed) */
function sectorsReading(S) {
  const { g, ys, i, y } = S;
  const sh = (b, k) => (b.mln[k] / g.gva[k]) * 100;
  const top = [...g.branches].sort((a, b) => b.mln[i] - a.mln[i]).slice(0, 3);
  const first = `През ${yr(y)} най-голям дял има „${top[0].name}“ (${pct(sh(top[0], i), 1)}), следват „${top[1].name}“ (${pct(sh(top[1], i), 1)}) и „${top[2].name}“ (${pct(sh(top[2], i), 1)}).`;
  if (i === 0) return first;
  const ch = g.branches.map(b => ({ b, d: sh(b, i) - sh(b, 0) })).sort((a, b) => b.d - a.d);
  const up = ch[0], down = ch[ch.length - 1];
  const part = (x, word) => `${word} делът на „${x.b.name}“ (от ${pct(sh(x.b, 0), 1)} на ${pct(sh(x.b, i), 1)})`;
  const move = [up.d >= 0.5 ? part(up, 'най-много нараства') : '', down.d <= -0.5 ? part(down, 'най-много намалява') : ''].filter(Boolean);
  return move.length ? `${first} Спрямо ${yr(ys[0])} ${move.join(', а ')}.` : first;
}

function sectorsBlock(ctx) {
  const S = sectorsFrame(ctx);
  const { g, ys, i, y, prov } = S;
  const gdp = g.gdp[i], gva = g.gva[i], tax = g.taxesNet[i];
  const sh = mln => (mln / gva) * 100;
  const row = (name, desc, mln, children) => ({ label: name, sub: desc, value: mln, share: sh(mln), pctGdp: (mln / gdp) * 100, ...(children ? { children } : {}) });
  const items = g.branches.map(b => {
    const part = g.parts.find(p => p.of === b.id);
    if (!part) return row(b.name, b.desc, b.mln[i]);
    return row(b.name, b.desc, b.mln[i], [
      row(part.name, part.desc, part.mln[i]),
      row(REST_OF_INDUSTRY.name, REST_OF_INDUSTRY.desc, Math.round((b.mln[i] - part.mln[i]) * 10) / 10)
    ]);
  });
  const reading = sectorsReading(S);
  const word = prov ? 'предварителни данни' : 'отчет';
  const withPg = (mln, d = 1) => html`${money(mln, { d })} · ${pct((mln / gdp) * 100, 1)} от БВП`;
  const asOf = g.meta.asOf;
  return block({
    id: 's31-b-sectors', title: 'От какво е съставена икономиката', status: 'real', statusLabel: prov ? 'Предварителни данни' : 'Отчет',
    sub: `Какъв дял от създаденото в страната идва от всеки отрасъл, ${yr(y)} (${word}). Дяловете са от добавената стойност в текущи цени.`,
    source: ['eurostat'], asOf, share: { text: reading },
    body: html`<div class="stack">
      <div class="s31-controls s31-controls-in" data-png-skip>
        <span class="s31-controls-label">Покажи данните за:</span>
        ${seg({ name: 's31-sy', cls: 's31-sy', label: 'Година на отраслите', value: String(y), query: 'sy', options: ys.map(v => ({ value: String(v), label: String(v) })) })}
      </div>
      <p class="s31-note">${reading}</p>
      ${ranklist({ id: 's31-rl-sectors', caption: `Отрасли по дял в добавената стойност, ${yr(y)}`, label: `Отрасли на икономиката, ${yr(y)}`, unit: 'mln', d: 1, sort: 'desc', categoryLabel: 'Отрасъл', items })}
      <p class="small muted" data-png-skip>Натисни „Промишленост“, за да видиш колко от нея е преработваща промишленост.</p>
      ${facts([
        { k: 'Добавена стойност на отраслите', v: withPg(gva) },
        { k: 'Данъци върху продуктите минус субсидиите за продукти', v: withPg(tax) },
        { k: 'БВП', v: money(gdp, { d: 1 }) }
      ])}
      <p class="s31-note">БВП е сборът от добавената стойност на всички отрасли и данъците върху продуктите (като ДДС и акцизите), намален със субсидиите за продукти. Затова процентите по-горе са дял от добавената стойност, а не от БВП.</p>
      <p class="small muted">Данни на НСИ, публикувани от Евростат (национални сметки, набори nama_10_a10 и nama_10_gdp), обновени на ${date(asOf)}${NBSP}г.${prov ? ` Данните за ${yr(y)} са предварителни и могат да се променят.` : ''}</p>
    </div>`
  });
}

function meansBlock() {
  return block({
    id: 's31-means', title: 'Какво означава всяко', status: 'text', share: false,
    body: facts([
      { k: 'БВП', v: 'Стойността на стоките и услугите, които страната създава за година. Тук е в евро. Не е сумата в държавната каса.' },
      { k: 'Реален растеж', v: 'Колко повече (или по-малко) е създадено, след като се махне поскъпването. Показва дали се създава реално повече, а не само по-скъпо.' },
      { k: 'Потребление', v: 'Стоките и услугите, които домакинствата и държавата използват за текущите си нужди.' },
      { k: 'Инвестиции', v: 'Пари, вложени в неща, които служат дълго: машини, сгради, пътища. Официалното име е „брутообразуване на основен капитал“.' },
      { k: 'Износ', v: 'Стоките и услугите, които страната продава в чужбина.' },
      { k: 'Внос', v: 'Стоките и услугите, които страната купува от чужбина.' }
    ])
  });
}

/** the 2026 plan against the size of the economy: the shares are the ones of outlook.json (kfp.*.pctGdp), the debt is core.kpis.debt */
function whyBlock(ctx, f) {
  const p = f.plan;
  if (p < 0) return '';
  const s = key => ({ mln: pick(f.o.kfp?.[key]?.mln, p), pg: pick(f.o.kfp?.[key]?.pctGdp, p) });
  const rev = s('revenue'), exp = s('expenditure'), bal = s('balance'), y = f.years[p];
  const withPg = x => (x.mln == null ? null : `${money(x.mln, { d: 1 })}${x.pg == null ? '' : ` · ${pct(Math.abs(x.pg), 1)} от БВП`}`);
  const dk = ctx.core?.kpis?.debt;
  const debt = dk && dk.year === y && ok(dk.zddMln) ? html`${withPg({ mln: dk.zddMln, pg: ok(dk.pctGdp) ? dk.pctGdp : null })} ${scopeChip('zdd')}` : null;
  const gdp = pick(f.gdp, p);
  const deficit = bal.mln != null && bal.mln < 0 && bal.pg != null && gdp != null
    ? html`<p class="s31-note">Пример: дефицитът от ${money(-bal.mln, { d: 1 })} е ${pct(Math.abs(bal.pg), 1)} от БВП за ${yr(y)} (БВП е ${money(gdp, { d: 1 })}).</p>` : '';
  return block({
    id: 's31-why', title: 'Защо БВП е важен за бюджета', scope: 'kfp', status: 'forecast', statusLabel: 'План и прогноза', source: ['asbp'], asOf: f.asOf,
    share: { text: `Бюджетните суми често се дават като дял от БВП (${yr(y)}): приходи ${pct(rev.pg, 1)}, разходи ${pct(exp.pg, 1)} от БВП.` },
    body: html`<div class="stack">
      <p class="s31-note">БВП е мярка за размера на икономиката. Затова бюджетните суми често се дават като дял от него: ${gl('dyal-ot-bvp', '% от БВП')}. Така можем да сравняваме държави с различна големина.</p>
      ${facts([
        { k: 'Приходи по плана', v: withPg(rev) },
        { k: 'Разходи по плана', v: withPg(exp) },
        { k: 'Дефицит по плана', v: bal.mln == null ? null : withPg({ mln: Math.abs(bal.mln), pg: bal.pg }) },
        { k: `Държавен дълг в края на ${yr(y)} (прогноза)`, v: debt }
      ])}
      ${deficit}
      <p class="s31-links">Още по темата: <a href="${ctx.href('S06')}">${byId.S06.title}</a> · <a href="${ctx.href('S07')}">${byId.S07.title}</a> · <a href="${ctx.href('S13')}">${byId.S13.title}</a></p>
    </div>`
  });
}

/* ---------------------------------------------------------------- the screen */
export function render(ctx) {
  const f = frame(ctx);
  return {
    lede: 'БВП е стойността на стоките и услугите, които страната създава за година. Не е сумата в държавната каса. Тук виждаш колко расте, как растат потреблението, инвестициите, износът и вносът и от кои отрасли е съставена икономиката.',
    context: `Числата са по проекта на бюджета, към ${date(f.asOf)}${NBSP}г.`,
    body: html`
      ${controls(f)}
      ${tilesBlock(f)}
      ${levelBlock(ctx, f)}
      ${growthBlock(f)}
      ${sectorsBlock(ctx)}
      ${meansBlock()}
      ${whyBlock(ctx, f)}`
  };
}
