// S20 · Моята община · #/obshtini · next S24 · period 2026.law only (D19 is the law; there is no table for the bill)
// Data, only through `needs`:
//   municipalities          D19, REAL   the main transfers of the 2026 state budget law to each municipality (хил. €), inhabitants, € per person
//   geo/obshtini            D20, REAL   the outlines for the map (optional: without it the screen is the list and says so)
// The map, the list and the two rankings show the same numbers; € per person is the figure of the data (muni.pcOf), never typed.
// The search box filters in place (a re-render would drop the caret and rebuild the map); its text is kept in ?q= with history.replaceState.
// Oblast, view and sort are ordinary re-renders (?oblast= ?view= ?sort= ?dir=). Everything that depends on the visitor's input is a pure function of ctx.
import { html, raw } from '../html.js';
import { block } from '../ui/block.js';
import { kpi, kpiGrid } from '../ui/kpi.js';
import { mapFigure, filterMap } from '../ui/map.js';
import { dataTable } from '../ui/table.js';
import { ranklist } from '../ui/ranklist.js';
import { chart } from '../ui/chart.js';
import { seg } from '../ui/seg.js';
import { field, textInput, selectInput } from '../ui/forms.js';
import { emptyState, pendingState } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import { num, plural, eur, leva, money, moneyParts, NBSP, EUR_RATE } from '../format.js';
import * as M from '../muni.js';

export const needs = ['core', 'municipalities', 'geo/obshtini?'];
export const styles = ['s20-obshtini'];
export const periods = ['2026.law'];
export const lede = () => 'Виж колко пари държавата дава на твоята община през 2026 г. — общо и на жител. Намери общината по име, на картата или в списъка.';

const ok = v => typeof v === 'number' && Number.isFinite(v);
const bg = (a, b) => String(a).localeCompare(String(b), 'bg');
const clean = q => String(q ?? '').slice(0, 80).trim();
const MAX_HITS = 8;

/* ---------------------------------------------------------------- the model: everything the screen shows, from ctx alone */
function model(ctx) {
  const doc = ctx.data.municipalities;
  const all = (Array.isArray(doc?.items) ? doc.items : []).filter(m => m && m.id && m.name);
  if (!all.length) return { ok: false };
  const by = new Map();
  for (const m of all) {
    const id = String(m.regionId ?? m.region ?? '');
    if (id && !by.has(id)) by.set(id, { id, name: String(m.region ?? id) });
  }
  const regions = [...by.values()].sort((a, b) => bg(a.name, b.name));
  const oblast = by.has(ctx.query.oblast) ? ctx.query.oblast : '';
  const oblastName = oblast ? by.get(oblast).name : '';
  const pool = oblast ? all.filter(m => String(m.regionId ?? m.region) === oblast) : all;
  const geo = ctx.data['geo/obshtini'];
  const hasGeo = Array.isArray(geo?.features) && geo.features.length > 0;
  const view = ctx.query.view === 'list' || !hasGeo ? 'list' : 'map';
  const names = new Map();
  for (const m of all) { const k = String(m.name).trim().toLowerCase(); names.set(k, (names.get(k) ?? 0) + 1); }
  const year = [doc?.populationYear, doc?.meta?.populationYear, all.find(m => ok(m.populationYear))?.populationYear].find(ok) ?? null;
  // the data's own footnote about the two municipalities whose population it corrects: shown whenever either of them is among the rows
  const fixIds = new Set(Array.isArray(doc?.popFix?.ids) ? doc.popFix.ids.map(String) : []);
  const fixNote = typeof doc?.popFix?.note === 'string' && pool.some(m => fixIds.has(String(m.id))) ? doc.popFix.note.trim() : '';
  return {
    ok: true, doc, all, regions, oblast, oblastName, pool, geo, hasGeo, view, year, fixNote,
    viewParam: ctx.query.view === 'list' || ctx.query.view === 'map' ? ctx.query.view : null,
    asOf: doc?.meta?.asOf,
    dupe: m => names.get(String(m.name).trim().toLowerCase()) > 1,
    aggPool: M.aggregate(pool), aggAll: M.aggregate(all),
    noPop: all.filter(m => M.popOf(m) === null),
    lv: !!ctx.store.get('leva')
  };
}

/* ---------------------------------------------------------------- the live part: count, shortcuts, empty state (same markup on render and while typing) */
function countLine(n, q, via, md) {
  const where = md.oblast ? ` в област ${md.oblastName}` : '';
  if (!q) return n === 1 ? `Показана е 1 община${where}.` : `Показани са ${num(n, 0)} общини${where}.`;
  if (!n) return `Няма намерени общини${where}.`;
  if (via === 'region') return `Няма община с такова име, но има област с него. Показани са общините от нея: ${num(n, 0)}.`;
  return n === 1 ? `Намерена е 1 община${where}.` : `Намерени са ${num(n, 0)} общини${where}.`;
}

function liveParts(md, ctx, q) {
  const found = M.search(md.pool, q);
  const list = found ? found.hits : md.pool;
  const n = list.length;
  let hits = '';
  if (found && n && md.view === 'map') {
    const shown = list.slice(0, MAX_HITS);
    hits = html`<p class="s20-hits-h" id="s20-hits-h">Отвори общината</p>
      <ul class="s20-hits" aria-labelledby="s20-hits-h">${shown.map(m => {
        const pc = M.pcOf(m);
        return html`<li><a class="s20-hit" href="${ctx.href('obshtina', { code: m.id })}"><span class="s20-hit-name">${m.name}</span><span class="s20-hit-sub">област ${m.region}${pc !== null ? html` · ${M.eurText(pc, 0, md.lv)} на жител` : ''}</span></a></li>`;
      })}${n > shown.length ? html`<li class="s20-more">И още ${num(n - shown.length, 0)}. Допиши името, за да ги стесниш.</li>` : ''}</ul>`;
  }
  let none = '';
  if (found && !n) {
    const elsewhere = md.oblast ? M.search(md.all, q).hits.length : 0;
    none = emptyState({
      title: 'Не намерихме такава община',
      text: elsewhere ? `В област ${md.oblastName} няма община с това име, но има в други области.` : 'Провери правописа или напиши само началото на името, например „Бла“.',
      actions: [
        elsewhere ? { label: 'Търси във всички области', href: ctx.href('obshtini', {}, { q, view: md.viewParam }) } : null,
        { label: 'Изчисти търсенето', href: ctx.href('obshtini', {}, { oblast: md.oblast || null, view: md.viewParam }), primary: !elsewhere }
      ].filter(Boolean)
    });
  }
  return { q, found, list, n, hits, none, count: countLine(n, q, found?.via, md), ids: found ? new Set(list.map(m => String(m.id))) : null };
}

/* ---------------------------------------------------------------- pieces of the page */
function findCard(md, ctx, q, live) {
  const regions = [{ value: '', label: 'Всички области' }, ...md.regions.map(r => ({ value: r.id, label: r.name }))];
  return html`<div class="s20-find" role="search" aria-label="Търсене на община">
    <div class="s20-controls">
      ${field({ id: 's20-q', label: 'Намери общината си', hint: 'Пиши името ѝ, например „Варна“ или „Бла“.', control: textInput({ id: 's20-q', name: 'q', value: q, type: 'search', autocomplete: 'off', inputmode: 'search', hint: true }) })}
      ${field({ id: 's20-oblast', label: 'Област', control: selectInput({ id: 's20-oblast', name: 'oblast', value: md.oblast, options: regions, query: 'oblast' }) })}
      ${md.hasGeo ? html`<div class="field s20-view"><span class="field-label" aria-hidden="true">Покажи като</span>${seg({ name: 'view', label: 'Покажи като', value: md.view, query: 'view', options: [{ value: 'map', label: 'Карта', icon: 'map' }, { value: 'list', label: 'Списък', icon: 'list' }] })}</div>` : ''}
    </div>
    <p class="s20-count" id="s20-count">${live.count}</p>
    <div id="s20-hits"${live.hits ? '' : raw(' hidden')}>${live.hits}</div>
    <div id="s20-none"${live.none ? '' : raw(' hidden')}>${live.none}</div>
  </div>`;
}

const fixFoot = md => (md.fixNote ? html`<p class="small muted s20-fixnote"><strong>Бележка за броя на жителите.</strong> ${md.fixNote}</p>` : '');

/** the money the visitor sees: million euro (auto scale) and, with „и в лева“, the same in leva */
const levaOf = mln => { const s = money(mln, { leva: true }); const i = s.indexOf('(≈'); return i < 0 ? '' : s.slice(i + 1, -1); };
/** a sentence ends with one full stop (the unit „лв.“ already carries one) */
const dot = s => (String(s).endsWith('.') ? String(s) : `${s}.`);

function moneyBlock(md, ctx) {
  const a = md.aggPool, nat = md.aggAll;
  const mln = a.sum.total === null ? null : a.sum.total / 1000;
  const natMln = nat.sum.total === null ? null : nat.sum.total / 1000;
  const parts = mln === null ? null : moneyParts(mln);
  const sub = [
    md.oblast ? (natMln === null ? '' : `В цялата страна: ${money(natMln)}.`) : `Сумата за всички ${plural(a.count, 'община', 'общини')} заедно.`,
    md.lv && mln !== null ? `В лева: ${dot(levaOf(mln))}` : ''
  ].filter(Boolean).join(' ');
  const avg = a.perCapita.total, natAvg = nat.perCapita.total;
  const subAvg = [
    md.oblast ? (natAvg === null ? '' : `В цялата страна: ${eur(natAvg)}.`) : 'Сумата на общините, разделена на жителите им.',
    md.lv && avg !== null ? `В лева: ≈${NBSP}${dot(leva(avg * EUR_RATE))}` : '',
    a.popCount < a.count ? 'Без общините, за които няма данни за жителите.' : ''
  ].filter(Boolean).join(' ');
  const regionsN = md.regions.length;
  return block({
    id: 's20-pari', title: 'Парите от държавата за общините', scope: 'nat', status: 'real', source: ['zdb', 'gisco'], asOf: md.asOf,
    sub: `Основните трансфери от държавния бюджет за 2026 г.${md.oblast ? ` Показана е област ${md.oblastName}.` : ''}`,
    body: kpiGrid([
      kpi({ label: 'Основни трансфери общо', value: parts ? parts.v : null, unit: parts ? parts.u : '', sub }),
      kpi({ label: 'Средно на жител', value: avg === null ? null : num(avg, 0), unit: avg === null ? '' : '€', sub: subAvg }),
      kpi({ label: md.oblast ? 'Общини в областта' : 'Общини', value: a.count, sub: md.oblast ? `От ${num(nat.count, 0)} в страната.` : `В ${plural(regionsN, 'област', 'области')}.` })
    ], { label: 'Основни числа за общините' })
  });
}

/** the four kinds of main transfer add up to „Основни трансфери общо“ above: as a pie, as bars or as a table */
function kindsBlock(md, ctx) {
  const a = md.aggPool;
  const kinds = M.TYPES.filter(t => t.inTotal).map(t => ({ ...t, khil: a.sum[t.key] }));
  if (kinds.some(x => !ok(x.khil) || x.khil < 0) || !(a.sum.total > 0)) return '';
  const k = md.lv ? EUR_RATE : 1, unit = md.lv ? 'млн. лв.' : 'млн. €';
  const mln = v => Math.round(((v * k) / 1000) * 1000) / 1000;
  const spec = {
    id: 's20-ch-vidove', type: 'donut', title: 'Основни трансфери по видове', sub: `В ${unit}${md.oblast ? `, област ${md.oblastName}` : ', цялата страна'}.`,
    unit, d: 1, fmt: v => num(v, 1), categoryLabel: 'Вид трансфер', legendValues: true, height: 300,
    data: kinds.map(x => ({ name: x.label, value: mln(x.khil) })),
    views: ['pie', 'bars', 'table'], valueName: 'Основни трансфери', axis: v => num(v, 0),
    desc: `Кръгова графика: ${kinds.map(x => `${x.label} ${num(mln(x.khil), 1)} ${unit}`).join('; ')}.`
  };
  return block({
    id: 's20-vidove', title: 'За какво са основните трансфери', scope: 'nat', status: 'real', source: ['zdb'], asOf: md.asOf,
    sub: `Четирите вида основни трансфери по закона за 2026 г. Заедно са сумата по-горе.${md.oblast ? ` Показана е област ${md.oblastName}.` : ''} Другите целеви трансфери са отделно и не са в нея.`,
    body: chart(spec)
  });
}

function mapBlock(md, ctx, q) {
  const items = md.all.map(m => ({ id: m.id, label: m.name, sub: `област ${m.region}`, value: M.pcOf(m), group: String(m.regionId ?? m.region), href: ctx.href('obshtina', { code: m.id }) }));
  return block({
    id: 's20-karta', title: 'Общините на картата', scope: 'nat', status: 'real', source: ['zdb', 'gisco'], asOf: md.asOf,
    sub: `Евро на жител през 2026 г. Цветът показва колко пари получава общината. Легендата е под картата.`,
    body: html`${mapFigure({
      id: 's20-map', title: 'Основни трансфери на жител, по общини', sub: '€ на жител, 2026 г.', geo: md.geo, items,
      unitLabel: 'Трансфер на жител, €', valueLabel: 'трансфер на жител', fmt: v => eur(v), focusGroup: md.oblast || null,
      categoryLabel: 'Община', groupLabel: 'Област', openLabel: 'Виж общината',
      desc: 'Цветът на всяка община показва колко евро на жител получава. Групите са в легендата под картата.',
      hint: 'Посочи община на картата или я избери с Tab и стрелките.',
      help: 'Картата е един елемент за Tab. Със стрелките се местиш между общините, с Enter отваряш избраната. Същите данни има и в списъка.',
      twin: true
    })}${fixFoot(md)}`
  });
}

function listBlock(md, ctx, q) {
  const k = md.lv ? EUR_RATE : 1;
  const mu = md.lv ? 'хил. лв.' : 'хил. €';
  const rows = md.pool.map(m => {
    const tot = M.totalOf(m), pc = M.pcOf(m);
    return {
      id: m.id, name: m.name, region: m.region, dupe: md.dupe(m), population: M.popOf(m),
      total: tot === null ? null : tot * k, perCapita: pc === null ? null : pc * k,
      _href: ctx.href('obshtina', { code: m.id })
    };
  }).sort((a, b) => bg(a.name, b.name) || bg(a.region, b.region));
  const columns = [
    { key: 'name', label: 'Община', fmt: (v, r) => (r.dupe ? html`${v}<span class="sr-only">, област ${r.region}</span>` : v) },
    { key: 'region', label: 'Област' },
    { key: 'population', label: 'Жители', num: true, d: 0 },
    { key: 'total', label: 'Трансфер общо', unit: mu, num: true, d: 1 },
    { key: 'perCapita', label: 'Трансфер на жител', unit: md.lv ? 'лв.' : '€', num: true, d: 0 }
  ];
  const sortBy = columns.some(c => c.key === ctx.query.sort) ? ctx.query.sort : 'name';
  const table = dataTable({
    id: 's20-spisak', caption: `Основни трансфери към общините за 2026 г.${md.oblast ? `, област ${md.oblastName}` : ''}`,
    columns, rows, sortable: true, sortBy, dir: ctx.query.dir === 'desc' ? 'desc' : 'asc', query: true, dense: true,
    note: md.year ? `Жителите са по данни към ${md.year} г.` : undefined
  });
  return block({
    id: 's20-karta', title: 'Общините в списък', scope: 'nat', source: ['zdb', 'gisco'], asOf: md.asOf,
    status: 'real',
    sub: 'Основни трансфери за 2026 г. Натисни заглавие на колона, за да подредиш списъка.',
    body: html`${md.hasGeo ? '' : html`<p class="fig-fail" role="note">Картата не се зареди. Същите данни има в списъка.</p>`}${table}${fixFoot(md)}`
  });
}

function rankBlocks(md, ctx) {
  const per = md.pool.filter(m => M.pcOf(m) !== null).sort((a, b) => M.pcOf(b) - M.pcOf(a) || bg(a.name, b.name));
  if (per.length < 2) {
    return html`<p class="muted s20-solo">${md.oblast ? 'В тази област има само една община, затова няма класация.' : 'Няма достатъчно общини за класация.'}</p>`;
  }
  const nTop = Math.min(10, Math.ceil(per.length / 2)), nBot = Math.min(10, per.length - nTop);
  const max = M.pcOf(per[0]);
  const item = m => ({ label: m.name, sub: `област ${m.region}`, value: M.pcOf(m), href: ctx.href('obshtina', { code: m.id }) });
  const mk = (id, title, sub, list) => block({
    id, title, sub, scope: 'nat', status: 'real', source: ['zdb', 'gisco'], asOf: md.asOf,
    body: ranklist({ id: id + '-l', label: `${title}, евро на жител`, ordered: true, unit: 'num', fmt: v => M.eurText(v, 0, md.lv), unitLabel: '€ на жител', categoryLabel: 'Община', max, items: list.map(item) })
  });
  const where = md.oblast ? ` в област ${md.oblastName}` : '';
  return html`<div class="s20-pair">${mk('s20-nay-mnogo', 'Най-много на жител', `Общините${where}, които получават най-много евро на жител.`, per.slice(0, nTop))}${mk('s20-nay-malko', 'Най-малко на жител', `Общините${where}, които получават най-малко евро на жител.`, [...per].reverse().slice(0, nBot))}</div>`;
}

function readBlock(md) {
  const n = md.noPop.length;
  const names = n && n <= 4 ? `: ${md.noPop.map(m => m.name).join(', ')}` : '';
  return block({
    id: 's20-chetene', title: 'Как да четем числата', status: 'real', pill: false, report: false, source: ['zdb', 'gisco'], asOf: md.asOf, share: false,
    body: html`<div class="prose s20-read">
      <p>Показваме основните ${gl('byudzheten-transfer', 'трансфери')} от държавния бюджет по закона за 2026 г. Те са четири вида: за делегирани дейности, изравнителна субсидия, зимно поддържане и капиталови разходи. Парите отиват в ${gl('obshtinski-byudzhet', 'бюджета на общината')}.</p>
      <p>Не са включени собствените приходи на общината и целевите суми за конкретни местни дейности („други целеви“).</p>
      <p>„На жител“ е сумата на общината, разделена на жителите ѝ. Така големи и малки общини се сравняват по равно. Това е ${gl('razhod-na-chovek', 'средна стойност')}: никой не получава тези евро в ръка.</p>
      <p>По-голяма сума на жител не значи, че общината е по-добре или по-зле управлявана. Тя зависи от много неща, например колко училища, детски градини и пътища има общината.</p>
      ${md.year ? html`<p class="small muted">Жителите са по данни към ${md.year} г.${n ? ` За ${n === 1 ? 'една община' : `${num(n, 0)} общини`} няма данни за жителите${names}. На картата са с точки, а сума на жител за тях не показваме.` : ''}</p>` : ''}
    </div>`
  });
}

/* ---------------------------------------------------------------- render */
export function render(ctx) {
  const md = model(ctx);
  if (!md.ok) return pendingState({ title: 'Списъкът на общините предстои', text: 'Данните за общините още не са заредени.' });
  const q = clean(ctx.query.q);
  const live = liveParts(md, ctx, q);
  return html`${findCard(md, ctx, q, live)}${moneyBlock(md, ctx)}${kindsBlock(md, ctx)}${md.view === 'map' ? mapBlock(md, ctx, q) : listBlock(md, ctx, q)}${rankBlocks(md, ctx)}${readBlock(md)}`;
}

/* ---------------------------------------------------------------- behaviour: the search filters the map and the list in place */
export function mount(root, ctx) {
  const md = model(ctx);
  const input = root.querySelector('#s20-q');
  if (!md.ok || !input) return undefined;
  const countEl = root.querySelector('#s20-count'), hitsEl = root.querySelector('#s20-hits'), noneEl = root.querySelector('#s20-none');
  const stage = root.querySelector('#s20-karta');
  let timer = 0;
  let applied = clean(ctx.query.q);                  // what the markup of render() already shows

  const idOf = a => { try { return decodeURIComponent(String(a.getAttribute('href')).split('?')[0].split('/').pop()); } catch { return ''; } };
  const paintDom = ids => {
    const fig = root.querySelector('figure.map');
    if (fig) filterMap(fig, ids);
    for (const tr of root.querySelectorAll('#s20-spisak tbody tr')) {
      const a = tr.querySelector('th a');
      tr.hidden = !!ids && !(a && ids.has(idOf(a)));
    }
  };
  const paint = (q, say) => {
    const p = liveParts(md, ctx, q);
    if (countEl) countEl.textContent = p.count;
    if (hitsEl) { hitsEl.innerHTML = p.hits ? p.hits.s : ''; hitsEl.hidden = !p.hits; }
    if (noneEl) { noneEl.innerHTML = p.none ? p.none.s : ''; noneEl.hidden = !p.none; }
    if (stage) stage.hidden = !!q && p.n === 0;
    paintDom(p.ids);
    if (say) ctx.announce?.(p.count);
    return p;
  };
  const apply = say => {
    const q = clean(input.value);
    if (q === applied) return null;
    applied = q;
    const p = paint(q, say);
    try { ctx.setQuery({ q }, { rerender: false }); } catch { /* the address is a convenience, the filter already works */ }
    return p;
  };
  const flush = () => { clearTimeout(timer); timer = 0; apply(true); };
  const onInput = () => { clearTimeout(timer); timer = setTimeout(() => { timer = 0; apply(true); }, 260); };
  const onKey = e => {
    if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; flush(); return; }
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(timer); timer = 0;
    apply(true);
    const q = clean(input.value);
    if (!q) return;
    const p = liveParts(md, ctx, q);
    if (p.n === 1) ctx.go?.(ctx.href('obshtina', { code: p.list[0].id }));
    else if (p.n > 1) hitsEl?.querySelector('a')?.focus();
  };
  // a click on a column header re-sorts the table body, which brings the hidden rows back: hide them again
  const onClick = e => { if (applied && e.target.closest?.('.th-sort')) paintDom(liveParts(md, ctx, applied).ids); };

  input.addEventListener('input', onInput);
  input.addEventListener('change', flush);
  input.addEventListener('blur', flush);
  input.addEventListener('keydown', onKey);
  root.addEventListener('click', onClick);
  if (applied) paint(applied, false);
  return () => {
    clearTimeout(timer);
    input.removeEventListener('input', onInput);
    input.removeEventListener('change', flush);
    input.removeEventListener('blur', flush);
    input.removeEventListener('keydown', onKey);
    root.removeEventListener('click', onClick);
  };
}
