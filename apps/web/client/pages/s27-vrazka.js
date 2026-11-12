// S27 · Обратна връзка · #/vrazka · next S01 · periods none
// Three forms in tabs: „Намерих грешка“ (context from the link that brought the visitor: ?from= ?val= ?src= ?block=), „Още не разбирам“, „Предложи идея“.
// The site has no server for messages: the submit button (feedback.send()) keeps the message in this browser (feedback.js, localStorage) and, when <meta name="feedback-email"> names
// the team's address, opens a ready e-mail to it (mailto:) that the visitor sends from their own mail app. An unsent draft stays in sessionStorage until the tab closes
// (so a re-render or a detour through the glossary does not eat the text). ?demo=error is drawn by the shell like on every screen.
import { html } from '../html.js';
import { icon } from '../icons.js';
import { plural } from '../format.js';
import { ROUTES, GROUPS, byKey, byId, match } from '../routes.js';
import { safe } from '../store.js';
import { callout, facts } from '../ui/cards.js';
import { tabs } from '../ui/tabs.js';
import { srcShort } from '../ui/source.js';
import * as feedback from '../feedback.js';

export const needs = [];
export const styles = ['s27-vrazka'];
export const lede = () => 'Намери грешка, кажи какво не ти е ясно или предложи идея.';

const MIN = 5; // letters of text before a message counts (same as S03)
const DRAFT_KEY = 'bns.s27.draft.v1';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** the three forms. key = tab key (short ASCII, also the shell footer's ?type=greshka), type = feedback.js type */
const FORMS = {
  greshka: {
    type: 'error',
    tab: 'Намерих грешка',
    intro:
      'Число, което не излиза, текст с грешка или връзка, която не работи. Кажи къде е и какво трябваше да се покаже.',
    label: 'Какво не е наред?',
    hint: 'Опиши какво виждаш на екрана и какво трябваше да е там. Не пиши лични данни.',
    tooShort: 'Напиши поне няколко думи, за да разберем какво не е наред.',
  },
  neyasno: {
    type: 'unclear',
    tab: 'Още не разбирам',
    intro:
      'Обяснение, което не помага, или дума, която остава неясна. Кажи какво искаш да разбереш.',
    label: 'Какво още не ти е ясно?',
    hint: 'Пиши със свои думи. Не пиши лични данни.',
    tooShort: 'Напиши поне няколко думи, за да разберем какво не е ясно.',
  },
  ideya: {
    type: 'idea',
    tab: 'Предложи идея',
    intro: 'Какво би направило сайта по-полезен? Опиши идеята накратко.',
    label: 'Каква е идеята?',
    hint: 'Какво липсва и как би помогнало? Не пиши лични данни.',
    tooShort: 'Напиши поне няколко думи за идеята.',
  },
};
const KEYS = Object.keys(FORMS);
/** every spelling a link may use for ?type= / ?tab= (reportLink says „error“, the shell footer says „greshka“) */
const ALIAS = {
  greshka: 'greshka',
  error: 'greshka',
  bug: 'greshka',
  neyasno: 'neyasno',
  unclear: 'neyasno',
  ideya: 'ideya',
  idea: 'ideya',
};

const TOPICS = [
  { value: 'chisla', label: 'Числата и данните' },
  { value: 'grafiki', label: 'Графиките и сравненията' },
  { value: 'obyasneniya', label: 'Обясненията и речникът' },
  { value: 'kalkulator', label: 'Калкулаторът за моите данъци' },
  { value: 'obshtini', label: 'Общини и проекти' },
  { value: 'telefon', label: 'Достъпност и телефон' },
  { value: 'drugo', label: 'Нещо друго' },
];
const topicLabel = (v) => TOPICS.find((t) => t.value === v)?.label || '';

/* ------------------------------------------------------------------ context from the link */

const clip = (v, n) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

/** a screen key („prihodi“) or a path („prihodi/dds“, „razhodi/obrazovanie“) -> the key of the screen in the menu, or '' */
function screenKey(raw) {
  const s = String(raw || '')
    .replace(/^#?\/?/, '')
    .split('?')[0];
  if (!s) return '';
  let r = byKey[s] || match(s.split('/').filter(Boolean))?.route;
  while (r && !r.nav && r.parent) r = byId[r.parent];
  return r && r.nav ? r.key : '';
}
const screenTitle = (key) => byKey[key]?.title || '';

function readContext(ctx) {
  const q = ctx.query || {};
  const src = String(q.src || '');
  return {
    from: screenKey(q.from),
    val: clip(q.val, 120),
    src: Object.prototype.hasOwnProperty.call(ctx.core?.sources || {}, src) ? src : '',
    block: /^[\w.:-]{1,60}$/.test(String(q.block || '')) ? String(q.block) : '',
  };
}
const activeKey = (q) => ALIAS[q.tab] || ALIAS[q.type] || 'greshka';

/* ------------------------------------------------------------------ draft (unsent text, this tab only) */

function readDraft() {
  try {
    const d = JSON.parse(safe.get('sessionStorage', DRAFT_KEY) || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}
function writeDraft(key, values) {
  const d = readDraft();
  const has = Object.values(values).some((v) => v);
  if (has) d[key] = values;
  else delete d[key];
  if (Object.keys(d).length) safe.set('sessionStorage', DRAFT_KEY, JSON.stringify(d));
  else safe.del('sessionStorage', DRAFT_KEY);
}

/* ------------------------------------------------------------------ pieces */

const MENU = GROUPS.filter((g) => g.id !== 'util')
  .map((g) => ({ label: g.label, items: ROUTES.filter((r) => r.group === g.id && r.nav) }))
  .filter((g) => g.items.length);

function screenSelect(id, value, hintId) {
  return html`<span class="select"><select id="${id}" name="from" aria-describedby="${hintId} ${id}-err">
    <option value="">Не знам или не е за един екран</option>
    ${MENU.map((g) => html`<optgroup label="${g.label}">${g.items.map((r) => html`<option value="${r.key}"${r.key === value ? html` selected` : ''}>${r.title}</option>`)}</optgroup>`)}
  </select></span>`;
}

/** one labelled field with a persistent (empty) alert for its error, so the message is spoken when it is filled in */
function fld(o) {
  const hintId = o.hint ? `${o.id}-hint` : '';
  return html`<div class="field">
    <label class="field-label" for="${o.id}">${o.label}${o.optional ? html` <span class="s27-opt">(по желание)</span>` : html` <span class="s27-req" aria-hidden="true">задължително</span>`}</label>
    ${o.hint ? html`<p class="field-hint" id="${hintId}">${o.hint}</p>` : ''}
    ${o.control(hintId)}
    <p class="field-error" id="${o.id}-err" role="alert"></p>
  </div>`;
}

function textField(key, spec, value) {
  const id = `s27-${key}-text`;
  return html`${fld({
    id,
    label: spec.label,
    hint: spec.hint,
    control: (
      hid,
    ) => html`<textarea class="input s27-textarea" id="${id}" name="text" rows="5" maxlength="${feedback.MAX_TEXT}" required aria-describedby="${hid} ${id}-err">${value}</textarea>
      <span class="s27-count" data-s27-count aria-hidden="true">${[...value].length} / ${feedback.MAX_TEXT}</span>`,
  })}`;
}

function form(key, ctx, ctxInfo, draft) {
  const spec = FORMS[key];
  const d = draft[key] || {};
  const fromVal = key !== 'ideya' ? ctxInfo.from || d.from || '' : '';
  const body = [];
  body.push(textField(key, spec, d.text || ''));
  if (key === 'greshka') {
    const val = ctxInfo.val || d.val || '';
    body.push(html`<div class="s27-pair">
      ${fld({ id: 's27-greshka-from', label: 'За кой екран?', optional: true, hint: ctxInfo.from ? 'Попълнихме го от мястото, откъдето дойде.' : 'Така по-лесно ще намерим мястото.', control: (hid) => screenSelect('s27-greshka-from', fromVal, hid) })}
      ${fld({
        id: 's27-greshka-val',
        label: 'Кое число или кой текст?',
        optional: true,
        hint: ctxInfo.val
          ? 'Попълнихме го от мястото, откъдето дойде.'
          : 'Например числото, както го виждаш на екрана.',
        control: (hid) =>
          html`<input class="input" id="s27-greshka-val" name="val" type="text" maxlength="120" value="${val}" aria-describedby="${hid} s27-greshka-val-err">`,
      })}
    </div>`);
    if (ctxInfo.src)
      body.push(
        facts([{ k: 'Източник на числото', v: srcShort(ctxInfo.src) }], { cls: 's27-src' }),
      );
  } else if (key === 'neyasno') {
    body.push(
      fld({
        id: 's27-neyasno-from',
        label: 'За кой екран?',
        optional: true,
        hint: ctxInfo.from
          ? 'Попълнихме го от мястото, откъдето дойде.'
          : 'Така по-лесно ще видим къде е неясно.',
        control: (hid) => screenSelect('s27-neyasno-from', fromVal, hid),
      }),
    );
  } else {
    body.push(html`<div class="s27-pair">
      ${fld({
        id: 's27-ideya-topic',
        label: 'За коя част от сайта?',
        optional: true,
        hint: 'Избери най-близкото.',
        control: (
          hid,
        ) => html`<span class="select"><select id="s27-ideya-topic" name="topic" aria-describedby="${hid} s27-ideya-topic-err">
          <option value="">Не знам или е за целия сайт</option>
          ${TOPICS.map((t) => html`<option value="${t.value}"${t.value === d.topic ? html` selected` : ''}>${t.label}</option>`)}</select></span>`,
      })}
      ${fld({
        id: 's27-ideya-contact',
        label: 'Имейл за отговор',
        optional: true,
        hint: 'Само ако искаш да ти отговорим.',
        control: (hid) =>
          html`<input class="input" id="s27-ideya-contact" name="contact" type="email" inputmode="email" autocomplete="email" maxlength="120" value="${d.contact || ''}" aria-describedby="${hid} s27-ideya-contact-err">`,
      })}
    </div>`);
  }
  return html`<p class="s27-intro">${spec.intro}</p>
    <form class="s27-form" data-s27-form="${key}" novalidate>
      ${body}
      <div class="cluster"><button type="submit" class="btn btn-primary">${feedback.send()}</button></div>
    </form>
    <div class="s27-ok" data-s27-ok="${key}" hidden>
      <span class="s27-ok-ic" aria-hidden="true">${icon('checkCircle', { size: 24 })}</span>
      <div class="s27-ok-main">
        <h3 class="s27-ok-h" tabindex="-1">${feedback.sent()}</h3>
        <p class="s27-ok-note">${feedback.to() ? html`Имейлът до ${feedback.to()} е готов: отвори го и го изпрати от пощата си. Копие остава долу, в „Записано в този браузър“.` : 'Съобщението е запазено само в този браузър и не е изпратено. Виж го долу, в „Записано в този браузър“.'}</p>
        <p class="s27-warn" data-s27-warn hidden>${icon('alert', { size: 16 })}<span>Браузърът не позволява да се пази запис. Съобщението остава само докато не презаредиш страницата.</span></p>
        <div class="cluster">${feedback.to() ? html`<a class="btn btn-primary" data-s27-mail href="mailto:${feedback.to()}">${icon('message', { size: 16 })}<span>Отвори имейла</span></a>` : ''}<button type="button" class="btn" data-s27-again="${key}">${feedback.to() ? 'Изпрати още едно' : 'Напиши още едно'}</button></div>
      </div>
    </div>`;
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: '', iso: '' };
  return {
    text: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} ч.`,
    iso: d.toISOString(),
  };
}

function savedItem(r) {
  const t = stamp(r.at);
  const meta = [
    r.from && `Екран: ${screenTitle(r.from) || r.from}`,
    r.val && `Число: ${r.val}`,
    r.src && `Източник: ${srcShort(r.src)}`,
    r.block && `Блок: ${r.block}`,
    r.topic && `Част от сайта: ${topicLabel(r.topic) || r.topic}`,
    r.contact && `Имейл: ${r.contact}`,
  ].filter(Boolean);
  return html`<li class="s27-saved-item">
    <p class="s27-saved-head"><span class="s27-pill">${feedback.TYPES[r.type]}</span>${t.text ? html` <time datetime="${t.iso}">${t.text}</time>` : ''}</p>
    <p class="s27-saved-text">${r.text}</p>
    ${meta.length ? html`<p class="s27-saved-meta">${meta.join(' · ')}</p>` : ''}
  </li>`;
}
const savedBody = (items) =>
  items.length
    ? html`<ol class="s27-saved-list">${items.map(savedItem)}</ol>`
    : html`<p class="s27-saved-empty">Тук ще видиш съобщенията, които ${feedback.to() ? 'изпратиш' : 'запазиш'} от тази страница.</p>`;
const savedCount = (n) =>
  n ? `Записани: ${plural(n, 'съобщение', 'съобщения')}.` : 'Още нищо не е записано.';

function saved(items) {
  return html`<section class="s27-saved" aria-labelledby="s27-saved-h">
    <h2 id="s27-saved-h" tabindex="-1">Записано в този браузър</h2>
    <p class="s27-saved-note">Нищо не напуска устройството ти. Съобщенията стоят в паметта на този браузър и можеш да ги изчистиш, когато поискаш.</p>
    <div class="s27-saved-bar">
      <p class="s27-saved-count" id="s27-saved-count">${savedCount(items.length)}</p>
      <button type="button" class="btn btn-sm" data-s27-clear${items.length ? '' : html` hidden`}>Изчисти всичко</button>
    </div>
    <div id="s27-saved-body">${savedBody(items)}</div>
  </section>`;
}

/* ------------------------------------------------------------------ screen */

export function render(ctx) {
  const info = readContext(ctx);
  const draft = readDraft();
  return html`
    ${
      feedback.to()
        ? callout({
            kind: 'info',
            title: 'Как стига до нас',
            body: html`<p>Формулярът подготвя имейл до <a href="mailto:${feedback.to()}">${feedback.to()}</a> и го изпращаш от своята поща. Копие остава в този браузър. Не пиши лични данни в текста.</p>`,
          })
        : callout({
            kind: 'info',
            title: 'Запазване в браузъра',
            body: html`<p>Няма зададен адрес за получаване на съобщения. Написаното се запазва само в този браузър и не се изпраща.</p>`,
          })
    }
    <section class="s27-main" aria-labelledby="s27-main-h">
      <h2 id="s27-main-h">Какво искаш да ни кажеш?</h2>
      ${tabs({
        id: 's27-tabs',
        label: 'Вид съобщение',
        query: 'tab',
        active: activeKey(ctx.query || {}),
        tabs: KEYS.map((k) => ({ key: k, label: FORMS[k].tab, body: form(k, ctx, info, draft) })),
      })}
    </section>
    ${saved(feedback.list())}`;
}

/* ------------------------------------------------------------------ behaviour */

export function mount(root, ctx) {
  const off = [];
  const on = (el, ev, fn, opt) => {
    el.addEventListener(ev, fn, opt);
    off.push(() => el.removeEventListener(ev, fn, opt));
  };
  const info = readContext(ctx);
  const pending = new Map(); // form -> debounce timer of its draft

  const values = (f) => ({
    text: f.elements.text.value,
    from: f.elements.from?.value || '',
    val: f.elements.val?.value || '',
    topic: f.elements.topic?.value || '',
    contact: f.elements.contact?.value || '',
  });
  const saveDraft = (f) => writeDraft(f.dataset.s27Form, values(f));
  const queueDraft = (f) => {
    clearTimeout(pending.get(f));
    pending.set(
      f,
      setTimeout(() => {
        pending.delete(f);
        saveDraft(f);
      }, 250),
    );
  };
  const dropDraft = (f) => {
    clearTimeout(pending.get(f));
    pending.delete(f);
    writeDraft(f.dataset.s27Form, {});
  };
  const flushDrafts = () => {
    for (const [f, t] of pending) {
      clearTimeout(t);
      saveDraft(f);
    }
    pending.clear();
  };

  function setError(control, message) {
    const err = root.querySelector(`#${control.id}-err`);
    if (err) err.textContent = message;
    if (message) control.setAttribute('aria-invalid', 'true');
    else control.removeAttribute('aria-invalid');
  }

  function refreshSaved() {
    const items = feedback.list();
    root.querySelector('#s27-saved-body').innerHTML = String(savedBody(items));
    root.querySelector('#s27-saved-count').textContent = savedCount(items.length);
    root.querySelector('[data-s27-clear]').hidden = !items.length;
    return items.length;
  }

  on(root, 'submit', (e) => {
    const f = e.target.closest('form[data-s27-form]');
    if (!f) return;
    e.preventDefault();
    const key = f.dataset.s27Form,
      spec = FORMS[key];
    const v = values(f);
    const text = v.text.trim();
    const bad = [];
    setError(f.elements.text, '');
    if (text.length < MIN) {
      setError(f.elements.text, spec.tooShort);
      bad.push(f.elements.text);
    }
    if (f.elements.contact) {
      const c = v.contact.trim();
      const wrong = c && !EMAIL.test(c);
      setError(
        f.elements.contact,
        wrong ? 'Това не прилича на имейл адрес. Провери го или го остави празно.' : '',
      );
      if (wrong) bad.push(f.elements.contact);
    }
    if (bad.length) {
      bad
        .sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        )[0]
        .focus();
      return;
    }
    const rec = feedback.add({
      type: spec.type,
      text,
      route: 'S27',
      from: v.from,
      topic: v.topic,
      contact: v.contact.trim(),
      ...(key === 'greshka' ? { val: v.val, src: info.src, block: info.block } : {}),
    });
    dropDraft(f);
    f.reset();
    f.querySelector('[data-s27-count]').textContent = `0 / ${feedback.MAX_TEXT}`;
    // reset() brings back the markup defaults: the draft is gone and the link's context stays for the next report
    if (key === 'greshka') {
      if (f.elements.from) f.elements.from.value = info.from;
      if (f.elements.val) f.elements.val.value = info.val;
    }
    if (key === 'neyasno' && f.elements.from) f.elements.from.value = info.from;
    const ok = root.querySelector(`[data-s27-ok="${key}"]`);
    const mail = ok.querySelector('[data-s27-mail]');
    if (mail) mail.href = feedback.mailto(rec);
    ok.querySelector('[data-s27-warn]').hidden = rec.persisted;
    f.hidden = true;
    ok.hidden = false;
    ok.querySelector('.s27-ok-h').focus();
    const n = refreshSaved();
    ctx.announce(`Записано в този браузър. Общо: ${plural(n, 'съобщение', 'съобщения')}.`);
  });

  on(root, 'input', (e) => {
    const c = e.target.closest?.('form[data-s27-form] :is(textarea, input, select)');
    if (!c) return;
    if (c.getAttribute('aria-invalid')) setError(c, '');
    if (c.matches('textarea'))
      c.parentElement.querySelector('[data-s27-count]').textContent =
        `${[...c.value].length} / ${feedback.MAX_TEXT}`;
    queueDraft(c.form);
  });
  on(root, 'change', (e) => {
    const c = e.target.closest?.('form[data-s27-form] select');
    if (c) saveDraft(c.form);
  });
  on(root, 'keydown', (e) => {
    if (
      e.key === 'Enter' &&
      (e.ctrlKey || e.metaKey) &&
      e.target.matches?.('form[data-s27-form] textarea')
    ) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });
  on(root, 'click', (e) => {
    const again = e.target.closest('[data-s27-again]');
    if (again) {
      const key = again.dataset.s27Again;
      const f = root.querySelector(`form[data-s27-form="${key}"]`);
      root.querySelector(`[data-s27-ok="${key}"]`).hidden = true;
      f.hidden = false;
      f.elements.text.focus();
      return;
    }
    if (e.target.closest('[data-s27-clear]')) {
      feedback.clear();
      refreshSaved();
      root.querySelector('#s27-saved-h').focus();
      ctx.announce('Изчистено. В този браузър няма записани съобщения.');
    }
  });

  return () => {
    flushDrafts();
    off.forEach((f) => f());
  };
}
