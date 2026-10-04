// S33 · Какво искаш да направиш? · #/deystvie?tab=otkrij|prosledi|sravni|proveri · start · periods none
// The four things a visitor usually comes to do, each one a small work area on a tab: choose a few filters and the answer is drawn in place.
//   ОТКРИЙ    find one topic, tax, institution, programme or municipality (the engine and the index of the search screen, narrowed by kind)
//   ПРОСЛЕДИ  where the money comes from and where it goes: revenue by kind, expenditure by function, or both as one flow
//   СРАВНИ    one number in context: against GDP, per person, against the year before and, for the debt only, against the European Union
//   ПРОВЕРИ   the datasets behind the numbers: source, date, method, the file and the API
// Nothing is typed in here: every number comes from the data files the other screens already use (revenue, expenditure, outlook, debt, catalog) and every
// result links on to the screen that explains it. The choices live in the address (?tab= ?gled= ?god= ?mer= ?pok= ?merilo= ?sgod= ?ekran= ?izvor= ?status=
// ?q= ?vid=), so a link opens the same view. The filters of ПРОСЛЕДИ, СРАВНИ and ПРОВЕРИ redraw the page in place (data-query); ОТКРИЙ updates its result
// box while typing, like the search screen, and never replaces the field. Each panel is built on its own: one that cannot be built does not take the others down.
// Every control sits OUTSIDE the blocks, so the PNG of a block is the statistic only; the block title names the question, the chart title names the unit and the year.
import { html, plain } from '../html.js';
import { icon } from '../icons.js';
import { store } from '../store.js';
import { byId, href as routeHref } from '../routes.js';
import { num, pct, delta, date, plural, money, eur, NBSP, DASH } from '../format.js';
import { change } from '../view.js';
import { block } from '../ui/block.js';
import { tabs } from '../ui/tabs.js';
import { chips } from '../ui/chips.js';
import { seg } from '../ui/seg.js';
import { field, selectInput } from '../ui/forms.js';
import { chart } from '../ui/chart.js';
import { sankey } from '../ui/sankey.js';
import { linkCard, ext } from '../ui/cards.js';
import { emptyState, pendingState, errorState, mockHidden } from '../ui/states.js';
import { STATUS, statusPill } from '../ui/status.js';
import { srcShort } from '../ui/source.js';
import * as C from '../catalog.js';
import { getIndex, parse, run, mark, countText, hiddenText, screenOf, POPULAR, MAX_QUERY } from '../searchlib.js';

export const needs = ['core?', 'revenue?', 'expenditure?', 'outlook?', 'debt?', 'catalog?'];
export const styles = ['s33-deystvie'];

/* ---------------------------------------------------------------- small helpers */
const ok = v => typeof v === 'number' && Number.isFinite(v);
const tidy = (x, k) => Math.round(x * 10 ** k) / 10 ** k;
const yr = y => `${y}${NBSP}г.`;
const abs = Math.abs;
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);
/** a sentence that ends with an abbreviation (г.) must not get a second full stop */
const oneDot = s => String(s).replace(/\.\.(?!\.)/g, '.');
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
const sum = list => list.reduce((a, x) => a + x.mln, 0);
/** the value of a series at a year (the series and its years are separate arrays, and different series start in different years) */
const at = (arr, years, y) => { const i = years.indexOf(y); const v = i < 0 || !arr ? null : arr[i]; return ok(v) ? v : null; };
/** the way a year was reached, in words: as the middle line of a chart label, as one line, and in a sentence */
const KIND = { actual: 'отчет', prelim: 'предварителен отчет', plan: 'план', forecast: 'прогноза' };
const SHORT = { actual: 'отчет', prelim: 'предв. отчет', plan: 'план', forecast: 'прогноза' };
const CATW = { actual: 'отчет', prelim: 'предв.\nотчет', plan: 'план', forecast: 'прогноза' };
const kindOf = (vint, i) => KIND[vint && vint[i]] || '';
const statusOf = kind => (kind === 'forecast' ? 'forecast' : 'real');
/** a series that mixes reported and forecast years says so on its block */
const mixed = kinds => {
  const rep = kinds.some(k => k === 'actual' || k === 'prelim'), fc = kinds.some(k => k === 'plan' || k === 'forecast');
  return rep && fc ? { status: 'partial', statusLabel: 'Отчет и прогноза' } : fc ? { status: 'forecast' } : {};
};
/** the parts of one whole from the biggest to the smallest, the catch-all kind (lastId) always last */
const ranked = (list, lastId) => [...list].sort((a, b) => (a.id === lastId) - (b.id === lastId) || b.mln - a.mln);
/** the year the page opens on: the plan year, else the latest */
const defaultYear = (years, vint) => { const i = (vint || []).indexOf('plan'); return years[i >= 0 ? i : years.length - 1]; };
/** the asked year when the series has it, else the nearest one it has */
function pickYear(years, want, dflt) {
  if (!years.length) return null;
  const w = Number(want);
  if (!Number.isFinite(w) || want === '' || want == null) return dflt ?? years[years.length - 1];
  return years.reduce((best, y) => (abs(y - w) < abs(best - w) ? y : best), years[0]);
}
const persOf = ctx => { const p = ctx.data.core?.population?.persons; return ok(p) && p > 0 ? p : null; };
const popNote = ctx => { const d = ctx.data.core?.population?.date; return d ? ` „На човек“ е при населението към ${date(d, true)}${NBSP}г. за всички години.` : ''; };
const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 599px)').matches;
/** on a phone every second year label (counting back from the latest) keeps the labels apart; the tooltip and the table still hold every year */
const thin = n => ({ xAxis: { axisLabel: { interval: i => !narrow() || (n - 1 - i) % 2 === 0 } } });
const axisNum = v => { if (!ok(v)) return DASH; for (let k = 0; k < 3; k++) if (Math.abs(v - Number(v.toFixed(k))) < 1e-9) return num(v, k); return num(v, 2); };

/** the unit of a chart from the choice of this screen (the same rules as view.js chartUnit, but the choice is in the address, not in the settings):
 *  mer 'mln' (в евро: млн. or млрд., by size) | 'pct' (% от БВП) | 'chovek' (€ на човек) */
function unitFor(mer, persons, max) {
  let u;
  if (mer === 'pct') u = { kind: 'pct', unit: '% от БВП', d: 1, conv: (mln, pg) => (ok(pg) ? tidy(pg, 4) : null) };
  else if (mer === 'chovek' && persons) u = { kind: 'person', unit: '€ на човек', d: 0, conv: mln => (ok(mln) ? tidy((mln * 1e6) / persons, 2) : null) };
  else if (ok(max) && abs(max) >= 1000) u = { kind: 'mlrd', unit: 'млрд. €', d: 2, conv: mln => (ok(mln) ? tidy(mln / 1000, 5) : null) };
  else u = { kind: 'mln', unit: 'млн. €', d: ok(max) && abs(max) < 100 ? 1 : 0, conv: mln => (ok(mln) ? tidy(mln, 3) : null) };
  u.fmt = v => (ok(v) ? num(v, u.d) : DASH);
  u.option = (horizontal = false) => ({ [horizontal ? 'xAxis' : 'yAxis']: { axisLabel: { formatter: axisNum } } });
  return u;
}
/** the unit the screen opens with: what the settings say (% от БВП, на човек), else euro */
const defaultMer = () => (store.get('unit') === 'pct' ? 'pct' : store.get('perPerson') ? 'chovek' : 'mln');

const ACTIONS = [
  { key: 'otkrij', verb: 'Открий', icon: 'search', promise: 'Намери конкретна тема, данък, институция или програма.', help: 'Напиши дума и, ако искаш, избери вид.' },
  { key: 'prosledi', verb: 'Проследи', icon: 'transfer', promise: 'Покажи ми откъде идват и къде отиват парите.', help: 'Избери какво да видиш, за коя година и в какви единици.' },
  { key: 'sravni', verb: 'Сравни', icon: 'scale', promise: 'Постави числото в контекст.', help: 'Избери показател, година и мерило.' },
  { key: 'proveri', verb: 'Провери', icon: 'database', promise: 'Покажи ми оригиналните данни и методологията.', help: 'Избери тема и източник и виж наборите с данни зад числата.' }
];
const ICON = { S06: 'trendingUp', S07: 'pieChart', S10: 'landmark', S12: 'scale', S13: 'forecast', S15: 'gauge', S17: 'banknote', S19: 'list', S24: 'database', S25: 'code', S28: 'search', S31: 'barChart' };

/** „Продължи към“: cards to the screens that explain the result (items: a route id, or {id, href, text}) */
function onward(ctx, key, items) {
  const cards = items.map(it => (typeof it === 'string' ? { id: it } : it)).filter(it => byId[it.id])
    .map(it => linkCard({ href: it.href || ctx.href(it.id), icon: ICON[it.id] || 'arrowRight', title: byId[it.id].title, text: it.text ?? byId[it.id].desc }));
  if (!cards.length) return '';
  return html`<section class="s33-go" aria-labelledby="s33-go-${key}"><h3 class="s33-gh" id="s33-go-${key}">Продължи към</h3><div class="grid s33-cards">${cards}</div></section>`;
}
/** a control with a visible label above it; the group itself carries the accessible name (seg: radiogroup, chips: group), so the visible text is not read twice */
const segField = o => html`<div class="field s33-f"><span class="field-label" aria-hidden="true">${o.vis ?? o.label}</span>${seg(o)}</div>`;
const chipField = o => html`<div class="field s33-f"><span class="field-label" aria-hidden="true">${o.vis ?? o.label}</span>${chips(o)}</div>`;
const head = a => html`<h2 class="s33-ph">${a.promise}</h2><p class="s33-pl">${a.help}</p>`;

/* ================================================================ ОТКРИЙ: find a topic, tax, institution, programme, municipality */
const TYPES = [
  { id: 'temi', label: 'Теми' },
  { id: 'danatsi', label: 'Данъци' },
  { id: 'institutsii', label: 'Институции' },
  { id: 'programi', label: 'Програми' },
  { id: 'obshtini', label: 'Общини' }
];
const TYPE_IDS = TYPES.map(t => t.id);
const typeLabel = id => (TYPES.find(t => t.id === id) || {}).label || '';
const PER_GROUP = 5, PER_PAGE = 40, BROWSE = 12;
const WHERE = new Set(['indicators', 'institutions', 'municipalities', 'measures', 'datasets']);   // groups whose hits say which screen they open
// the index has groups, not kinds: a tax is a topic whose name says so, a programme is an institution entry whose line says „програма N“
const TAX = /(^|[^\p{L}])(данък|данъци|данъчн|ддс|ддфл|акциз|осигурител|осигуровк)/iu;
const PROG = /(^|[^\p{L}])(програма|политика)\s*\d/iu;
function typeOf(e) {
  if (e.group === 'municipalities') return 'obshtini';
  if (e.group === 'institutions') return PROG.test(e.sub || '') ? 'programi' : 'institutsii';
  return TAX.test(e.title || '') ? 'danatsi' : 'temi';
}
const TYPED = new WeakMap();
/** the index sorted into kinds once: {tag: Map(entry -> kind), lists: Map(kind -> entries by name)} */
function typed(ix) {
  let t = TYPED.get(ix);
  if (t) return t;
  const col = new Intl.Collator('bg');
  const tag = new Map(), lists = new Map(TYPE_IDS.map(id => [id, []]));
  for (const e of ix.entries) { const k = typeOf(e); tag.set(e, k); lists.get(k).push(e); }
  for (const l of lists.values()) l.sort((a, b) => col.compare(a.title || '', b.title || ''));
  t = { tag, lists };
  TYPED.set(ix, t);
  return t;
}

function hit(e, toks) {
  const where = WHERE.has(e.group) ? screenOf(e.href) : null;
  const meta = [e.sub, e.period].filter(Boolean).join(' · ');
  return html`<li class="s33-hit"${e.status === 'mock' ? html` data-mock="true"` : ''}>
    <div class="s33-top"><a class="s33-link" href="${e.href}">${mark(e.title, toks)}</a>${e.status === 'real' ? '' : statusPill(e.status)}</div>
    ${meta ? html`<p class="s33-sub">${meta}</p>` : ''}
    ${e.value ? html`<p class="s33-val">${e.value}</p>` : ''}
    ${where ? html`<p class="s33-in">Екран: ${where.title}</p>` : ''}
  </li>`;
}
const heading = (id, name, n) => html`<h3 class="s33-gh" id="${id}" tabindex="-1">${name}<span class="sr-only"> – ${countText(n)}</span><span class="s33-n" aria-hidden="true">${n}</span></h3>`;
const typeChips = (counts, total, vid) => html`<span class="field-label" aria-hidden="true">Търси сред</span>${chips({
  label: 'Търси сред', cls: 's33-types',
  items: [{ label: 'Всичко', count: total, key: 'v:', pressed: !vid }, ...TYPES.map(t => ({ label: t.label, count: counts[t.id] || 0, key: `v:${t.id}`, pressed: vid === t.id }))]
})}`;

/** the two boxes under the field for a query and a kind: {types (the kind chips with their counts), body, say (the sentence for the live region)}.
 *  Pure: used by render() and by the in-place updates of mount(). */
function viewO(ix, q, vid, o) {
  const T = typed(ix), real = !!o.onlyReal;
  const toks = parse(q);
  const note = ix.hasIndex ? '' : html`<p class="s33-note">${statusPill('pending')}<span>Показатели, ведомства и общини ще се търсят, когато данните бъдат включени. Засега търсим по екрани и понятия.</span></p>`;
  const popular = chips({ label: 'Примерни търсения', items: POPULAR.map(w => ({ label: w, key: `q:${w}` })) });
  const keep = e => !(real && e.status === 'mock');
  const whole = Object.fromEntries(TYPE_IDS.map(id => [id, T.lists.get(id).filter(keep).length]));
  const wholeN = TYPE_IDS.reduce((a, id) => a + whole[id], 0);
  const kind = TYPE_IDS.includes(vid) ? vid : '';
  const full = html`<p class="s33-more"><a href="${routeHref('S28', {}, q ? { q } : {})}">Отвори пълното търсене</a></p>`;

  if (!toks.length) {
    const typedShort = !!q;                                   // something was typed, but it is too short to search for
    const shortNote = typedShort ? html`<p class="s33-short">Напиши поне две букви.</p>` : '';
    if (!kind) {
      return {
        types: typeChips(whole, wholeN, ''), n: 0, say: typedShort ? 'Напиши поне две букви.' : '',
        body: html`<div class="s33-start">${shortNote}<h3 class="s33-gh">Започни с някое от тези</h3>${popular}<p class="s33-hint2">Или избери вид по-горе и разгледай всичко от него по азбучен ред.</p>${note}</div>`
      };
    }
    const all = T.lists.get(kind).filter(keep), shown = all.slice(0, BROWSE + PER_PAGE * (o.more || 0));
    return {
      types: typeChips(whole, wholeN, kind), n: all.length, say: `${typeLabel(kind)}: ${countText(all.length)}`,
      body: html`${shortNote}<section class="s33-grp" aria-labelledby="s33-gh">${heading('s33-gh', typeLabel(kind), all.length)}<p class="s33-count">По азбучен ред. Напиши дума в полето, за да стесниш списъка.</p>
        <ul class="s33-list">${shown.map(e => hit(e, []))}</ul>
        ${all.length > shown.length ? html`<p class="s33-more">Показани са ${shown.length} от ${all.length}. <button type="button" class="btn btn-sm" data-more>Покажи още ${Math.min(PER_PAGE, all.length - shown.length)}</button></p>` : ''}</section>${note}`
    };
  }

  const res = run(ix.entries, toks, { onlyReal: real });
  const hiddenNote = res.hidden ? mockHidden(hiddenText(res.hidden)) : '';
  const counts = Object.fromEntries(TYPE_IDS.map(id => [id, 0]));
  for (const e of res.hits) counts[T.tag.get(e)]++;
  const types = typeChips(counts, res.hits.length, kind);
  const more = chips({ label: 'Опитай с', items: POPULAR.map(w => ({ label: w, key: `q:${w}` })) });
  if (!res.hits.length) {
    return {
      types, n: 0, say: `Няма резултати за „${q}“`,
      body: html`${emptyState({ title: `${res.hidden ? 'Няма реални резултати за' : 'Няма резултат за'} „${q}“`, text: 'Опитай с по-кратка дума, с друго изписване (може и с латински букви) или с някое от тези:' })}${more}${hiddenNote}${full}${note}`
    };
  }
  const pick = kind ? res.hits.filter(e => T.tag.get(e) === kind) : res.hits;
  if (!pick.length) {
    return {
      types, n: 0, say: `Няма резултат за „${q}“ сред „${typeLabel(kind)}“`,
      body: html`${emptyState({ title: `Няма резултат за „${q}“ сред „${typeLabel(kind)}“`, text: `В другите видове има ${countText(res.hits.length)}.` })}<p class="s33-more"><button type="button" class="btn btn-sm" data-chip="v:">Търси във всичко</button></p>${hiddenNote}${full}${note}`
    };
  }
  const headLine = res.fuzzy
    ? html`<p class="s33-count">Няма точно съвпадение за „${q}“. Най-близките са:</p>`
    : html`<p class="s33-count"><strong>${countText(pick.length)}</strong> за „${q}“${kind ? html` сред „${typeLabel(kind)}“` : ''}</p>`;
  let body;
  if (kind) {
    const shown = pick.slice(0, PER_PAGE * (1 + (o.more || 0)));
    body = html`<section class="s33-grp" aria-labelledby="s33-gh">${heading('s33-gh', typeLabel(kind), pick.length)}<ul class="s33-list">${shown.map(e => hit(e, toks))}</ul>
      ${pick.length > shown.length ? html`<p class="s33-more">Показани са ${shown.length} от ${pick.length}. <button type="button" class="btn btn-sm" data-more>Покажи още ${Math.min(PER_PAGE, pick.length - shown.length)}</button></p>` : ''}</section>`;
  } else {
    const by = new Map();                                     // kinds in the order of their best hit (a Map: a kind id is data, never a property name)
    for (const e of res.hits) { const k = T.tag.get(e); if (!by.has(k)) by.set(k, []); by.get(k).push(e); }
    body = [...by].map(([k, list], i) => html`<section class="s33-grp" aria-labelledby="s33-gh${i}">${heading(`s33-gh${i}`, typeLabel(k), list.length)}<ul class="s33-list">${list.slice(0, PER_GROUP).map(e => hit(e, toks))}</ul>
      ${list.length > PER_GROUP ? html`<p class="s33-more"><button type="button" class="btn btn-sm" data-chip="v:${k}">Покажи всички ${list.length} в „${typeLabel(k)}“</button></p>` : ''}</section>`);
  }
  return { types, n: pick.length, say: `${countText(pick.length)}${res.fuzzy ? ', най-близките до написаното' : ''}`, body: html`${headLine}${body}${hiddenNote}${full}${note}` };
}

function panelO(ctx, ix) {
  const a = ACTIONS[0];
  const q = clean(ctx.query.q), vid = oneOf(String(ctx.query.vid ?? ''), TYPE_IDS, '');
  const v = viewO(ix, q, vid, { onlyReal: !!store.get('onlyReal'), more: 0 });
  return html`<div class="s33-panel" data-area="otkrij">${head(a)}
    <div class="s33-o" id="s33-o" data-gl-skip>
      <div class="s33-filters s33-find">
        <form class="s33-form" role="search" aria-label="Търсене по теми, данъци, институции, програми и общини">
          <label class="field-label" for="s33-q">Какво търсиш?</label>
          <p class="field-hint" id="s33-q-hint">Може и с латински букви: dds, plovdiv.</p>
          <div class="s33-wrap"><span class="s33-ic" aria-hidden="true">${icon('search', { size: 20 })}</span>
            <input class="input s33-q" id="s33-q" name="q" type="search" value="${q}" maxlength="${MAX_QUERY}" placeholder="Търси: ДДС, МВР, Пловдив…" aria-describedby="s33-q-hint" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
            <button type="button" class="icon-btn s33-clear" aria-label="Изчисти търсенето"${q ? '' : html` hidden`}>${icon('x', { size: 18 })}</button></div>
        </form>
        <div class="s33-ty field s33-f" id="s33-o-types" data-fk="s33-o-types">${v.types}</div>
      </div>
      <div class="s33-res" id="s33-o-res" data-fk="s33-o-res">${v.body}</div>
    </div></div>`;
}

function mountO(root, ctx, ix) {
  const box = root.querySelector('#s33-o');
  const input = box?.querySelector('#s33-q'), tbox = box?.querySelector('#s33-o-types'), res = box?.querySelector('#s33-o-res');
  const clear = box?.querySelector('.s33-clear'), formEl = box?.querySelector('.s33-form');
  if (!input || !tbox || !res || !clear || !formEl) return undefined;
  let q = clean(ctx.query.q), vid = oneOf(String(ctx.query.vid ?? ''), TYPE_IDS, ''), more = 0, tType = 0, tSay = 0;

  const paint = () => {
    const v = viewO(ix, q, vid, { onlyReal: !!store.get('onlyReal'), more });
    tbox.innerHTML = v.types.s;
    res.innerHTML = v.body.s;
    clearTimeout(tSay);
    tSay = setTimeout(() => { if (v.say) ctx.announce(v.say); }, 700);        // one sentence after the typing stops, not one per key
  };
  const apply = () => {
    clearTimeout(tType);
    clear.hidden = !input.value;
    const nq = clean(input.value);
    if (nq === q) return;
    q = nq; more = 0;
    ctx.setQuery({ q: q || null }, { rerender: false });
    paint();
  };

  input.addEventListener('input', () => { clear.hidden = !input.value; clearTimeout(tType); tType = setTimeout(apply, 140); });
  input.addEventListener('keydown', e => {
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowDown') { const first = res.querySelector('a.s33-link'); if (first) { e.preventDefault(); first.focus(); } }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; apply(); }
  });
  formEl.addEventListener('submit', e => { e.preventDefault(); apply(); });
  clear.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });

  box.addEventListener('click', e => {
    const b = e.target.closest('button[data-chip],button[data-more]');
    if (!b || !box.contains(b)) return;
    if (b.hasAttribute('data-more')) {
      const before = res.querySelectorAll('a.s33-link').length;
      more++; paint();
      res.querySelectorAll('a.s33-link')[before]?.focus();                     // the first of the newly shown hits
      return;
    }
    const k = b.dataset.chip || '';
    if (k.startsWith('q:')) { input.value = k.slice(2); apply(); input.focus(); return; }
    if (k.startsWith('v:')) {
      vid = k.slice(2); more = 0;
      ctx.setQuery({ vid: vid || null }, { rerender: false });
      paint();
      ([...box.querySelectorAll('[data-chip]')].find(x => x.dataset.chip === k) || res.querySelector('.s33-gh'))?.focus();
    }
  });
  res.addEventListener('keydown', e => {                                       // ↑ ↓ between the results; ↑ from the first one goes back to the field
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const links = [...res.querySelectorAll('a.s33-link')], i = links.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    if (e.key === 'ArrowUp' && i === 0) input.focus();
    else links[Math.max(0, Math.min(links.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });

  return () => { clearTimeout(tType); clearTimeout(tSay); };
}

/* ================================================================ ПРОСЛЕДИ: where the money comes from and where it goes */
// the kinds of revenue: short name and colour slot (the same as on the revenue screen); the functions take their slot from the order of the data
const REV = {
  dds: ['ДДС', 1], osiguritelni: ['Осигуровки', 2], nedanachni: ['Неданъчни приходи', 3], pomoshti: ['Помощи и дарения', 4],
  ddfl: ['Данък върху доходите', 5], akcizi: ['Акцизи', 7], korporativen: ['Корпоративен данък', 8], drugi: ['Други данъци и мита', 'other']
};
const GLED = { prihodi: 'Откъде идват', razhodi: 'Къде отиват', potok: 'Двете заедно' };
const HUB = 'Бюджет', FIN = 'Финансиране на дефицита', EUC = 'Вноска в общия бюджет на ЕС', SURPLUS = 'Излишък';
const biggest = items => items.reduce((a, b) => (b.mln > a.mln ? b : a), items[0]);
const popDate = ctx => { const d = ctx.data.core?.population?.date; return d ? `${date(d, true)}${NBSP}г.` : ''; };
/** the line under a chart title: the unit, and for „на човек“ the day the population was counted */
const unitLine = (ctx, u, tail) => `В ${u.unit}${u.kind === 'person' && popDate(ctx) ? ` (население към ${popDate(ctx)})` : ''}${tail ? `, ${tail}` : ''}.`;
const sourcesOf = (ctx, u, keys) => [...new Set([...(keys || []), ...(u.kind === 'person' ? ctx.data.core?.population?.source || [] : [])])];
const withKind = k => (KIND[k] ? ` (${KIND[k]})` : '');

/** the kinds of revenue in one year, biggest first (the catch-all kind last) */
function revenueAt(rev, y) {
  const i = (rev?.years || []).indexOf(y);
  if (i < 0) return null;
  const items = (rev.groups || []).map(g => {
    const [short, slot] = REV[g.id] || [g.name, 'other'];
    return { id: g.id, short, slot, mln: ok(g.mln?.[i]) ? g.mln[i] : null, pg: ok(g.pctGdp?.[i]) ? g.pctGdp[i] : null };
  }).filter(x => x.mln != null);
  if (!items.length) return null;
  const total = rev.total?.mln?.[i], totalPg = rev.total?.pctGdp?.[i];
  return { i, kind: rev.vintage?.[i], items: ranked(items, 'drugi'), total: ok(total) ? total : null, totalPg: ok(totalPg) ? totalPg : null };
}
/** the functions of the budget in one year, biggest first (the catch-all function last); the total is WITHOUT the contribution to the EU budget */
function spendAt(ex, y) {
  const f = ex?.functions, i = (f?.years || []).indexOf(y);
  if (i < 0) return null;
  const items = (f.items || []).map((x, k) => ({ id: x.id, short: x.short || x.name, slot: k < 8 ? k + 1 : 'other', mln: ok(x.mln?.[i]) ? x.mln[i] : null, pg: ok(x.pctGdp?.[i]) ? x.pctGdp[i] : null })).filter(x => x.mln != null);
  if (!items.length) return null;
  const total = f.totalMln?.[i], totalPg = f.totalPctGdp?.[i];
  return { i, kind: f.vintage?.[i], items: ranked(items, 'drugi'), total: ok(total) ? total : null, totalPg: ok(totalPg) ? totalPg : null };
}
const euAt = (ex, y) => at(ex?.economic?.rows?.find(x => x.id === 'x.eucontrib')?.mln, ex?.economic?.years || [], y);
/** everything the flow of one year needs, or null when the year cannot be drawn honestly: what comes in (revenue and the financing of the deficit) must equal
 *  what goes out (the functions and the contribution to the EU budget), give or take rounding */
function flowAt(rev, ex, out, y) {
  const r = revenueAt(rev, y), s = spendAt(ex, y);
  if (!r || !s) return null;
  const fin = at(out?.kfp?.financing?.mln, out?.years || [], y), eu = euAt(ex, y), gdp = at(out?.gdp?.mln, out?.years || [], y);
  if (fin == null || eu == null || gdp == null) return null;
  if (abs(sum(r.items) + fin - (sum(s.items) + eu)) > 1.5) return null;
  return { r, s, fin, eu, gdp, kind: r.kind };
}

/** one whole in parts (revenue by kind, expenditure by function): horizontal bars, or a pie, or the table, with the sentence that says the point */
function partsBlock(ctx, o) {
  const { r, y, mer, persons } = o;
  const u = unitFor(mer, persons, Math.max(0, ...r.items.map(x => x.mln)));
  const vals = r.items.map(x => u.conv(x.mln, x.pg));
  const spec = {
    id: o.chartId, type: 'barh', title: `${o.name}, ${yr(y)}`, sub: unitLine(ctx, u, 'от най-големия към най-малкия'),
    unit: u.unit, d: u.d, fmt: u.fmt, option: u.option(true),
    categories: r.items.map(x => x.short), categoryLabel: o.cat,
    series: [{ name: `${o.name}, ${yr(y)}`, data: vals, color: o.color }],
    labels: true, legend: false, labelWidth: 'auto', labelOverflow: 'break', height: Math.max(328, r.items.length * 44 + 40),
    views: ['bars', 'pie', 'table'], partColors: r.items.map(x => x.slot), pieHeight: 340,        // the parts add up to the whole, so a pie is honest
    desc: `Хоризонтални ленти за ${yr(y)}: ${r.items.map((x, i) => `${x.short} ${u.fmt(vals[i])} ${u.unit}`).join('; ')}.`
  };
  return block({
    id: o.id, title: o.title, level: 3, sub: o.sentence, scope: 'kfp', status: statusOf(r.kind),
    source: sourcesOf(ctx, u, o.meta?.source), asOf: o.meta?.asOf, body: chart(spec)
  });
}
function revenueBlock(ctx, rev, y, mer, persons) {
  const r = revenueAt(rev, y);
  if (!r) return emptyState({ title: `За ${yr(y)} няма данни за приходите`, text: 'Избери друга година.' });
  const total = r.total ?? sum(r.items), top = biggest(r.items), share = total > 0 ? (top.mln / total) * 100 : null;
  const sentence = oneDot(`Приходите през ${yr(y)}${withKind(r.kind)} са ${money(total, { d: 1 })}${r.totalPg != null ? ` — ${pct(r.totalPg, 1)} от БВП` : ''}. Най-голям дял има „${top.short}“: ${money(top.mln, { d: 1 })}${share != null ? ` (${pct(share, 1)} от приходите)` : ''}.`);
  return partsBlock(ctx, { r, y, mer, persons, meta: rev.meta, id: 's33-p-prihodi', chartId: 's33-ch-prihodi', title: `Откъде идват парите през ${yr(y)}`, name: 'Приходи по видове', cat: 'Източник', color: '--rev', sentence });
}
function spendBlock(ctx, ex, y, mer, persons) {
  const s = spendAt(ex, y);
  if (!s) return emptyState({ title: `За ${yr(y)} няма данни за разходите`, text: 'Избери друга година.' });
  const total = s.total ?? sum(s.items), top = biggest(s.items), share = total > 0 ? (top.mln / total) * 100 : null, eu = euAt(ex, y);
  const sentence = oneDot(`Разходите по функции през ${yr(y)}${withKind(s.kind)} са ${money(total, { d: 1 })}${s.totalPg != null ? ` — ${pct(s.totalPg, 1)} от БВП` : ''}. `
    + `${eu != null ? `Към тях се добавя вноската в общия бюджет на ЕС (${money(eu, { d: 1 })}): общо ${money(total + eu, { d: 1 })}. ` : ''}`
    + `Най-много отива за „${top.short}“: ${money(top.mln, { d: 1 })}${share != null ? ` (${pct(share, 1)})` : ''}.`);
  return partsBlock(ctx, { r: s, y, mer, persons, meta: ex.meta, id: 's33-p-razhodi', chartId: 's33-ch-razhodi', title: `Къде отиват парите през ${yr(y)}`, name: 'Разходи по функции', cat: 'Функция', color: '--exp', sentence });
}
/** both in one picture: the kinds of revenue (and, when the budget is in deficit, its financing) flow into the budget, and the budget flows out to the functions
 *  (and to the EU budget); every number is converted by the chosen unit before it goes to the diagram */
function flowBlock(ctx, rev, ex, f, y, mer, persons) {
  const u = unitFor(mer, persons, Math.max(sum(f.r.items) + Math.max(f.fin, 0), sum(f.s.items) + f.eu));
  const conv = mln => u.conv(mln, (mln / f.gdp) * 100);
  const deficit = f.fin > 0, surplus = f.fin < 0;
  const nodes = [
    ...f.r.items.map(x => ({ name: x.short, color: '--rev' })), ...(deficit ? [{ name: FIN, color: '--warn' }] : []),
    { name: HUB, color: '--data' },
    ...f.s.items.map(x => ({ name: x.short, color: '--exp' })), { name: EUC, color: '--exp' }, ...(surplus ? [{ name: SURPLUS, color: '--ok' }] : [])
  ];
  const links = [
    ...f.r.items.map(x => ({ source: x.short, target: HUB, value: conv(x.mln) })), ...(deficit ? [{ source: FIN, target: HUB, value: conv(f.fin) }] : []),
    ...f.s.items.map(x => ({ source: HUB, target: x.short, value: conv(x.mln) })), { source: HUB, target: EUC, value: conv(f.eu) }, ...(surplus ? [{ source: HUB, target: SURPLUS, value: conv(-f.fin) }] : [])
  ];
  const revTotal = f.r.total ?? sum(f.r.items), spendTotal = f.s.total ?? sum(f.s.items);
  const sentence = oneDot(`Приходите (${money(revTotal, { d: 1 })})${deficit ? ` и финансирането на дефицита (${money(f.fin, { d: 1 })})` : ''} покриват разходите по функции (${money(spendTotal, { d: 1 })}), вноската в общия бюджет на ЕС (${money(f.eu, { d: 1 })})${surplus ? ` и излишъка (${money(-f.fin, { d: 1 })})` : ''}. Данните са за ${yr(y)}${withKind(f.kind)}.`);
  return block({
    id: 's33-p-potok', title: `От приходите към разходите през ${yr(y)}`, level: 3, sub: sentence, scope: 'kfp', status: statusOf(f.kind),
    source: sourcesOf(ctx, u, [...new Set([...(rev.meta?.source || []), ...(ex.meta?.source || [])])]), asOf: [rev.meta?.asOf, ex.meta?.asOf].filter(Boolean).sort().pop(),
    body: sankey({ id: 's33-flow', sub: unitLine(ctx, u), label: `От приходите към разходите през ${yr(y)}`, desc: sentence, unit: u.unit, d: u.d, nodes, links })
  });
}

function panelP(ctx) {
  const a = ACTIONS[1];
  const rev = ctx.data.revenue, ex = ctx.data.expenditure, out = ctx.data.outlook;
  const hasRev = !!(rev?.groups?.length && rev.years?.length), hasEx = !!(ex?.functions?.items?.length && ex.functions.years?.length);
  const flowYears = hasRev && hasEx && out ? [...new Set([...rev.years, ...ex.functions.years])].sort((p, q) => p - q).filter(y => flowAt(rev, ex, out, y)) : [];
  const views = [...(hasRev ? ['prihodi'] : []), ...(hasEx ? ['razhodi'] : []), ...(flowYears.length ? ['potok'] : [])];
  if (!views.length) return html`<div class="s33-panel" data-area="prosledi">${head(a)}${pendingState({ title: 'Данните за приходите и разходите не са налични', text: 'Опитай пак по-късно.', source: ['asbp'] })}</div>`;

  const gled = oneOf(String(ctx.query.gled ?? ''), views, views[0]);
  const yrs = gled === 'prihodi' ? rev.years : gled === 'razhodi' ? ex.functions.years : flowYears;
  const vint = gled === 'prihodi' ? rev.vintage : gled === 'razhodi' ? ex.functions.vintage : flowYears.map(y => rev.vintage?.[rev.years.indexOf(y)]);
  const y = pickYear(yrs, ctx.query.god, defaultYear(yrs, vint));
  const persons = persOf(ctx);
  const mers = [['mln', 'В евро'], ['pct', '% от БВП'], ...(persons ? [['chovek', 'На човек']] : [])];
  const want = defaultMer();
  const mer = oneOf(String(ctx.query.mer ?? ''), mers.map(m => m[0]), mers.some(m => m[0] === want) ? want : 'mln');

  const filters = html`<div class="s33-filters" data-gl-skip>
    ${views.length > 1 ? segField({ name: 's33-gled', label: 'Какво да покажа', vis: 'Покажи', value: gled, query: 'gled', options: views.map(v => ({ value: v, label: GLED[v] })) }) : ''}
    ${chipField({ label: 'Година', vis: 'За година', items: yrs.map((yy, i) => ({ label: String(yy), count: SHORT[vint?.[i]] || '', query: `god=${yy}`, pressed: yy === y })) })}
    ${segField({ name: 's33-mer', label: 'Единици', vis: 'Покажи в', value: mer, query: 'mer', options: mers.map(([value, label]) => ({ value, label })) })}
  </div>`;
  const result = gled === 'prihodi' ? revenueBlock(ctx, rev, y, mer, persons)
    : gled === 'razhodi' ? spendBlock(ctx, ex, y, mer, persons)
      : flowBlock(ctx, rev, ex, flowAt(rev, ex, out, y), y, mer, persons);
  return html`<div class="s33-panel" data-area="prosledi">${head(a)}${filters}${result}${onward(ctx, 'prosledi', ['S06', 'S07', 'S10', 'S13', 'S15'])}</div>`;
}

/* ================================================================ СРАВНИ: one number in context */
const MERILA = { bvp: '% от БВП', chovek: 'На човек', predishna: 'Предходната година', eu: 'Европейския съюз' };
/** the indicators the data supports, each with its years, the way each year was reached and the source (the numbers are never typed in here) */
function indicators(ctx) {
  const out = ctx.data.outlook, ex = ctx.data.expenditure, mt = ctx.data.debt?.maastricht, list = [];
  const add = o => { if (Array.isArray(o.years) && Array.isArray(o.mln) && o.mln.some(ok)) list.push(o); };
  const kfp = out?.kfp;
  if (kfp) {
    const b = { years: out.years, vint: out.vintage, meta: out.meta, scope: 'kfp' };
    add({ key: 'prihodi', label: 'Приходи', subj: 'Приходите', pl: true, mln: kfp.revenue?.mln, pg: kfp.revenue?.pctGdp, color: '--rev', ...b });
    add({ key: 'razhodi', label: 'Общо разходи', subj: 'Общите разходи', pl: true, mln: kfp.expenditure?.mln, pg: kfp.expenditure?.pctGdp, color: '--exp', ...b });
    add({ key: 'saldo', label: 'Дефицит или излишък', subj: 'Дефицитът', pl: false, bal: true, mln: kfp.balance?.mln, pg: kfp.balance?.pctGdp, color: '--data', ...b });
    add({ key: 'lihvi', label: 'Лихви по дълга', subj: 'Лихвите', pl: true, mln: kfp.interest?.mln, pg: kfp.interest?.pctGdp, color: '--exp', ...b });
  }
  const eco = ex?.economic;
  if (eco) {
    for (const [key, id, label, subj] of [['zaplati', 'x.wages', 'Заплати', 'Заплатите'], ['pensii', 'x.pensions', 'Пенсии', 'Пенсиите'], ['kapitalovi', 'x.capex', 'Капиталови разходи', 'Капиталовите разходи']]) {
      const row = eco.rows?.find(x => x.id === id);
      if (row) add({ key, label, subj, pl: true, mln: row.mln, pg: row.pctGdp, color: '--exp', years: eco.years, vint: eco.vintage, meta: ex.meta, scope: 'kfp' });
    }
  }
  if (mt?.bg) add({ key: 'dalg', label: 'Дълг по Маастрихт', subj: 'Дългът по Маастрихт', pl: false, mln: mt.bg.mln, pg: mt.bg.pctGdp, eu: mt.eu27?.pctGdp, thr: mt.thresholdPctGdp, years: mt.years, vint: null, meta: mt, scope: 'maastricht', color: '--data' });
  return list;
}
const axisPct = v => (ok(v) ? `${axisNum(v)}%` : DASH);
/** the year axis: two-line labels (year, how it was reached); the chosen year in bold; on a phone with many years every second one */
const axisX = (n, Y) => ({
  xAxis: {
    axisLabel: {
      ...(n > 6 ? { interval: i => !narrow() || (n - 1 - i) % 2 === 0 } : {}),
      formatter: c => { const t = String(c).split('\n'); return t.map(s => (t[0] === String(Y) ? `{b|${s}}` : s)).join('\n'); },
      rich: { b: { fontWeight: 700 } }
    }
  }
});
const oneLine = (spec, labels) => ({
  columns: [{ key: 'c', label: spec.categoryLabel || 'Категория' }, ...spec.series.map((x, i) => ({ key: `s${i}`, label: x.name, unit: spec.unit, d: spec.d, num: true, fmt: v => (ok(v) ? spec.fmt(v) : DASH) }))],
  rows: labels.map((c, j) => Object.fromEntries([['c', c], ...spec.series.map((x, i) => [`s${i}`, x.data[j] ?? null])]))
});

/** the debt of Bulgaria and of the European Union as a share of GDP, with the reference line (a euro amount of different countries does not compare) */
function euBlock(ctx, ind, Y) {
  const years = ind.years, n = years.length, iY = years.indexOf(Y), thr = ok(ind.thr) ? ind.thr : null;
  const bg = years.map((_, i) => (ok(ind.pg?.[i]) ? ind.pg[i] : null)), eu = years.map((_, i) => (ok(ind.eu?.[i]) ? ind.eu[i] : null));
  if (bg[iY] == null) return emptyState({ title: `За ${yr(Y)} няма данни за дълга`, text: 'Избери друга година.' });
  const sentence = oneDot(`През ${yr(Y)} дългът на България е ${pct(bg[iY], 1)} от БВП${eu[iY] != null ? `, а на Европейския съюз като цяло — ${pct(eu[iY], 1)}` : '. За Европейския съюз за тази година няма данни'}${thr != null ? `, при референтна стойност ${pct(thr, 0)}` : ''}.`);
  const series = [{ name: 'България', color: 1, data: bg }, { name: 'Европейски съюз (27 държави)', color: 2, data: eu }, ...(thr != null ? [{ name: `Референтна стойност (${pct(thr, 0)} от БВП)`, color: '--warn', dashed: true, data: years.map(() => thr) }] : [])];
  const spec = {
    id: 's33-ch-eu', type: 'line', title: `Дългът като дял от БВП: България и ЕС, ${years[0]}–${years[n - 1]}`, sub: '% от БВП, към края на годината.',
    categories: years.map(String), categoryLabel: 'Година', unit: '% от БВП', d: 1, fmt: v => (ok(v) ? num(v, 1) : DASH), min: 0, height: 320,
    views: ['line', 'table'], option: { ...thinX(n), yAxis: { axisLabel: { formatter: axisNum } } }, series, desc: sentence
  };
  return block({ id: 's33-c-sravnenie', title: 'Дългът спрямо Европейския съюз', level: 3, sub: sentence, scope: ind.scope, status: 'real', source: ind.meta?.source || ['eurostat'], asOf: ind.meta?.asOf, body: chart(spec) });
}
const thinX = n => (n > 6 ? { xAxis: { axisLabel: { interval: i => !narrow() || (n - 1 - i) % 2 === 0 } } } : {});

function compareBlock(ctx, ind, mer, Y, persons) {
  if (mer === 'eu') return euBlock(ctx, ind, Y);
  const years = ind.years, n = years.length, iY = years.indexOf(Y), kinds = years.map((_, i) => ind.vint?.[i]);
  const v = i => (ok(ind.mln[i]) ? ind.mln[i] : null), g = i => (ok(ind.pg?.[i]) ? ind.pg[i] : null);
  if (v(iY) == null) return emptyState({ title: `За ${yr(Y)} няма данни за „${ind.label}“`, text: 'Избери друга година.' });
  const A = x => (x != null && ind.bal ? abs(x) : x);                                    // a balance is told as a size („дефицит от …“); the sign is in the word
  const word = x => (x < 0 ? 'дефицит' : 'излишък');
  const before = q => (ind.bal && word(v(q)) !== word(v(iY)) ? `${word(v(q))} от ` : '');   // a balance that changed its sign says so
  const subj = ind.bal ? (v(iY) < 0 ? 'Дефицитът' : 'Излишъкът') : ind.subj, cop = ind.pl ? 'са' : 'е', when = `през ${yr(Y)}${withKind(kinds[iY])}`;
  const p = iY > 0 && v(iY - 1) != null ? iY - 1 : -1;                                   // the year before, when the data has it
  const span = `${years[0]}–${years[n - 1]}`, fc = kinds.indexOf('forecast');
  const flat = years.map((y, i) => (SHORT[kinds[i]] ? `${y} ${SHORT[kinds[i]]}` : String(y)));
  const cats = years.map((y, i) => (CATW[kinds[i]] ? `${y}\n${CATW[kinds[i]]}` : String(y)));
  let title, chartTitle, sub, unit, d, fmt, values, sentence;
  if (mer === 'chovek') {
    const pp = i => (v(i) != null ? tidy((v(i) * 1e6) / persons, 2) : null);
    values = years.map((_, i) => pp(i)); unit = '€ на човек'; d = 0; fmt = x => (ok(x) ? num(x, 0) : DASH);
    title = `${ind.label} на човек`; chartTitle = `${ind.label} на човек, ${span}`; sub = `€ на човек${popDate(ctx) ? ` (население към ${popDate(ctx)})` : ''}.`;
    sentence = `${subj} ${when} ${cop} ${eur(A(pp(iY)), 0)} на човек${p >= 0 ? ` — при ${before(p)}${eur(A(pp(p)), 0)} през ${yr(years[p])}` : ''}.${p >= 0 ? popNote(ctx) : ''}`;
  } else if (mer === 'predishna') {
    const ch = i => (i > 0 ? change(v(i), v(i - 1)) : null);
    values = years.map((_, i) => ch(i)); unit = ''; d = 1; fmt = x => (ok(x) ? delta(x, 1) : DASH);
    title = `${ind.label} спрямо предходната година`; chartTitle = `${ind.label}: промяна спрямо предходната година, ${span}`; sub = 'Промяна в %, в текущи цени.';
    const c = ch(iY);
    sentence = c == null
      ? `${subj} ${when} ${cop} ${money(v(iY), { d: 1 })}. За ${yr(Y)} в данните няма предходна година за сравнение.`
      : `${subj} ${when} ${cop} ${money(v(iY), { d: 1 })} — ${abs(c) < 0.05 ? 'без промяна' : `с ${num(abs(c), 1)}%${NBSP}${c > 0 ? 'повече' : 'по-малко'}`}, отколкото през ${yr(years[p])} (${money(v(p), { d: 1 })}). Сравнението е в текущи цени, без изчистване от инфлацията.`;
  } else {
    values = years.map((_, i) => g(i)); unit = '% от БВП'; d = 1; fmt = x => (ok(x) ? num(x, 1) : DASH);
    title = `${ind.label} спрямо БВП`; chartTitle = `${ind.label} като дял от БВП, ${span}`; sub = '% от БВП.';
    const prior = p >= 0 && g(p) != null ? ` — при ${before(p)}${pct(A(g(p)), 1)} през ${yr(years[p])}` : '';
    sentence = `${subj} ${when} ${cop} ${money(A(v(iY)), { d: 1 })}${g(iY) != null ? `, или ${pct(A(g(iY)), 1)} от БВП` : ''}${prior}.`;
  }
  sentence = oneDot(sentence);
  const spec = {
    id: 's33-ch-sravnenie', type: 'bar', title: chartTitle, sub, unit, d, fmt, categories: cats, categoryLabel: 'Година', height: 320, labels: n <= 6, legend: false,
    views: ['bars', 'line', 'table'], option: { ...axisX(n, Y), yAxis: { axisLabel: { formatter: mer === 'predishna' ? axisPct : axisNum } } },
    series: [{ name: chartTitle, color: ind.color, data: values, ...(fc > 0 ? { dashFrom: fc } : {}) }], desc: sentence
  };
  spec.table = oneLine(spec, flat);
  const how = mixed(kinds);                                                              // reported and forecast years together say so; a series with no forecast is real
  return block({
    id: 's33-c-sravnenie', title, level: 3, sub: sentence, scope: ind.scope, ...(how.status ? how : { status: 'real' }),
    source: sourcesOf(ctx, { kind: mer === 'chovek' ? 'person' : '' }, ind.meta?.source), asOf: ind.meta?.asOf, body: chart(spec)
  });
}

function panelS(ctx) {
  const a = ACTIONS[2];
  const inds = indicators(ctx);
  if (!inds.length) return html`<div class="s33-panel" data-area="sravni">${head(a)}${pendingState({ title: 'Числата за сравнение не са налични', text: 'Опитай пак по-късно.', source: ['asbp'] })}</div>`;
  const persons = persOf(ctx);
  const ind = inds.find(x => x.key === ctx.query.pok) || inds[0];
  const mers = [
    ...(ind.pg?.some(ok) ? ['bvp'] : []), ...(persons ? ['chovek'] : []),
    ...(!ind.bal && ind.mln.filter(ok).length > 1 ? ['predishna'] : []), ...(ind.eu?.some(ok) ? ['eu'] : [])
  ];
  if (!mers.length) return html`<div class="s33-panel" data-area="sravni">${head(a)}${emptyState({ title: `За „${ind.label}“ няма с какво да сравним`, text: 'Избери друг показател.' })}</div>`;
  const want = store.get('perPerson') && mers.includes('chovek') ? 'chovek' : mers[0];
  const mer = oneOf(String(ctx.query.merilo ?? ''), mers, want);
  const Y = pickYear(ind.years, ctx.query.sgod, defaultYear(ind.years, ind.vint));
  const filters = html`<div class="s33-filters" data-gl-skip>
    ${field({ id: 's33-c-pok', label: 'Показател', control: selectInput({ id: 's33-c-pok', name: 'pok', query: 'pok', value: ind.key, options: inds.map(x => ({ value: x.key, label: x.label })) }) })}
    ${field({ id: 's33-c-sgod', label: 'Година', control: selectInput({ id: 's33-c-sgod', name: 'sgod', query: 'sgod', value: Y, options: ind.years.map((y, i) => ({ value: y, label: SHORT[ind.vint?.[i]] ? `${y} · ${SHORT[ind.vint[i]]}` : String(y) })) }) })}
    ${chipField({ label: 'Мерило', items: mers.map(k => ({ label: MERILA[k], query: `merilo=${k}`, pressed: k === mer })) })}
  </div>`;
  return html`<div class="s33-panel" data-area="sravni">${head(a)}${filters}${compareBlock(ctx, ind, mer, Y, persons)}${onward(ctx, 'sravni', ['S17', 'S13', 'S19', 'S31'])}</div>`;
}

/* ================================================================ ПРОВЕРИ: the datasets behind the numbers */
const SHOW = 8;                                                                  // rows before „Покажи всички“
const uniq = a => [...new Set(a)];
const joinL = (items, sep = ', ') => html`${items.map((x, i) => html`${i ? sep : ''}${x}`)}`;
const fmtOf = set => set.format || set.ext.toUpperCase();
const isMulti = set => !set.file && set.parts.length > 0;
const fileInfo = set => [fmtOf(set), isMulti(set) ? plural(set.parts.length, 'файл', 'файла') : '', C.sizeLabel(set.bytes)].filter(Boolean).join(' · ');
const srcLink = (k, M) => { const s = M.src(k); return s.url ? ext(s.url, srcShort(k)) : srcShort(k); };
const publishers = (set, M) => uniq(set.source.map(k => (M.src(k).publisher || '').replace(/;\s*/g, ', ')).filter(Boolean)).join(', ');
const metaDl = rows => html`<dl class="s33-meta">${rows.filter(r => r && r.v != null && r.v !== '' && r.v !== false).map(r => html`<div class="s33-m${r.wide ? ' s33-m-wide' : ''}"><dt>${r.k}</dt><dd>${r.v}</dd></div>`)}</dl>`;
/** the first sentence of a paragraph of the catalogue (not cut at an abbreviation: at least twenty letters first) */
function firstSentence(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const m = t.match(/^.{20,}?[.!?](?=\s|$)/);
  const r = m ? m[0] : t;
  return r.length > 200 ? `${r.slice(0, 197).replace(/\s+\S*$/, '')}…` : r;
}
/** the heading of a methodology note (m) or a trap (t) on the catalogue screen: the address that jumps to it */
const noteHref = (kind, t) => routeHref('danni', {}, { to: `s24-${kind}-${C.idPart(t.id)}` });

/** one dataset: its name, where it comes from, how fresh it is, how it is read, and the file */
function rowV(set, M) {
  const pend = set.status === 'pending';
  const real = set.source.filter(k => k !== 'mockgen');
  const src = keys => {
    const shown = keys.slice(0, 2).map(k => srcLink(k, M)), more = keys.length - shown.length;
    return html`${joinL(shown)}${more > 0 ? html` <a href="${routeHref('danni', { set: set.slug })}" aria-label="и още ${num(more, 0)}: всички източници на „${set.title}“">и още ${num(more, 0)}</a>` : ''}`;
  };
  const notes = [...C.relatedTo(M.methods, set).map(t => ['m', t]), ...C.relatedTo(M.traps, set).map(t => ['t', t])];
  const how = notes.length
    ? joinL(notes.slice(0, 2).map(([k, t]) => html`<a href="${noteHref(k, t)}">${t.title}</a>`), '; ')
    : html`<a href="${routeHref('danni', {}, { to: 's24-method' })}">Как подреждаме и показваме числата</a>`;
  const rows = pend
    ? [{ k: 'Откъде ще дойдат', v: set.expected || publishers(set, M) }, { k: 'Засяга', v: set.screenRoutes.length ? joinL(set.screenRoutes.map(r => html`<a href="${routeHref(r.key)}">${r.title}</a>`)) : '' }]
    : [
      set.mock ? { k: 'Източник', v: 'Няма: стойностите са измислени', wide: true } : { k: set.source.length > 1 ? 'Източници' : 'Източник', v: set.source.length ? src(set.source) : '', wide: true },
      set.mock && real.length ? { k: 'Свързан с данни от', v: src(real), wide: true } : null,
      { k: 'Период', v: C.periodLabel(set.period) },
      { k: set.mock ? 'Създадени на' : 'Данни към', v: set.asOf ? date(set.asOf) : '' },
      { k: 'Единица', v: set.unit },
      { k: 'Формат', v: fileInfo(set) },
      { k: 'Методика', v: how, wide: true }
    ];
  const get = set.file
    ? html`<a class="btn btn-sm" href="${set.file}" download="${C.dlName(set)}">${icon('download', { size: 16 })}<span>Свали ${fmtOf(set)}</span><span class="sr-only"> – ${set.title}</span></a>`
    : isMulti(set)
      ? html`<a class="btn btn-sm" href="${routeHref('danni', { set: set.slug }, { to: 's24-d-get' })}">${icon('download', { size: 16 })}<span>Виж и свали ${plural(set.parts.length, 'файл', 'файла')}</span><span class="sr-only"> – ${set.title}</span></a>`
      : '';
  const acts = pend ? '' : html`<div class="s33-acts">${get}<a class="btn btn-sm" href="${routeHref('api', {}, { set: set.slug, to: 's25-read' })}">${icon('code', { size: 16 })}<span>Как да го четеш с код</span><span class="sr-only"> – ${set.title}</span></a></div>`;
  return html`<li class="s33-row" data-st="${set.status}">
    <div class="s33-row-top"><a class="s33-rlink" href="${routeHref('danni', { set: set.slug })}">${set.title}</a>${statusPill(set.status)}</div>
    ${set.desc ? html`<p class="s33-row-desc">${C.rich(set.desc, M)}</p>` : ''}
    ${metaDl(rows)}
    ${acts}</li>`;
}

/** a methodology note or a trap: its name (a link to the full text) and its first sentence */
const noteItem = (kind, t, M) => html`<li class="s33-mi"><a class="s33-mlink" href="${noteHref(kind, t)}">${t.title}</a><p>${C.rich(firstSentence(t.paras[0]), M)}</p></li>`;

function panelV(ctx) {
  const a = ACTIONS[3];
  const M = C.model(ctx.data.catalog, ctx.core?.sources);
  if (!M.sets.length) return html`<div class="s33-panel" data-area="proveri">${head(a)}${pendingState({ title: 'Каталогът на наборите не е наличен', text: 'Опитай пак по-късно.', source: ['wg'] })}</div>`;
  // the catalogue filter reads the search text too (?q=), which belongs to ОТКРИЙ here: leave it out
  const f = C.readFilter({ status: ctx.query.status, ekran: ctx.query.ekran, izvor: ctx.query.izvor }, M);
  const sets = M.groups.flatMap(g => g.sets);
  const vis = sets.filter(s => C.passes(s, f)), visSet = new Set(vis);
  const statusN = {};
  let allN = 0;
  for (const s of sets) if (C.passes(s, f, ['status'])) { allN++; statusN[s.status] = (statusN[s.status] || 0) + 1; }
  const wide = ctx.query.mnogo === '1' || vis.length <= SHOW;
  const shown = wide ? vis : vis.slice(0, SHOW);

  const screens = [{ value: '', label: 'Всички теми' }, ...M.screens.map(s => ({ value: s.key, label: s.title }))];
  const sources = [{ value: '', label: 'Всички източници' }, ...M.sourceKeys.map(k => ({ value: k, label: srcShort(k) }))];
  const statusItems = [
    { label: 'Всички', count: allN, query: 'status=', pressed: !f.status },
    ...C.STATUSES.filter(st => M.counts[st] > 0).map(st => ({ label: STATUS[st].label, count: statusN[st] || 0, query: `status=${st}`, pressed: f.status === st }))
  ];
  const filters = html`<div class="s33-filters" data-gl-skip>
    ${field({ id: 's33-v-ekran', label: 'Тема', control: selectInput({ id: 's33-v-ekran', name: 'ekran', query: 'ekran', value: f.ekran, options: screens }) })}
    ${field({ id: 's33-v-izvor', label: 'Източник', control: selectInput({ id: 's33-v-izvor', name: 'izvor', query: 'izvor', value: f.izvor, options: sources }) })}
    ${chipField({ label: 'Статус на данните', vis: 'Статус', items: statusItems })}
  </div>`;

  const reset = ctx.href('deystvie', {}, { tab: 'proveri' });
  const list = vis.length
    ? html`<ul class="s33-list s33-sets" role="list">${shown.map(s => rowV(s, M))}</ul>
      ${vis.length > SHOW ? html`<p class="s33-more"><button type="button" class="btn btn-sm" id="s33-v-more" data-query="mnogo=${wide ? '' : '1'}">${wide ? `Покажи само първите ${SHOW}` : `Покажи всички ${vis.length}`}</button></p>` : ''}`
    : emptyState({ title: 'Няма набор, който да отговаря на избраното', text: 'Опитай с друга тема или друг източник.', action: { label: 'Изчисти филтрите', href: reset } });
  const count = vis.length
    ? `Показани: ${num(shown.length, 0)} от ${plural(vis.length, 'набор', 'набора')}${f.active ? ` (всичко в каталога: ${num(M.sets.length, 0)})` : ''}.`
    : `Няма показани набори (всичко в каталога: ${num(M.sets.length, 0)}).`;
  const result = block({ id: 's33-v-nabori', title: 'Наборите данни зад числата', level: 3, sub: count, body: list });

  const rel = list => (f.active ? list.filter(t => t.related.some(s => visSet.has(s))) : list);
  const methods = rel(M.methods), traps = rel(M.traps);
  const notes = methods.length || traps.length ? block({
    id: 's33-v-metodika', title: 'Методика и капани', level: 3,
    sub: f.active ? 'Бележките, които засягат избраните набори.' : 'Как са подредени числата и на какво да внимаваш, когато ги четеш.',
    body: html`<div class="s33-two">
      ${methods.length ? html`<div><h4 class="s33-h4">Как смятаме</h4><ul class="s33-ml" role="list">${methods.map(t => noteItem('m', t, M))}</ul></div>` : ''}
      ${traps.length ? html`<div><h4 class="s33-h4">На какво да внимаваш</h4><ul class="s33-ml" role="list">${traps.map(t => noteItem('t', t, M))}</ul></div>` : ''}</div>`
  }) : '';

  const carry = { status: f.status || null, ekran: f.ekran || null, izvor: f.izvor || null, to: 's24-sets' };
  return html`<div class="s33-panel" data-area="proveri">${head(a)}${filters}${result}${notes}${onward(ctx, 'proveri', [{ id: 'S24', href: ctx.href('danni', {}, carry), text: 'Всички набори, първичните източници, файловете и контролните им суми.' }, 'S25'])}</div>`;
}

/* ================================================================ the page */
const KEYS = ACTIONS.map(a => a.key);
const tabLabel = a => html`<span class="s33-tab-ic" aria-hidden="true">${icon(a.icon, { size: 22 })}</span><span class="s33-tab-t">${a.verb}</span>`;

export async function render(ctx) {
  const ix = await getIndex();                                                    // never rejects: without the index ОТКРИЙ still has the screens and the glossary
  const panel = a => {
    try { return a.key === 'otkrij' ? panelO(ctx, ix) : a.key === 'prosledi' ? panelP(ctx) : a.key === 'sravni' ? panelS(ctx) : panelV(ctx); }
    catch (e) {                                                                   // one area that cannot be drawn must not take the others down
      console.error(`S33 ${a.key}`, e);
      return html`<div class="s33-panel" data-area="${a.key}">${head(a)}${errorState({ title: 'Този раздел не може да се покаже.', text: 'Другите работят. Опитай пак по-късно.', retry: false, link: false })}</div>`;
    }
  };
  return {
    body: tabs({ id: 's33-tabs', label: 'Какво искаш да направиш', active: oneOf(String(ctx.query.tab ?? ''), KEYS, KEYS[0]), query: 'tab', cls: 's33-tabs', tabs: ACTIONS.map(a => ({ key: a.key, label: tabLabel(a), body: panel(a) })) })
  };
}

export async function mount(root, ctx) {
  const ix = await getIndex();
  const stop = mountO(root, ctx, ix);
  return () => { if (stop) stop(); };
}
