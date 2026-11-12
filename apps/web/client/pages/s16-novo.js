// S16 Какво ново? (G3). What changed lately in the data and in the law: the latest monthly report in five sentences, what is still
// expected, a month-by-month chronology of events and a prototype subscription (RSS is real, e-mail and Viber only show the flow).
// Every number and every event comes from feed.json (built by the data pipeline from the other data sets); nothing is typed from memory.
// The visitor filters the chronology in the query: ?vid=report|law|plenary|rates|eurostat|data (none = all events).
import { html, plain, raw } from '../html.js';
import { ROOT } from '../loc.js';
import { icon } from '../icons.js';
import { pct, date, monthName, plural, NBSP } from '../format.js';
import { copyOrShow } from '../share.js';
import { block } from '../ui/block.js';
import { ext } from '../ui/cards.js';
import { chips } from '../ui/chips.js';
import { toggle } from '../ui/forms.js';
import { seg } from '../ui/seg.js';
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

/* ------------------------------------------------------------------ the subscription: only the flow is shown, nothing is sent or kept */
const TOPICS = [
  {
    value: 'report',
    label: 'Нов месечен отчет',
    short: 'нов месечен отчет',
    hint: 'Когато излязат данните за поредния месец.',
    on: true,
  },
  {
    value: 'law',
    label: 'Закон и гласувания',
    short: 'закон и гласувания',
    hint: 'Стъпките на закона за бюджета и гласуванията в залата.',
    on: true,
  },
  {
    value: 'rates',
    label: 'Данъци и осигуровки',
    short: 'данъци и осигуровки',
    hint: 'Промени в ставките и границите.',
    on: false,
  },
  {
    value: 'data',
    label: 'Нови данни и Евростат',
    short: 'нови данни и Евростат',
    hint: 'Нови набори от данни и нови публикации на Евростат.',
    on: false,
  },
];
const CHANNELS = [
  { value: 'email', label: 'По имейл' },
  { value: 'viber', label: 'Във Viber' },
];

/** one labelled field with a persistent (empty) alert for its error, so a message is spoken when it is filled in */
function fld(o) {
  return html`<div class="field" data-s16-pane="${o.pane}"${o.hidden ? html` hidden` : ''}>
    <label class="field-label" for="${o.id}">${o.label}</label>
    <p class="field-hint" id="${o.id}-hint">${o.hint}</p>
    ${o.control}
    <p class="field-error" id="${o.id}-err" role="alert"></p>
  </div>`;
}

export function subscribeBlock() {
  const email = fld({
    pane: 'email',
    id: 's16-email',
    label: 'Имейл адрес',
    hint: 'Пиши само адреса си.',
    control: html`<input class="input" id="s16-email" name="email" type="email" inputmode="email" autocomplete="email" spellcheck="false" placeholder="ime@example.com" aria-describedby="s16-email-hint s16-email-err">`,
  });
  const viber = fld({
    pane: 'viber',
    id: 's16-phone',
    label: 'Телефон във Viber',
    hint: 'Пиши само цифрите, например 0888 000 000 или +359 888 000 000.',
    hidden: true,
    control: html`<input class="input" id="s16-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="0888 000 000" aria-describedby="s16-phone-hint s16-phone-err">`,
  });
  const topics = html`<fieldset class="s16-topics" aria-describedby="s16-topics-err">
      <legend class="field-label">За какво да ти съобщаваме?</legend>
      <div class="s16-topic-list">${TOPICS.map((t) => toggle({ id: `s16-t-${t.value}`, name: 'topic', label: t.label, hint: t.hint, checked: t.on, attrs: raw(` value="${t.value}"`) }))}</div>
      <p class="field-error" id="s16-topics-err" role="alert"></p>
    </fieldset>`;
  const consent = html`<div class="field s16-consent">
      ${toggle({ id: 's16-consent', name: 'consent', label: 'Съгласен съм да получавам съобщения за избраното', attrs: raw(' aria-describedby="s16-consent-err"') })}
      <p class="field-error" id="s16-consent-err" role="alert"></p>
    </div>`;
  const body = html`<p class="s16-lead">Получавай кратко съобщение, когато има нов отчет или промяна в закона. Избери къде и за какво.</p>
    <form class="s16-form" data-s16-form novalidate>
      ${seg({ name: 's16-ch', label: 'Къде да ти съобщаваме?', value: 'email', options: CHANNELS, cls: 's16-seg' })}
      ${email}${viber}${topics}${consent}
      <div class="cluster"><button type="submit" class="btn btn-primary">Абонирай ме</button></div>
    </form>
    <div class="s16-ok" data-s16-ok hidden>
      <span class="s16-ok-ic" aria-hidden="true">${icon('checkCircle', { size: 24 })}</span>
      <div class="s16-ok-main">
        <h3 class="s16-ok-h" tabindex="-1">Благодарим!</h3>
        <p data-s16-ok-text></p>
        <p class="s16-note">Това е примерен формуляр: нищо не е изпратено и нищо не е записано.</p>
        <div class="cluster"><button type="button" class="btn" data-s16-again>Попълни отново</button></div>
      </div>
    </div>`;
  return block({
    id: 's16-b-subscribe',
    level: 2,
    title: 'Съобщения по имейл или във Viber',
    status: 'mock',
    body,
    why: 'Това е примерен формуляр: показва как ще работи абонаментът, но прототипът не изпраща нищо и не пази въведеното.',
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
  return html`${summaryBlock(M)}${feedBlock(M)}${rssBlock(M)}`; // V7: the sample subscription form (subscribeBlock) is out: it sent nothing, and RSS is the real channel
}

/* ------------------------------------------------------------------ behaviour: the chronology filter is announced, the mock form is checked and answered, the RSS address is copied */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE = /^\+?\d{9,15}$/;
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

  const channel = () => (one('input[name="s16-ch"]:checked') || {}).value || 'email';
  const syncPane = () => {
    const ch = channel();
    root.querySelectorAll('[data-s16-pane]').forEach((p) => {
      p.hidden = p.dataset.s16Pane !== ch;
    });
  };
  const setError = (control, message) => {
    const err = one(`#${control.id}-err`);
    if (err) err.textContent = message;
    if (message) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  };
  const setTopicsError = (message) => {
    one('#s16-topics-err').textContent = message;
    const fs = one('.s16-topics');
    if (message) fs.setAttribute('data-bad', 'true');
    else fs.removeAttribute('data-bad');
  };

  on(root, 'submit', (e) => {
    const f = e.target.closest('form[data-s16-form]');
    if (!f) return;
    e.preventDefault();
    const ch = channel();
    const email = f.elements.email,
      phone = f.elements.phone,
      consent = f.elements.consent;
    const bad = [];
    setError(email, '');
    setError(phone, '');
    if (ch === 'email') {
      const v = email.value.trim();
      if (!v) {
        setError(email, 'Напиши имейл адрес.');
        bad.push(email);
      } else if (!EMAIL.test(v)) {
        setError(email, 'Това не прилича на имейл адрес. Провери го.');
        bad.push(email);
      }
    } else {
      const v = phone.value.replace(/[\s\-().]/g, '');
      if (!v) {
        setError(phone, 'Напиши номер на телефон.');
        bad.push(phone);
      } else if (!PHONE.test(v)) {
        setError(
          phone,
          'Това не прилича на телефонен номер. Пиши само цифри, например 0888 000 000.',
        );
        bad.push(phone);
      }
    }
    const picked = [...f.querySelectorAll('input[name="topic"]:checked')].map((i) => i.value);
    setTopicsError(picked.length ? '' : 'Избери поне една тема.');
    if (!picked.length) bad.push(f.querySelector('input[name="topic"]'));
    setError(consent, consent.checked ? '' : 'Отбележи съгласието, за да продължиш.');
    if (!consent.checked) bad.push(consent);
    if (bad.length) {
      bad
        .sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        )[0]
        .focus();
      return;
    }
    const words = TOPICS.filter((t) => picked.includes(t.value)).map((t) => t.short);
    one('[data-s16-ok-text]').textContent =
      `Така би работил абонаментът: съобщения ${ch === 'email' ? 'по имейл' : 'във Viber'} за ${words.join(', ')}.`;
    const ok = one('[data-s16-ok]');
    f.hidden = true;
    ok.hidden = false;
    ok.querySelector('.s16-ok-h').focus();
    ctx.announce('Благодарим! Това е примерен формуляр: нищо не е изпратено.');
  });

  on(root, 'change', (e) => {
    const t = e.target;
    if (!t || !t.matches) return;
    if (t.matches('input[name="s16-ch"]')) {
      syncPane();
      const f = t.form;
      if (f) {
        setError(f.elements.email, '');
        setError(f.elements.phone, '');
      }
    } else if (t.matches('input[name="topic"]')) setTopicsError('');
    else if (t.matches('input[name="consent"]')) setError(t, '');
  });
  on(root, 'input', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('#s16-email, #s16-phone') && t.getAttribute('aria-invalid'))
      setError(t, '');
  });
  on(root, 'focusin', (e) => {
    if (e.target && e.target.id === 's16-rss-url') e.target.select();
  });
  on(root, 'click', (e) => {
    const copy = e.target.closest('[data-s16-copy]');
    if (copy) {
      void copyOrShow(one('#s16-rss-url').value, 'Адресът е копиран.', 'Адрес на RSS файла', copy);
      return;
    }
    if (e.target.closest('[data-s16-again]')) {
      const f = one('form[data-s16-form]');
      one('[data-s16-ok]').hidden = true;
      f.reset();
      f.querySelectorAll('[aria-invalid]').forEach((c) => c.removeAttribute('aria-invalid'));
      f.querySelectorAll('.field-error').forEach((p) => {
        p.textContent = '';
      });
      setTopicsError('');
      syncPane();
      f.hidden = false;
      (channel() === 'email' ? f.elements.email : f.elements.phone).focus();
    }
  });

  return () => off.forEach((f) => f());
}
