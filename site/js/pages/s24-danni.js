// S24 · Откъде са данните? · #/danni/:set? · next S25, S01 · periods none
// The catalogue of every dataset of the site (data/catalog.json): source, period, date, format and size of each one, the traps of reading budget data
// („Капаните“), the methodology, the primary sources and the primary files with their SHA-256. #/danni/<набор> is the passport of ONE set: where it
// comes from, how to download it, how to cite it, which traps and notes belong to it.
// The filters (?status= ?ekran= ?izvor= ?q=) hide rows in place: the list is drawn once and mount() only toggles [hidden], so typing never loses the
// caret and the glossary links of the first render stay. render() and mount() share listState(), so a deep link draws the right rows at once.
// All catalogue logic (model, filters, citation, rich text) is in ../catalog.js: one page module never imports another (DEV_GUIDE §17.6).
import { html, raw } from '../html.js';
import { absolute } from '../loc.js';
import { siteUrl, orgRef } from '../seo.js';
import { date, num, plural } from '../format.js';
import { href, byKey } from '../routes.js';
import { icon } from '../icons.js';
import { data } from '../data.js';
import { callout, facts, ext, reportLink } from '../ui/cards.js';
import { chips } from '../ui/chips.js';
import { disclosure } from '../ui/disclosure.js';
import { field, selectInput } from '../ui/forms.js';
import { pendingState, emptyState } from '../ui/states.js';
import { STATUS, statusPill } from '../ui/status.js';
import { srcShort } from '../ui/source.js';
import * as share from '../share.js';
import * as C from '../catalog.js';

export const needs = ['catalog', 'core?'];
export const styles = ['s24-danni'];

/* ---------------------------------------------------------------- small helpers */
const modelOf = ctx => C.model(ctx.data.catalog, ctx.core?.sources);
const slugOf = ctx => String(ctx.params?.set ?? '').trim().toLowerCase();    // the router keeps the case of the address
const uniq = a => [...new Set(a)];
const SEP = html`<span class="sep" aria-hidden="true">|</span>`;
const withSep = parts => html`${parts.filter(Boolean).map((p, i) => (i ? html`${SEP}${p}` : p))}`;
const dot = parts => parts.filter(Boolean).join(' · ');
const joinList = (items, sep = ', ') => html`${items.map((x, i) => html`${i ? sep : ''}${x}`)}`;
const metaList = rows => html`<dl class="s24-meta">${rows.filter(r => r && r.v != null && r.v !== '' && r.v !== false).map(r => html`<div class="s24-m${r.wide ? ' s24-m-wide' : ''}"><dt>${r.k}</dt><dd>${r.v}</dd></div>`)}</dl>`;
const pageUrl = addr => absolute(addr);
const httpText = code => (code === 403 ? 'отказан достъп (403)' : code === 404 ? 'не е намерен (404)' : code === 200 ? 'отговаря (200)' : code ? `отговор ${code}` : '');

const ADJ = { real: ['официален', 'официални'], partial: ['частичен', 'частични'], forecast: ['прогнозен', 'прогнозни'], mock: ['примерен', 'примерни'], pending: ['предстоящ', 'предстоящи'] };
const bgList = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} и ${a[a.length - 1]}`);
/** '22 официални, 7 примерни и 7 предстоящи' */
const breakdown = M => bgList(C.STATUSES.filter(st => M.counts[st] > 0).map(st => `${num(M.counts[st], 0)} ${ADJ[st][M.counts[st] === 1 ? 0 : 1]}`));
const countText = L => `Показани: ${num(L.n, 0)} от ${plural(L.total, 'набор', 'набора')}`;

const pubOf = s => s.publisher.replace(/;\s*/g, ', ');
const publishers = (set, M) => uniq(set.source.map(k => pubOf(M.src(k))).filter(Boolean)).join(', ');
const isMulti = set => !set.file && set.parts.length > 0;
const fmtOf = set => set.format || set.ext.toUpperCase();
const fileInfo = set => [fmtOf(set), isMulti(set) ? plural(set.parts.length, 'файл', 'файла') : '', C.sizeLabel(set.bytes)].filter(Boolean).join(' · ');
const groupOf = (M, set) => M.groups.find(g => g.sets.includes(set));
const srcShortLink = (k, M) => { const s = M.src(k); return s.url ? ext(s.url, srcShort(k)) : srcShort(k); };
const screenLinks = set => joinList(set.screenRoutes.map(r => html`<a href="${href(r.key)}">${r.title}</a>`));

/** a section: the h2 carries the id (the target of ?to= and of the share block), so a jump lands on a heading */
function block(id, title, build, o = {}) {
  let body;
  try { body = build(); } catch (e) { console.error(`S24 ${id}`, e); body = html`<p class="muted">Този раздел не може да се покаже.</p>`; }
  return html`<section class="s24-block"${o.scan ? raw(' data-gl-scan') : ''} aria-labelledby="${id}">
    <div class="s24-head"><h2 id="${id}" tabindex="-1">${title}</h2>${o.tools || ''}</div>
    ${body}
    ${o.foot ? html`<p class="s24-foot">${o.foot}</p>` : ''}</section>`;
}

/* ---------------------------------------------------------------- the list: state shared by render() and mount() */
const FILTER_KEYS = ['status', 'ekran', 'izvor', 'q'];
const filterQuery = f => Object.fromEntries(FILTER_KEYS.map(k => [k, f[k] || null]));
const tocHref = (id, f) => href('danni', {}, { ...filterQuery(f), to: id });

/** which rows are shown, how many per group, and the counts of the status chips (a chip counts with the other filters on, its own left out) */
function listState(M, f) {
  const vis = new Set(), statusN = {};
  let allN = 0;
  for (const s of M.sets) {
    if (C.passes(s, f)) vis.add(s.slug);
    if (C.passes(s, f, ['status'])) { allN++; statusN[s.status] = (statusN[s.status] || 0) + 1; }
  }
  const groups = M.groups.map(g => ({ id: g.id, n: g.sets.filter(s => vis.has(s.slug)).length, total: g.sets.length }));
  return { vis, groups, statusN, allN, n: vis.size, total: M.sets.length };
}

const SECTIONS = [
  { id: 's24-sets', toc: 'Наборите' },
  { id: 's24-traps', toc: 'Капаните' },
  { id: 's24-method', toc: 'Методиката' },
  { id: 's24-sources', toc: 'Източниците' },
  { id: 's24-files', toc: 'Файловете' }
];

/* ---------------------------------------------------------------- one row of the list */
function srcCell(set, M, keys) {
  const shown = keys.slice(0, 2).map(k => srcShortLink(k, M));
  const more = keys.length - shown.length;
  return html`${joinList(shown)}${more > 0 ? html` <a href="${href('danni', { set: set.slug })}" aria-label="и още ${num(more, 0)}: всички източници на „${set.title}“">и още ${num(more, 0)}</a>` : ''}`;
}

function rowMeta(set, M) {
  if (set.status === 'pending') {
    return [{ k: 'Откъде ще дойдат', v: set.expected || publishers(set, M) }, { k: 'Засяга', v: set.screenRoutes.length ? screenLinks(set) : '' }];
  }
  const real = set.source.filter(k => k !== 'mockgen');
  return [
    set.mock ? { k: 'Източник', v: 'Няма: стойностите са измислени', wide: true } : { k: set.source.length > 1 ? 'Източници' : 'Източник', v: set.source.length ? srcCell(set, M, set.source) : '', wide: true },
    set.mock && real.length ? { k: 'Свързан с данни от', v: srcCell(set, M, real), wide: true } : null,
    { k: 'Период', v: C.periodLabel(set.period) },
    { k: set.mock ? 'Създадени на' : 'Данни към', v: set.asOf ? date(set.asOf) : '' },
    { k: 'Единица', v: set.unit },
    { k: 'Формат', v: fileInfo(set) }
  ];
}

function rowGet(set) {
  if (set.status === 'pending') return '';
  if (set.file) {
    return html`<a class="btn btn-sm s24-get" href="${set.file}" download="${C.dlName(set)}">${icon('download', { size: 16 })}<span>Свали ${fmtOf(set)}</span><span class="sr-only"> – ${set.title}</span></a>`;
  }
  if (isMulti(set)) {
    return html`<a class="btn btn-sm s24-get" href="${href('danni', { set: set.slug }, { to: 's24-d-get' })}">${icon('download', { size: 16 })}<span>Виж и свали ${plural(set.parts.length, 'файл', 'файла')}</span><span class="sr-only"> – ${set.title}</span></a>`;
  }
  return '';
}

function row(set, M, shown) {
  return html`<li class="s24-row" data-slug="${set.slug}" data-st="${set.status}"${shown ? '' : raw(' hidden')}>
    <div class="s24-row-top"><a class="s24-link" href="${href('danni', { set: set.slug })}">${set.title}</a>${statusPill(set.status)}</div>
    ${set.desc ? html`<p class="s24-row-desc">${C.rich(set.desc, M)}</p>` : ''}
    ${metaList(rowMeta(set, M))}
    ${rowGet(set)}</li>`;
}

/* ---------------------------------------------------------------- the list: filters, groups, sections */
function filterBar(M, f, L) {
  const screens = [{ value: '', label: 'Всички екрани' }, ...M.screens.map(s => ({ value: s.key, label: s.title }))];
  const sources = [{ value: '', label: 'Всички' }, ...M.sourceKeys.map(k => ({ value: k, label: srcShort(k) }))];
  const items = [
    { label: 'Всички', count: L.allN, query: 'status=', pressed: !f.status },
    ...C.STATUSES.filter(st => M.counts[st] > 0).map(st => ({ label: STATUS[st].label, count: L.statusN[st] || 0, query: `status=${st}`, pressed: f.status === st }))
  ];
  const search = html`<div class="s24-wrap"><span class="s24-ic" aria-hidden="true">${icon('search', { size: 20 })}</span>
    <input class="input s24-q" id="s24-q" name="q" type="search" value="${f.q}" maxlength="80" aria-describedby="s24-q-hint" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
    <button type="button" class="icon-btn s24-clear" aria-label="Изчисти търсенето"${f.q ? '' : raw(' hidden')}>${icon('x', { size: 18 })}</button></div>`;
  return html`<div class="s24-find" role="search" aria-label="Филтри на наборите" data-gl-skip>
    ${field({ id: 's24-q', label: 'Търси набор', hint: 'По име, източник, екран, период или формат: например „дълг“, „КФП“ или „JSON“.', control: search })}
    <div class="s24-selects">
      ${field({ id: 's24-ekran', label: 'Екран', hint: 'Наборите, от които екранът взема числата.', control: selectInput({ id: 's24-ekran', name: 'ekran', query: 'ekran', hint: true, value: f.ekran, options: screens }) })}
      ${field({ id: 's24-izvor', label: 'Източник', hint: 'Кой е издал данните.', control: selectInput({ id: 's24-izvor', name: 'izvor', query: 'izvor', hint: true, value: f.izvor, options: sources }) })}
    </div>
    <div class="s24-status"><span class="field-label" aria-hidden="true">Статус</span>${chips({ label: 'Статус на данните', items })}
      <button type="button" class="link-btn" data-action="legend">Какво означават статусите?</button></div></div>`;
}

const countLine = (f, L) => html`<p class="s24-count" data-gl-skip><span data-count>${countText(L)}</span><button type="button" class="link-btn" data-s24-reset${f.active ? '' : raw(' hidden')}>Изчисти филтрите</button></p>`;

const emptyBox = L => html`<div class="s24-empty"${L.n ? raw(' hidden') : ''}>${emptyState({
  title: 'Няма набор, който да отговаря на филтрите', text: 'Опитай с по-малко филтри или с друга дума.',
  action: { label: 'Изчисти филтрите', href: href('danni', {}, { to: 's24-sets' }) }
})}</div>`;

const groupsView = (M, L) => M.groups.map(g => {
  const gs = L.groups.find(x => x.id === g.id) || { n: 0 };
  return html`<div class="s24-group" data-group="${g.id}"${gs.n ? '' : raw(' hidden')}>
    <h3 class="s24-gh"><span>${g.label}</span><span class="s24-n"><span data-n>${num(gs.n, 0)}</span><span class="sr-only" data-n-unit> ${gs.n === 1 ? 'набор' : 'набора'}</span></span></h3>
    <ul class="s24-list" role="list">${g.sets.map(s => row(s, M, L.vis.has(s.slug)))}</ul></div>`;
});

/** the rows on screen as a table: the CSV of „Сподели“ and of „Свали показаното“ is the filtered view */
function catalogTable(M) {
  const sets = [...document.querySelectorAll('li.s24-row')].filter(li => !li.hidden).map(li => M.bySlug.get(li.dataset.slug)).filter(Boolean);
  return {
    columns: ['Набор', 'Мерна единица', 'Период', 'Данни към', 'Файл', 'Първичен източник'],
    rows: sets.map(s => [s.title, s.unit, C.periodLabel(s.period), s.asOf ? date(s.asOf) : '', s.file || s.template, s.mock ? 'Няма (примерни данни)' : s.source.map(srcShort).join('; ')]),
    statuses: sets.map(s => s.status)
  };
}

function setsSection(M, f, L) {
  share.register('s24-sets', {
    title: 'Каталог на наборите данни',
    text: `Каталогът на „Бюджет на светло“ описва ${plural(M.counts.datasets, 'набор данни', 'набора данни')}: ${breakdown(M)}.`,
    source: ['wg'], asOf: M.meta.asOf || undefined, status: 'real', table: () => catalogTable(M)
  });
  return block('s24-sets', 'Наборите данни', () => html`
    <p class="s24-lead">Каталогът описва <strong>${plural(M.counts.datasets, 'набор данни', 'набора данни')}</strong>: ${breakdown(M)}. До всеки набор са източникът, периодът, датата на данните, форматът и размерът. Как се четат файловете с код е в <a href="${href('api')}">${byKey.api?.title || 'Отворени данни и API'}</a>.</p>
    <p class="s24-dl"><a class="btn btn-sm" href="data/catalog.json" download="catalog.json">${icon('download', { size: 16 })}<span>Свали каталога (JSON)</span></a>
      <button type="button" class="btn btn-sm" data-s24-csv>${icon('table', { size: 16 })}<span>Свали показаното (CSV)</span></button></p>
    ${filterBar(M, f, L)}
    ${countLine(f, L)}
    ${emptyBox(L)}
    <div class="s24-groups">${groupsView(M, L)}</div>`,
  { scan: true, tools: share.shareButton('s24-sets'), foot: reportLink({ block: 's24-sets' }) });
}

/* ---------------------------------------------------------------- traps, methodology, sources, files */
/** one trap or methodology item (kind 't' | 'm'): its paragraphs, the sets it concerns, and for a trap that has evidence how it was checked */
function item(kind, it, M, extra) {
  const rel = it.related.length
    ? html`<div class="s24-rel"><p class="s24-rel-l">Засяга</p><ul class="s24-rel-list" role="list">${it.related.map(s => html`<li><a href="${href('danni', { set: s.slug })}">${s.title}</a></li>`)}</ul></div>` : '';
  const ev = it.evidence.length
    ? disclosure({
      id: `s24-evidence-${C.idPart(it.id)}`, title: 'Как го проверихме', meta: plural(it.evidence.length, 'адрес', 'адреса'),
      body: html`<p class="small muted">Опитахме да отворим тези адреси автоматично. Така отговориха сървърите.</p>
        <ul class="s24-ev" role="list">${it.evidence.map(e => html`<li>${ext(e.url, e.url.replace(/^https?:\/\//i, ''))}<span class="s24-ev-s">${dot([httpText(e.status), e.checked ? `проверено на ${date(e.checked)}` : ''])}</span></li>`)}</ul>`
    }) : '';
  return html`<article class="s24-item" data-id="${it.id}"><h3 class="s24-h3" id="s24-${kind}-${C.idPart(it.id)}" tabindex="-1">${it.title}</h3>
    ${it.paras.map(p => html`<p>${C.rich(p, M)}</p>`)}${extra || ''}${rel}${ev}</article>`;
}

/** where a methodology item can be seen on a screen of the site (by the id the catalogue gives it) */
function seenOn(id) {
  const key = { calculator: 'danaci', 'cash-accrual': 'izpalnenie', vintages: 'prognoza' }[id];
  if (key && byKey[key]) return html`<p class="s24-seen">Къде се вижда: <a href="${href(key)}">${byKey[key].title}</a></p>`;
  if (id === 'statuses') return html`<p class="s24-seen"><button type="button" class="link-btn" data-action="legend">Покажи легендата на статусите</button></p>`;
  return '';
}

const trapsSection = M => block('s24-traps', 'Капани: на какво да внимаваш', () => html`
  <p class="s24-lead2">Бюджетните числа лесно се четат погрешно. Ето къде най-често се греши и как да го избегнеш.</p>
  <div class="s24-items">${M.traps.map(t => item('t', t, M))}</div>`, { scan: true, foot: reportLink({ block: 's24-traps' }) });

const methodSection = M => block('s24-method', 'Методика', () => html`
  <p class="s24-lead2">Правилата, по които подреждаме и показваме числата.</p>
  <div class="s24-items">${M.methods.map(t => item('m', t, M, seenOn(t.id)))}</div>`, { scan: true, foot: reportLink({ block: 's24-method' }) });

function srcItem(k, M) {
  const s = M.src(k);
  const n = M.sets.filter(x => x.source.includes(k)).length;
  const meta = dot([pubOf(s), C.kindLabel(s.kind), C.accessLabel(s.access, !!s.url)]);
  return html`<li class="s24-src"><h3 class="s24-h3">${s.url ? ext(s.url, s.title) : s.title}</h3>
    ${meta ? html`<p class="s24-src-m">${meta}</p>` : ''}${s.note ? html`<p>${C.rich(s.note, M)}</p>` : ''}
    <p><a href="${href('danni', {}, { izvor: k, to: 's24-sets' })}">${plural(n, 'набор', 'набора')} от този източник</a></p></li>`;
}

const sourcesSection = M => block('s24-sources', 'Първични източници', () => html`
  <p class="s24-lead2">Всяко число идва от първичен източник. Тук са източниците, които ползва поне един набор.</p>
  <ul class="s24-srclist" role="list">${M.sourceKeys.map(k => srcItem(k, M))}</ul>`, { foot: reportLink({ block: 's24-sources' }) });

function fileItem(f, M) {
  const title = f.url ? ext(f.url, f.title) : f.page ? html`${f.title} · ${ext(f.page, 'страница на издателя')}` : f.title;
  return html`<li class="s24-file"><p class="s24-file-t">${title}</p>${metaList([
    { k: 'Файл', v: html`<code>${f.name}</code>${f.bytes != null ? ` · ${C.sizeLabel(f.bytes)}` : ''}` },
    { k: 'Изтеглен на', v: f.retrieved ? date(f.retrieved) : '' },
    { k: f.source.length > 1 ? 'Източници' : 'Източник', v: f.source.length ? joinList(f.source.map(k => srcShortLink(k, M))) : '' },
    { k: 'Ползва се в', v: f.usedBy.length ? joinList(f.usedBy.map(s => html`<a href="${href('danni', { set: s.slug })}">${s.title}</a>`)) : '' },
    { k: 'Контролна сума SHA-256', v: f.sha256 ? html`<code class="s24-sha">${f.sha256}</code>` : '' },
    { k: 'Бележка', v: f.note }
  ])}</li>`;
}

const filesList = (files, M, id) => disclosure({
  id, title: 'Списък на първичните файлове', meta: plural(files.length, 'файл', 'файла'),
  body: html`<ul class="s24-files" role="list">${files.map(f => fileItem(f, M))}</ul>`
});

const filesSection = M => block('s24-files', 'Първични файлове и контролни суми', () => html`
  <p class="s24-lead2">За всеки първичен файл записваме откъде е изтеглен, кога и контролна сума SHA-256 (отпечатък на файла). Ако свалиш същия файл от издателя и сумата съвпадне, това е файлът, от който са прочетени числата.</p>
  ${filesList(M.files, M, 's24-files-list')}`, { foot: reportLink({ block: 's24-files' }) });

/* ---------------------------------------------------------------- the list view */
function listView(ctx, M) {
  if (!M.sets.length) return emptyState({ title: 'Каталогът е празен', text: 'Не намерихме нито един набор в каталога. Опитай пак по-късно.', icon: 'database' });
  const f = C.readFilter(ctx.query, M);
  const L = listState(M, f);
  const build = ctx.core?.build || {};
  const ctxParts = [
    build.dataVersion && html`<span>Версия на данните <strong>${build.dataVersion}</strong></span>`,
    build.kfpLatest && html`<span>Изпълнението на бюджета е към <strong>${date(build.kfpLatest)}</strong></span>`,
    M.meta.asOf && html`<span>Каталогът е към <strong>${date(M.meta.asOf)}</strong></span>`
  ].filter(Boolean);
  const present = { 's24-sets': true, 's24-traps': M.traps.length > 0, 's24-method': M.methods.length > 0, 's24-sources': M.sourceKeys.length > 0, 's24-files': M.files.length > 0 };
  const toc = html`<nav class="s24-toc" aria-label="На тази страница"><ul class="chips s24-toc-list">${SECTIONS.filter(s => present[s.id]).map(s => html`<li><a class="chip" data-to="${s.id}" href="${tocHref(s.id, f)}">${s.toc}</a></li>`)}</ul></nav>`;
  const how = html`<div data-gl-scan>${callout({
    kind: 'info', title: 'Как да цитираш число от портала',
    body: html`<p>Когато цитираш число, посочи:</p>
      <ul><li>набора и първичния източник, не този портал;</li>
        <li>обхвата: какво точно е включено (виж „Капани“ по-долу);</li>
        <li>статуса на данните и датата, към която са.</li></ul>
      <p>На страницата на всеки набор има готово цитиране. За число от екран натисни „Сподели“: копираният текст носи източника и връзка към числото.</p>`
  })}</div>`;
  return {
    context: ctxParts.length ? withSep(ctxParts) : undefined,
    body: html`${toc}${how}${setsSection(M, f, L)}${present['s24-traps'] ? trapsSection(M) : ''}${present['s24-method'] ? methodSection(M) : ''}${present['s24-sources'] ? sourcesSection(M) : ''}${present['s24-files'] ? filesSection(M) : ''}`
  };
}

/* ---------------------------------------------------------------- the detail view: the passport of one set */
async function ministryNames(ctx) {
  try {
    const m = await data.load('ministries', { signal: ctx.signal });
    return new Map((Array.isArray(m?.items) ? m.items : []).filter(x => x && x.id != null).map(x => [String(x.id), String(x.short || x.name || x.id)]));
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return new Map();
  }
}

const srcBlock = (keys, M) => html`<ul class="s24-srcs" role="list">${keys.map(k => {
  const s = M.src(k);
  const meta = dot([pubOf(s), C.kindLabel(s.kind), C.accessLabel(s.access, !!s.url)]);
  return html`<li><span class="s24-srcs-t">${s.url ? ext(s.url, s.title) : s.title}</span>${meta ? html`<span class="s24-srcs-m">${meta}</span>` : ''}${s.note ? html`<span class="s24-srcs-n">${C.rich(s.note, M)}</span>` : ''}</li>`;
})}</ul>`;

function passportRows(set, M) {
  const pend = set.status === 'pending';
  const real = set.mock ? set.source.filter(k => k !== 'mockgen') : set.source;
  const screens = set.screenRoutes.length ? { k: pend ? 'Засяга' : 'Къде се ползва', v: set.screenRoutes.length > 8
    ? disclosure({ id: 's24-d-screens', title: 'Екрани', meta: plural(set.screenRoutes.length, 'екран', 'екрана'), body: chips({ items: set.screenRoutes.map(r => ({ label: r.title, href: href(r.key) })) }) })
    : chips({ label: 'Екрани, които ползват набора', items: set.screenRoutes.map(r => ({ label: r.title, href: href(r.key) })) }) } : null;
  return [
    { k: 'Статус', v: html`<span class="s24-st">${statusPill(set.status)}<span>${(STATUS[set.status] || STATUS.pending).text}</span></span>` },
    set.mock ? { k: 'Откъде са стойностите', v: 'Няма източник: стойностите са примерни, измислени за показване.' } : null,
    real.length ? { k: pend ? 'Откъде ще дойдат' : set.mock ? 'Свързан с официални данни от' : real.length > 1 ? 'Източници' : 'Източник', v: srcBlock(real, M) } : null,
    pend && set.expected ? { k: 'Къде да ги видиш', v: set.expected } : null,
    { k: 'Период', v: C.periodLabel(set.period) },
    { k: set.mock ? 'Създадени на' : 'Данни към', v: set.asOf ? date(set.asOf) : '' },
    { k: 'Мерна единица', v: set.unit },
    pend ? null : { k: 'Формат', v: fileInfo(set) },
    set.file ? { k: 'Файл', v: html`<code>${set.file}</code>` } : set.template ? { k: 'Файлове', v: html`<code>${set.template}</code>` } : null,
    screens
  ];
}

const FORMAT_HINT = {
  json: 'Файлът е JSON: чете се от всеки език за програмиране и от повечето програми за таблици.',
  rss: 'Файлът е RSS: канал за новини, който се чете от програми за следене на новини.',
  geojson: 'Файлът е GeoJSON: контури за карти, които четат програмите за карти и езиците за програмиране.'
};

function getBlock(set, M, names) {
  const api = href('api');
  const common = html`<p class="small muted">Таблица (CSV) от конкретен екран получаваш с „Сподели“ до таблицата, където я има. Условията за повторно ползване още не са решени: виж <a href="${api}">${byKey.api?.title || 'Отворени данни и API'}</a>.</p>`;
  if (set.file) {
    const size = C.sizeLabel(set.bytes);
    return html`<p class="s24-dl"><a class="btn btn-primary" href="${set.file}" download="${C.dlName(set)}">${icon('download', { size: 18 })}<span>Свали ${fmtOf(set)}${size ? ` (${size})` : ''}</span></a>
      <button type="button" class="btn" data-s24-copy-from="s24-addr">${icon('copy', { size: 16 })}<span>Копирай адреса</span></button>
      <a class="btn" href="${href('api', {}, { set: set.slug, to: 's25-read' })}">${icon('code', { size: 16 })}<span>Как да го четеш с код</span></a></p>
      <p class="s24-addr"><span class="s24-addr-l">Адрес на файла</span><code id="s24-addr">${C.fileUrl(set.file)}</code></p>
      ${FORMAT_HINT[fmtOf(set).toLowerCase()] ? html`<p class="small muted">${FORMAT_HINT[fmtOf(set).toLowerCase()]}</p>` : ''}${common}`;
  }
  if (isMulti(set)) {
    return html`<p>Този набор е разделен на ${plural(set.parts.length, 'файл', 'файла')}, по един за ведомство. Адресът на всеки има вида <code>${set.template || 'data/…'}</code>.</p>
      <p class="s24-dl"><a class="btn" href="${href('api', {}, { set: set.slug, to: 's25-read' })}">${icon('code', { size: 16 })}<span>Как да го четеш с код</span></a></p>
      ${disclosure({
        id: 's24-d-parts', title: 'Файловете по ведомства', meta: plural(set.parts.length, 'файл', 'файла'),
        body: html`<ul class="s24-parts" role="list">${set.parts.map(p => {
          const n = names.get(p.code) || (p.code ? `Ведомство ${p.code}` : C.dlName(set, p));
          return html`<li class="s24-part"><span class="s24-part-n">${p.code ? html`<a href="${href('vedomstvo', { code: p.code })}">${n}</a>` : n}</span><span class="s24-part-s">${C.sizeLabel(p.bytes)}</span>
            <a class="btn btn-sm" href="${p.file}" download="${C.dlName(set, p)}">${icon('download', { size: 16 })}<span>Свали</span><span class="sr-only"> ${n}</span></a></li>`;
        })}</ul>`
      })}${common}`;
  }
  return common;
}

function notesBlock(set, M, meta) {
  const parts = [];
  if (meta && typeof meta.sourceNote === 'string' && meta.sourceNote.trim()) parts.push(html`<p>${C.rich(meta.sourceNote.trim(), M)}</p>`);
  const waiting = uniq([...set.pending, ...(Array.isArray(meta?.pending) ? meta.pending.filter(x => typeof x === 'string') : [])]).map(id => M.find(id)).filter(Boolean);
  if (waiting.length) {
    parts.push(html`<p>Какво още липсва за този набор:</p><ul class="s24-wait">${uniq(waiting).map(w => html`<li><a href="${href('danni', { set: w.slug })}">${w.title}</a></li>`)}</ul>`);
  }
  return parts.length ? html`${parts}` : null;
}

async function detailView(ctx, M, set) {
  const { meta } = await C.loadMeta(set, { signal: ctx.signal });
  const names = isMulti(set) ? await ministryNames(ctx) : new Map();
  const pend = set.status === 'pending';
  const grp = groupOf(M, set);
  const notice = meta && typeof (meta.notice || meta.why) === 'string' ? String(meta.notice || meta.why).trim() : '';
  const citeText = pend || set.mock ? '' : C.citation(set, M, { url: pageUrl(href('danni', { set: set.slug })), version: ctx.core?.build?.dataVersion });
  const traps = C.relatedTo(M.traps, set), methods = C.relatedTo(M.methods, set), files = C.filesOf(M, set);
  const notes = notesBlock(set, M, meta);

  if (!pend) {
    share.register('s24-d-card', { title: set.title, text: set.desc || set.title, source: set.source, asOf: set.asOf || undefined, status: set.status, mock: set.mock });
  }

  const sections = [];
  if (pend) {
    sections.push(pendingState({ title: set.title, text: `Данните съществуват при ${publishers(set, M) || 'издателя'}, но още не са извлечени. Не показваме число, докато няма официални данни.` }));
  } else if (set.mock) {
    sections.push(callout({ kind: 'warn', title: 'Примерни данни: не ги цитирай', body: html`<p>${notice || 'Стойностите са измислени и показват само как ще изглежда екранът.'}</p>` }));
  }
  sections.push(block('s24-d-card', 'Паспорт на набора', () => facts(passportRows(set, M), { cls: 's24-facts' }),
    { scan: true, tools: pend ? '' : share.shareButton('s24-d-card'), foot: reportLink({ block: 's24-d-card', val: set.slug }) }));
  if (!pend) sections.push(block('s24-d-get', 'Свали и ползвай', () => getBlock(set, M, names)));
  if (citeText) {
    sections.push(block('s24-d-cite', 'Как да го цитираш', () => html`<p class="s24-cite" id="s24-cite-text">${citeText}</p>
      <p class="s24-dl"><button type="button" class="btn btn-sm" data-s24-copy-from="s24-cite-text">${icon('copy', { size: 16 })}<span>Копирай цитирането</span></button></p>
      <p class="small muted">Числата са на първичния източник. Порталът ги подрежда и показва статуса и датата им: цитирай и двете.</p>`));
  }
  if (notes) sections.push(block('s24-d-notes', 'Бележки към данните', () => notes, { scan: true }));
  if (traps.length) sections.push(block('s24-d-traps', 'Капани за този набор', () => html`<div class="s24-items">${traps.map(t => item('t', t, M))}</div>`, { scan: true }));
  if (methods.length) sections.push(block('s24-d-method', 'Методика за този набор', () => html`<div class="s24-items">${methods.map(t => item('m', t, M, seenOn(t.id)))}</div>`, { scan: true }));
  if (files.length) {
    sections.push(block('s24-d-files', 'Първични файлове', () => (files.length > 5 ? filesList(files, M, 's24-d-files-list') : html`<ul class="s24-files" role="list">${files.map(f => fileItem(f, M))}</ul>`)));
  }

  return {
    title: set.title,
    lede: set.desc ? C.rich(set.desc, M) : 'Паспорт на набор данни: откъде е, как да го свалиш и как да го цитираш.',
    eyebrow: dot(['Набор данни', grp?.label]),
    context: withSep([statusPill(set.status), set.asOf ? html`<span>${set.mock ? 'Създадени на' : 'Данни към'} <strong>${date(set.asOf)}</strong></span>` : '', set.period ? html`<span>Период <strong>${C.periodLabel(set.period)}</strong></span>` : '']),
    body: html`${sections}`
  };
}

/* ---------------------------------------------------------------- the page contract */
export async function render(ctx) {
  const M = modelOf(ctx);
  const slug = slugOf(ctx);
  if (!slug) return listView(ctx, M);
  const set = M.find(slug);
  if (!set) ctx.notFound();
  return detailView(ctx, M, set);
}

/* JSON-LD (js/seo.js): the list is a DataCatalog of the sets, a set's page is a Dataset with its files, period and official sources, so that
   dataset search engines (Google Dataset Search) and answer engines find the files. Left out: sample (mock) sets, whose values are not
   official (spec 9.3: demo data is not indexed as official numbers), pending sets, which have no file, and the service files of the site
   (core, search index, news feed, the catalog itself), which are not data about the budget. */
const indexable = s => s.status !== 'mock' && !s.mock && s.status !== 'pending' && s.group !== 'service' && (s.file || s.parts.length);
const setUrl = s => siteUrl(`/danni/${encodeURIComponent(s.slug)}`);
const isoPeriod = p => { const m = String(p || '').match(/\b(?:19|20)\d{2}(?:-\d{2})?\b/g); return m ? (m.length > 1 ? `${m[0]}/${m[m.length - 1]}` : m[0]) : undefined; };
const kb = b => (Number.isFinite(b) ? `${Math.max(1, Math.round(b / 1024))} KB` : undefined);
const download = (file, type, bytes) => ({ '@type': 'DataDownload', contentUrl: siteUrl('/' + file), encodingFormat: type || 'application/json', contentSize: kb(bytes) });
function datasetNode(M, s) {
  const files = s.file ? [download(s.file, s.mediaType, s.bytes)] : s.parts.map(p => download(p.file, s.mediaType, p.bytes));
  const sources = uniq(s.source.map(k => M.src(k).url).filter(Boolean));
  return {
    '@type': 'Dataset', '@id': setUrl(s) + '#dataset', url: setUrl(s), name: s.title, identifier: s.id || s.slug,
    // dataset search wants 50+ characters: a short description gets the context the page shows around it
    description: (s.desc || s.title).length >= 50 ? s.desc : `${s.desc || s.title} Отворен набор (${s.format || 'JSON'}) за държавния бюджет на България.`,
    inLanguage: 'bg', isAccessibleForFree: true, creator: orgRef(), publisher: orgRef(),
    keywords: uniq(['държавен бюджет', 'България', M.groups.find(g => g.id === s.group)?.label].filter(Boolean)),
    spatialCoverage: { '@type': 'Place', name: 'България' }, temporalCoverage: isoPeriod(s.period),
    dateModified: /^\d{4}-\d{2}-\d{2}/.test(s.asOf) ? s.asOf.slice(0, 10) : undefined,
    isBasedOn: sources.length ? sources : undefined, distribution: files,
    includedInDataCatalog: { '@id': siteUrl('/danni') + '#catalog' }
  };
}
export function schema(ctx) {
  const M = modelOf(ctx), slug = slugOf(ctx);
  if (slug) { const s = M.find(slug); return s && indexable(s) ? [datasetNode(M, s)] : []; }
  return [{
    '@type': 'DataCatalog', '@id': siteUrl('/danni') + '#catalog', url: siteUrl('/danni'), name: 'Наборите с данни на „Бюджет на светло“',
    description: 'Отворените файлове на сайта: държавният бюджет на България, месечното му изпълнение, дългът, ведомствата и общините, с източник, период и статус.',
    inLanguage: 'bg', publisher: orgRef(),
    dataset: M.sets.filter(indexable).map(s => ({ '@type': 'Dataset', '@id': setUrl(s) + '#dataset', name: s.title, url: setUrl(s) }))
  }];
}

export function crumbs(ctx) {
  const slug = slugOf(ctx);
  if (!slug) return null;
  const set = modelOf(ctx).find(slug);
  return set ? [{ label: byKey.danni?.title || 'Откъде са данните?', href: href('danni') }, { label: set.title }] : null;
}

export function next(ctx) {
  const slug = slugOf(ctx);
  const set = slug ? modelOf(ctx).find(slug) : null;
  if (!set) return ['S25', 'S01'];
  const all = { kicker: 'Каталог', title: 'Всички набори данни', text: 'Върни се към списъка и филтрите.', href: href('danni', {}, { to: 's24-sets' }) };
  if (set.status === 'pending') return [all, 'S25', 'S01'];
  return [{ kicker: 'Справка', title: 'Как да ползваш файла', text: 'Адрес, схема, пример и готов код за curl, Python и JavaScript.', href: href('api', {}, { set: set.slug, to: 's25-read' }) }, all, 'S01'];
}

let pendingFocus = '';                                  // the id to focus after the next draw (set by „Изчисти филтрите“, used once by mount)
const COPIED = { 's24-addr': 'Адресът е копиран.', 's24-cite-text': 'Цитирането е копирано.' };      // the toast of each copy button

export function mount(root, ctx) {
  const M = modelOf(ctx);
  let tType = 0, tSay = 0, lastLive = '';
  const input = root.querySelector('#s24-q');
  const clear = root.querySelector('.s24-clear');

  /* the filtered list, in place */
  let q = C.cleanQ(ctx.query.q);
  const rows = [...root.querySelectorAll('li.s24-row')], groups = [...root.querySelectorAll('.s24-group')];
  const countEl = root.querySelector('[data-count]'), resetBtn = root.querySelector('[data-s24-reset]'), emptyEl = root.querySelector('.s24-empty');
  const statusChips = [...root.querySelectorAll('.chip[data-query^="status="]')], tocLinks = [...root.querySelectorAll('a[data-to]')];

  const filterNow = () => {
    const f = { ...C.readFilter(ctx.query, M), q };
    f.active = !!(f.status || f.ekran || f.izvor || f.q);
    return f;
  };
  const paint = f => {
    const L = listState(M, f);
    for (const li of rows) li.hidden = !L.vis.has(li.dataset.slug);
    for (const g of groups) {
      const n = (L.groups.find(x => x.id === g.dataset.group) || { n: 0 }).n;
      g.hidden = n === 0;
      const a = g.querySelector('[data-n]'), u = g.querySelector('[data-n-unit]');
      if (a) a.textContent = num(n, 0);
      if (u) u.textContent = ` ${n === 1 ? 'набор' : 'набора'}`;
    }
    for (const c of statusChips) {
      const key = c.dataset.query.slice('status='.length), el = c.querySelector('.chip-count');
      if (el) el.textContent = num(key ? L.statusN[key] || 0 : L.allN, 0);
    }
    if (countEl) countEl.textContent = countText(L);
    if (emptyEl) emptyEl.hidden = L.n > 0;
    if (resetBtn) resetBtn.hidden = !f.active;
    for (const a of tocLinks) a.setAttribute('href', tocHref(a.dataset.to, f));
    return L;
  };
  const say = (text, delay) => {
    clearTimeout(tSay);
    const go = () => { if (text && text !== lastLive) { lastLive = text; ctx.announce(text); } };
    if (delay) tSay = setTimeout(go, delay); else go();
  };
  const apply = now => {
    clearTimeout(tType);
    clear.hidden = !input.value;
    const nq = C.cleanQ(input.value);
    if (nq !== q) { q = nq; ctx.setQuery({ q: q || null }, { rerender: false }); }
    else if (!now) return;
    say(countText(paint(filterNow())), now ? 0 : 700);
  };

  const onInput = () => { clear.hidden = !input.value; clearTimeout(tType); tType = setTimeout(apply, 140); };
  const onKey = e => {
    if (e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter') { e.preventDefault(); apply(true); }
    else if (e.key === 'Escape' && input.value) { e.preventDefault(); input.value = ''; apply(true); }
  };
  const onClear = () => { input.value = ''; apply(true); input.focus(); };
  if (input && clear) {
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    clear.addEventListener('click', onClear);
    if (ctx.kind === 'rerender') say(countText(listState(M, filterNow())), 0);          // a chip or a select was used: say what is shown now
  }

  /* copy, CSV, reset */
  const onClick = e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    const copy = t.closest('[data-s24-copy-from]');
    if (copy && root.contains(copy)) {
      const text = document.getElementById(copy.dataset.s24CopyFrom)?.textContent.trim();
      if (text) share.copyOrShow(text, COPIED[copy.dataset.s24CopyFrom] || 'Копирано.', 'Копирай ръчно', copy);
      return;
    }
    const csv = t.closest('[data-s24-csv]');
    if (csv && root.contains(csv)) {
      const spec = share.get('s24-sets'), text = spec ? share.csvFor(spec) : '';
      const n = spec ? catalogTable(M).rows.length : 0;
      if (!text || !n) { ctx.announce('Няма показани набори за изтегляне.'); return; }
      share.download(new Blob([text], { type: 'text/csv;charset=utf-8' }), 'bns-danni-s24-sets.csv');
      ctx.announce(`Изтеглен е файл с ${plural(n, 'набор', 'набора')}.`);
      return;
    }
    const reset = t.closest('[data-s24-reset], .s24-empty a.btn');
    if (reset && root.contains(reset)) {
      e.preventDefault();
      pendingFocus = 's24-q';
      ctx.setQuery({ status: '', ekran: '', izvor: '', q: '' });
    }
  };
  root.addEventListener('click', onClick);

  if (pendingFocus) { const el = root.querySelector(`#${pendingFocus}`); pendingFocus = ''; if (el) el.focus(); }

  return () => {
    clearTimeout(tType); clearTimeout(tSay);
    root.removeEventListener('click', onClick);
    if (input && clear) { input.removeEventListener('input', onInput); input.removeEventListener('keydown', onKey); clear.removeEventListener('click', onClear); }
  };
}
