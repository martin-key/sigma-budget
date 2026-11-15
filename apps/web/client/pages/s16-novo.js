// S16 Какво ново? (G3). What changed lately in the data and in the law: the latest monthly report in five sentences, a month-by-month
// chronology of events and the RSS file that follows them in a reader (RSS is the only subscription channel).
// Every number and every event comes from feed.json (built by the data pipeline from the other data sets); nothing is typed from memory.
// The visitor filters the chronology in the query: ?vid=report|law|plenary|rates|eurostat|data (none = all events).
import { html, plain } from '../html.js';
import { ROOT } from '../loc.js';
import { pct, date, monthName, plural, NBSP } from '../format.js';
import { copyOrShow } from '../share.js';
import { block } from '../ui/block.js';
import { ext } from '../ui/cards.js';
import { chips } from '../ui/chips.js';
import { timeline } from '../ui/timeline.js';
import { emptyState } from '../ui/states.js';
import { gl } from '../ui/gl.js';
import { amount } from '../view.js';

/* ------------------------------------------------------------------ small helpers */
const fin = (v) => typeof v === 'number' && Number.isFinite(v);
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
/** the data text is kept as it is in the file; a doubled full stop after an abbreviation („г..“) is tidied only when it is shown */
const tidy = (s) =>
  String(s ?? '')
    .replace(/([^.\s])\.\.(?!\.)/g, '$1.')
    .trim();
const monthTitle = (key) => {
  const [y, m] = key.split('-');
  return `${cap(monthName(+m))} ${y}`;
};

/* ------------------------------------------------------------------ the model: what the screen prints, derived once */
export function model(ctx) {
  const f = ctx.data.feed || {};
  const events = (Array.isArray(f.events) ? f.events : []).filter(
    (e) =>
      e &&
      e.status !== 'pending' &&
      e.dateKind !== 'announced' &&
      e.title &&
      /^\d{4}-\d{2}-\d{2}$/.test(e.date || ''),
  );
  events.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first; the file's order stays within one day
  const kinds = (Array.isArray(f.kinds) ? f.kinds : []).filter((k) => k && k.id && k.label);
  const label = new Map(kinds.map((k) => [k.id, k.label]));
  const counts = new Map();
  for (const e of events) counts.set(e.kind, (counts.get(e.kind) || 0) + 1);
  const want = ctx.query && ctx.query.vid;
  const vid = counts.has(want) ? want : '';
  const shown = vid ? events.filter((e) => e.kind === vid) : events;
  return {
    ctx,
    f,
    meta: f.meta || {},
    h: f.highlights && f.highlights.asOf ? f.highlights : null,
    events,
    kinds,
    label,
    counts,
    vid,
    shown,
  };
}

/* ------------------------------------------------------------------ the five sentences of the latest monthly report */
const yoyText = (yoy) => {
  if (!fin(yoy)) return '';
  if (Math.abs(yoy) < 0.05) return ' — колкото година по-рано';
  return ` — с ${pct(Math.abs(yoy), 1)} ${yoy > 0 ? 'повече' : 'по-малко'} от година по-рано`;
};

export function fiveSentences(M) {
  const { ctx, h } = M;
  if (!h) return [];
  const A = (mln) => amount(ctx, { mln });
  const out = [];
  if (fin(h.revenueMln))
    out.push(html`Приходите са ${A(h.revenueMln)}${yoyText(h.revenueYoyPct)}.`);
  if (fin(h.expenditureMln))
    out.push(
      html`Разходите (с вноската в бюджета на ЕС) са ${A(h.expenditureMln)}${yoyText(h.expenditureYoyPct)}.`,
    );
  if (fin(h.deficitMln)) {
    const surplus = h.deficitMln < 0;
    const term = surplus
      ? gl('byudzheten-izlishak', 'Излишъкът')
      : gl('byudzheten-defitsit', 'Дефицитът');
    const p = h.deficitPrevYearMln;
    let prev = '';
    if (fin(p))
      prev =
        p < 0 === surplus
          ? html`, при ${A(Math.abs(p))} година по-рано`
          : html`, при ${p < 0 ? 'излишък' : 'дефицит'} от ${A(Math.abs(p))} година по-рано`;
    out.push(html`${term} е ${A(Math.abs(h.deficitMln))}${prev}.`);
  }
  if (fin(h.capexPctPlan))
    out.push(
      html`${gl('kapitalovi-razhodi', 'Капиталовите разходи')} са ${pct(h.capexPctPlan, 1)} от годишния план.${h.planBasis?.citation ? html` ${h.planBasis.citation}.` : ''}`,
    );
  if (fin(h.newBorrowingMln)) {
    const p = h.newBorrowingPrevYearMln;
    out.push(
      html`Новите заеми от международните капиталови пазари (нето) са ${A(h.newBorrowingMln)}${fin(p) ? html`, при ${A(p)} година по-рано` : ''}.`,
    );
  }
  return out;
}

export function summaryBlock(M) {
  const { ctx, h } = M;
  const items = fiveSentences(M);
  if (!h || !items.length) return '';
  const y = +h.asOf.slice(0, 4),
    m = h.month || +h.asOf.slice(5, 7);
  const title =
    items.length === 5
      ? `${cap(monthName(m))} ${y} в пет изречения`
      : `${cap(monthName(m))} ${y} накратко`;
  const sub = html`Данните са от 1 януари до ${date(h.asOf, true)} г. и са за консолидираната фискална програма (${gl('kfp', 'КФП')}). Сравнението е със същия период на ${y - 1} г.`;
  const body = html`<ol class="s16-five">${items.map((t) => html`<li>${t}</li>`)}</ol>
    <p class="s16-more"><a href="${ctx.href('S15')}">Всички числа и графики: „Месечни отчети“</a></p>`;
  const share = { text: items.map(plain).join(' ') };
  return block({
    id: 's16-b-summary',
    level: 2,
    title,
    sub,
    scope: 'kfp',
    status: 'real',
    source: ['kfp', ...(h.planBasis?.source || [])],
    asOf: h.asOf,
    share,
    body,
  });
}

/* ------------------------------------------------------------------ the chronology */
function dateLine(M, e) {
  const kinds = M.f.dateKinds || {};
  const pre =
    e.dateKind && e.dateKind !== 'occurred' && kinds[e.dateKind] ? `${kinds[e.dateKind]} ` : '';
  const span = e.dateTo && e.dateTo !== e.date ? `${NBSP}–${NBSP}${date(e.dateTo)}` : '';
  const kind = M.label.get(e.kind);
  return `${pre}${date(e.date)}${span}${kind ? ` · ${kind}` : ''}`;
}

const eventItem = (M) => (e) => ({
  id: `s16-e-${e.id}`,
  kind: 'event',
  date: dateLine(M, e),
  title: tidy(e.title),
  href: typeof e.href === 'string' && e.href.startsWith('#/') ? e.href : undefined,
  text: e.text ? tidy(e.text) : undefined,
});

export function shownNote(M) {
  return M.vid
    ? `Показани са ${M.shown.length} от ${plural(M.events.length, 'събитие', 'събития')}. Вид: ${M.label.get(M.vid)}.`
    : '';
}

const GROUP_FROM = 8; // more shown events than this are grouped by month

export function feedBlock(M) {
  const { meta, events, shown } = M;
  if (!events.length) {
    return block({
      id: 's16-b-feed',
      level: 2,
      title: 'Хронология на събитията',
      status: 'real',
      body: emptyState({
        title: 'Още няма събития',
        text: 'Когато излезе нов отчет или има промяна в закона, тя ще се покаже тук.',
      }),
    });
  }
  const chipItems = [
    { label: 'Всички', count: events.length, query: 'vid=', pressed: !M.vid },
  ].concat(
    M.kinds
      .filter((k) => M.counts.get(k.id))
      .map((k) => ({
        label: k.label,
        count: M.counts.get(k.id),
        query: `vid=${k.id}`,
        pressed: M.vid === k.id,
      })),
  );
  const groups = [];
  for (const e of shown) {
    const key = e.date.slice(0, 7);
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, items: [] };
      groups.push(g);
    }
    g.items.push(e);
  }
  const note = shownNote(M);
  // many events are told month by month; a short filtered list (one report a month, a handful of votes) reads better as one list
  const list =
    shown.length > GROUP_FROM
      ? html`<div class="s16-groups">${groups.map(
          (g) => html`<section class="s16-month" aria-labelledby="s16-m-${g.key}">
      <h3 class="s16-month-h" id="s16-m-${g.key}">${monthTitle(g.key)} <span class="s16-month-n">${plural(g.items.length, 'събитие', 'събития')}</span></h3>
      ${timeline({ label: `Събития през ${monthTitle(g.key).toLowerCase()}`, items: g.items.map(eventItem(M)) })}
    </section>`,
        )}</div>`
      : timeline({
          label: M.vid ? `Събития, вид: ${M.label.get(M.vid)}` : 'Всички събития',
          items: shown.map(eventItem(M)),
        });
  const body = html`${chips({ label: 'Покажи по вид', items: chipItems, cls: 's16-chips' })}
    ${note ? html`<p class="s16-shown">${note}</p>` : ''}
    ${list}`;
  return block({
    id: 's16-b-feed',
    level: 2,
    title: 'Хронология на събитията',
    sub: `${plural(events.length, 'събитие', 'събития')} от месечните отчети, законодателния път, ставките и Евростат, най-новите първо.`,
    status: 'real',
    source: meta.source,
    asOf: meta.asOf,
    body,
    foot: meta.sourceNote ? tidy(meta.sourceNote) : undefined,
  });
}

/* ------------------------------------------------------------------ RSS: a real static file next to the data */
const FEED_FILE = 'data/feed.xml';
function feedUrl() {
  try {
    return new URL(FEED_FILE, ROOT).href;
  } catch (e) {
    return FEED_FILE;
  }
}

export function rssBlock(M) {
  const body = html`<p class="s16-lead">RSS е обикновен файл, който специална програма — RSS четец — проверява сама. Добави адреса му в четеца си и новите събития ще се появяват там, без да отваряш портала.</p>
    <div class="field s16-rss">
      <label class="field-label" for="s16-rss-url">Адрес на RSS файла</label>
      <div class="s16-rss-row">
        <input class="input" id="s16-rss-url" type="text" readonly value="${feedUrl()}" aria-describedby="s16-rss-note" spellcheck="false">
        <button type="button" class="btn" data-s16-copy>Копирай адреса</button>
      </div>
    </div>
    <p class="s16-note" id="s16-rss-note">Файлът е един и същ за всички и съдържа събитията от хронологията по-горе.</p>
    <p class="s16-open">${ext(FEED_FILE, 'Отвори RSS файла')}</p>`;
  return block({
    id: 's16-b-rss',
    level: 2,
    title: 'Следи новото с RSS',
    status: 'real',
    source: M.meta.source,
    asOf: M.meta.asOf,
    share: false,
    body,
  });
}

/* ------------------------------------------------------------------ the page */
export const needs = ['core', 'feed'];
export const styles = ['s16-novo'];

export function lede(ctx) {
  try {
    const h = ctx.data && ctx.data.feed && ctx.data.feed.highlights;
    if (!h || !h.asOf) return undefined;
    return `Най-новият месечен отчет е към ${date(h.asOf, true)} г. Тук са новите данни, стъпките по закона и хронологията на събитията.`;
  } catch (e) {
    return undefined;
  }
}

export function render(ctx) {
  const M = model(ctx);
  return html`${summaryBlock(M)}${feedBlock(M)}${rssBlock(M)}`;
}

/* ------------------------------------------------------------------ behaviour: the chronology filter is announced, the RSS address is copied */
let lastVid = null; // the filter the previous render showed: a change is announced once

export function mount(root, ctx) {
  const off = [];
  const on = (el, ev, fn, opt) => {
    el.addEventListener(ev, fn, opt);
    off.push(() => el.removeEventListener(ev, fn, opt));
  };
  const one = (sel) => root.querySelector(sel);

  const M = model(ctx);
  if (ctx.kind === 'rerender' && lastVid !== null && M.vid !== lastVid && M.events.length) {
    ctx.announce(
      M.vid ? shownNote(M) : `Показани са всички ${plural(M.events.length, 'събитие', 'събития')}.`,
    );
  }
  lastVid = M.vid;

  on(root, 'focusin', (e) => {
    if (e.target && e.target.id === 's16-rss-url') e.target.select();
  });
  on(root, 'click', (e) => {
    const copy = e.target.closest('[data-s16-copy]');
    if (copy) {
      void copyOrShow(one('#s16-rss-url').value, 'Адресът е копиран.', 'Адрес на RSS файла', copy);
    }
  });

  return () => off.forEach((f) => f());
}
