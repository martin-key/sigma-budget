// S27 · Обратна връзка (/vrazka), the React screen of apps/web/client/pages/s27-vrazka.js (docs/react-shell.md).
// Three forms in tabs: „Намерих грешка“ (with the context of the link that brought the visitor: ?from= ?val= ?src= ?block=), „Още не разбирам“
// and „Предложи идея“. The site has no server for messages: the submit button keeps the message in this browser (apps/web/client/feedback.js,
// localStorage) and, when the release names the team's address (FEEDBACK_EMAIL, <meta name="feedback-email">), prepares an e-mail to it
// (mailto:) that the visitor sends from their own mail app. An unsent draft stays in sessionStorage until the tab closes.
// The server draws the screen without anything stored: the saved messages and the drafts are read after the browser adopts it.
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type { EditorialScreenModel, Navigation } from '../lib/screen-state';
import { PageFrame } from '../components/PageFrame';
import { Tabs } from '../components/Tabs';
import { callout, facts } from '../components/Cards';
import { icon } from '../components/Icon';
import { compactText } from '../components/ScreenTree';
import { plural } from '../lib/legacy';
import { ROUTES, GROUPS, byKey, byId, match } from '../../client/routes.js';
import { safe } from '../../client/store.js';
import { srcShort } from '../../client/ui/source.js';
import * as feedback from '../../client/feedback.js';

export const lede = 'Намери грешка, кажи какво не ти е ясно или предложи идея.';

const MIN = 5; // letters of text before a message counts (same as S03)
const DRAFT_KEY = 'bns.s27.draft.v1';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type Key = 'greshka' | 'neyasno' | 'ideya';
/** the three forms. key = tab key (short ASCII, also the footer's ?type=greshka), type = feedback.js type */
const FORMS: Record<
  Key,
  { type: string; tab: string; intro: string; label: string; hint: string; tooShort: string }
> = {
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
const KEYS = Object.keys(FORMS) as Key[];
/** every spelling a link may use for ?type= / ?tab= (reportLink says „error“, the footer says „greshka“) */
const ALIAS: Record<string, Key> = {
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
  { value: 'obshtini', label: 'Общини и проекти (предстои)' },
  { value: 'telefon', label: 'Достъпност и телефон' },
  { value: 'drugo', label: 'Нещо друго' },
];
const topicLabel = (v: string) => TOPICS.find((t) => t.value === v)?.label || '';

interface LegacyRoute {
  id: string;
  key: string;
  title: string;
  group: string;
  nav?: boolean;
  parent?: string;
}
const routes = ROUTES as LegacyRoute[];
const keyed = byKey as Record<string, LegacyRoute | undefined>;
const ided = byId as Record<string, LegacyRoute | undefined>;

/* ------------------------------------------------------------------ context from the link */

const clip = (v: unknown, n: number) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, n);

/** a screen key („prihodi“) or a path („prihodi/dds“) -> the key of the screen in the menu, or '' */
function screenKey(raw: unknown) {
  const s = String(raw || '')
    .replace(/^#?\/?/, '')
    .split('?')[0];
  if (!s) return '';
  let r =
    keyed[s] || (match(s.split('/').filter(Boolean)) as { route?: LegacyRoute } | null)?.route;
  while (r && !r.nav && r.parent) r = ided[r.parent];
  return r && r.nav ? r.key : '';
}
const screenTitle = (key: string) => keyed[key]?.title || '';

interface Context {
  from: string;
  val: string;
  src: string;
  block: string;
}
function readContext(query: Record<string, string>, sources: object | undefined): Context {
  const src = String(query.src || '');
  return {
    from: screenKey(query.from),
    val: clip(query.val, 120),
    src: Object.prototype.hasOwnProperty.call(sources || {}, src) ? src : '',
    block: /^[\w.:-]{1,60}$/.test(String(query.block || '')) ? String(query.block) : '',
  };
}
const activeKey = (q: Record<string, string>): Key => ALIAS[q.tab] || ALIAS[q.type] || 'greshka';

/* ------------------------------------------------------------------ draft (unsent text, this tab only) */

interface Values {
  text: string;
  from: string;
  val: string;
  topic: string;
  contact: string;
}
function readDraft(): Partial<Record<Key, Partial<Values>>> {
  try {
    const d = JSON.parse(safe.get('sessionStorage', DRAFT_KEY) || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}
function writeDraft(key: Key, values: Partial<Values>) {
  const d = readDraft();
  if (Object.values(values).some((v) => v)) d[key] = values;
  else delete d[key];
  if (Object.keys(d).length) safe.set('sessionStorage', DRAFT_KEY, JSON.stringify(d));
  else safe.del('sessionStorage', DRAFT_KEY);
}
const control = (f: HTMLFormElement, name: string) =>
  f.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
const valuesOf = (f: HTMLFormElement): Values => ({
  text: control(f, 'text')?.value || '',
  from: control(f, 'from')?.value || '',
  val: control(f, 'val')?.value || '',
  topic: control(f, 'topic')?.value || '',
  contact: control(f, 'contact')?.value || '',
});

/* ------------------------------------------------------------------ the saved messages */

interface Saved {
  type: string;
  text: string;
  at: string;
  from?: string;
  val?: string;
  src?: string;
  block?: string;
  topic?: string;
  contact?: string;
  persisted?: boolean;
}
const pad = (n: number) => String(n).padStart(2, '0');
function stamp(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { text: '', iso: '' };
  return {
    text: `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} ч.`,
    iso: d.toISOString(),
  };
}
function savedItem(r: Saved, i: number) {
  const t = stamp(r.at);
  const meta = [
    r.from && `Екран: ${screenTitle(r.from) || r.from}`,
    r.val && `Число: ${r.val}`,
    r.src && `Източник: ${srcShort(r.src)}`,
    r.block && `Блок: ${r.block}`,
    r.topic && `Част от сайта: ${topicLabel(r.topic) || r.topic}`,
    r.contact && `Имейл: ${r.contact}`,
  ].filter(Boolean);
  return (
    <li className="s27-saved-item" key={i}>
      <p className="s27-saved-head">
        <span className="s27-pill">{(feedback.TYPES as Record<string, string>)[r.type]}</span>
        {t.text ? (
          <>
            {' '}
            <time dateTime={t.iso}>{t.text}</time>
          </>
        ) : null}
      </p>
      <p className="s27-saved-text">{r.text}</p>
      {meta.length ? <p className="s27-saved-meta">{meta.join(' · ')}</p> : null}
    </li>
  );
}
const savedCount = (n: number) =>
  n ? `Записани: ${plural(n, 'съобщение', 'съобщения')}.` : 'Още нищо не е записано.';

/* ------------------------------------------------------------------ the screen */

interface Sent {
  mail: string;
  persisted: boolean;
}

export function FeedbackContent({
  model,
  navigation,
}: {
  model: EditorialScreenModel;
  navigation: Navigation;
}) {
  const to = String(model.release.feedbackEmail || '').trim();
  const SEND = to ? 'Изпрати' : 'Запази в този браузър';
  const SENT = to
    ? 'Благодарим. Остава да изпратиш имейла.'
    : 'Благодарим. Записахме го в този браузър.';
  const info = readContext(model.query, (model.core as { sources?: object } | undefined)?.sources);
  const root = useRef<HTMLElement>(null);
  const [items, setItems] = useState<Saved[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Partial<Record<Key, Sent>>>({});
  const [focus, setFocus] = useState('');
  const pending = useRef(new Map<HTMLFormElement, ReturnType<typeof setTimeout>>());

  const form = (key: Key) =>
    root.current?.querySelector<HTMLFormElement>(`form[data-s27-form="${key}"]`) || null;
  const saveDraft = (f: HTMLFormElement) => writeDraft(f.dataset.s27Form as Key, valuesOf(f));

  // after the browser adopts the server's screen: what this browser keeps (the saved messages, the drafts of this tab)
  useEffect(() => {
    setItems(feedback.list() as Saved[]);
    const draft = readDraft();
    const next: Record<string, number> = {};
    for (const key of KEYS) {
      const f = form(key),
        d = draft[key];
      if (!f || !d) continue;
      const set = (name: string, v: string | undefined) => {
        const c = control(f, name);
        if (c && v) c.value = v;
      };
      set('text', d.text);
      if (key !== 'ideya') set('from', info.from || d.from);
      if (key === 'greshka') set('val', info.val || d.val);
      if (key === 'ideya') {
        set('topic', d.topic);
        set('contact', d.contact);
      }
      next[key] = [...(d.text || '')].length;
    }
    setCounts(next);
    const timers = pending.current;
    return () => {
      for (const [f, t] of timers) {
        clearTimeout(t);
        saveDraft(f);
      }
      timers.clear();
    };
  }, []);
  useEffect(() => {
    if (!focus) return;
    // the saved list is outside the forms' section: the selectors are unique on the page
    document.querySelector<HTMLElement>(focus)?.focus();
    setFocus('');
  }, [focus]);

  const setError = (id: string, message: string) =>
    setErrors((e) => {
      if ((e[id] || '') === message) return e;
      const next = { ...e };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });

  function onSubmit(e: FormEvent<HTMLElement>) {
    const f = (e.target as Element).closest<HTMLFormElement>('form[data-s27-form]');
    if (!f) return;
    e.preventDefault();
    const key = f.dataset.s27Form as Key,
      spec = FORMS[key];
    const v = valuesOf(f);
    const text = v.text.trim();
    const bad: { focus(): void }[] = [];
    const textControl = control(f, 'text')!;
    setError(textControl.id, text.length < MIN ? spec.tooShort : '');
    if (text.length < MIN) bad.push(textControl);
    const contact = control(f, 'contact');
    if (contact) {
      const c = v.contact.trim();
      const wrong = !!c && !EMAIL.test(c);
      setError(
        contact.id,
        wrong ? 'Това не прилича на имейл адрес. Провери го или го остави празно.' : '',
      );
      if (wrong) bad.push(contact);
    }
    if (bad.length) {
      bad[0].focus();
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
    }) as Saved;
    clearTimeout(pending.current.get(f));
    pending.current.delete(f);
    writeDraft(key, {});
    // reset() brings back the markup defaults: the draft is gone and the link's context stays for the next report
    f.reset();
    setCounts((c) => ({ ...c, [key]: 0 }));
    setSent((s) => ({
      ...s,
      [key]: { mail: to ? feedback.mailto(rec) : '', persisted: rec.persisted !== false },
    }));
    setFocus(`[data-s27-ok="${key}"] .s27-ok-h`);
    const list = feedback.list() as Saved[];
    setItems(list);
    navigation.announce(
      `Записано в този браузър. Общо: ${plural(list.length, 'съобщение', 'съобщения')}.`,
    );
  }

  function onInput(e: FormEvent<HTMLElement>) {
    const c = (e.target as Element).closest('form[data-s27-form] :is(textarea, input, select)') as
      | HTMLInputElement
      | HTMLTextAreaElement
      | null;
    if (!c || !c.form) return;
    if (c.getAttribute('aria-invalid')) setError(c.id, '');
    const f = c.form;
    if (c instanceof HTMLTextAreaElement)
      setCounts((n) => ({ ...n, [f.dataset.s27Form!]: [...c.value].length }));
    clearTimeout(pending.current.get(f));
    pending.current.set(
      f,
      setTimeout(() => {
        pending.current.delete(f);
        saveDraft(f);
      }, 250),
    );
  }

  const fld = (o: {
    id: string;
    label: string;
    hint?: string;
    optional?: boolean;
    control: (hintId: string) => ReactNode;
  }) => {
    const hintId = o.hint ? `${o.id}-hint` : '';
    return (
      <div className="field">
        <label className="field-label" htmlFor={o.id}>
          {o.label}{' '}
          {o.optional ? (
            <span className="s27-opt">(по желание)</span>
          ) : (
            <span className="s27-req" aria-hidden="true">
              задължително
            </span>
          )}
        </label>
        {o.hint ? (
          <p className="field-hint" id={hintId}>
            {o.hint}
          </p>
        ) : null}
        {o.control(hintId)}
        <p className="field-error" id={`${o.id}-err`} role="alert">
          {errors[o.id] || ''}
        </p>
      </div>
    );
  };
  const invalid = (id: string) => (errors[id] ? 'true' : undefined);

  const menu = (GROUPS as { id: string; label: string }[])
    .filter((g) => g.id !== 'util')
    .map((g) => ({ label: g.label, items: routes.filter((r) => r.group === g.id && r.nav) }))
    .filter((g) => g.items.length);
  const screenSelect = (id: string, value: string, hintId: string) => (
    <span className="select">
      <select
        id={id}
        name="from"
        aria-describedby={`${hintId} ${id}-err`}
        aria-invalid={invalid(id)}
        defaultValue={value || undefined}
      >
        <option value="">Не знам или не е за един екран</option>
        {menu.map((g) => (
          <optgroup label={g.label} key={g.label}>
            {g.items.map((r) => (
              <option value={r.key} key={r.key}>
                {r.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </span>
  );
  const textField = (key: Key) => {
    const spec = FORMS[key],
      id = `s27-${key}-text`;
    return fld({
      id,
      label: spec.label,
      hint: spec.hint,
      control: (hid) => (
        <>
          <textarea
            className="input s27-textarea"
            id={id}
            name="text"
            rows={5}
            maxLength={feedback.MAX_TEXT}
            required
            aria-describedby={`${hid} ${id}-err`}
            aria-invalid={invalid(id)}
            defaultValue=""
          />
          <span className="s27-count" data-s27-count="" aria-hidden="true">
            {counts[key] || 0} / {feedback.MAX_TEXT}
          </span>
        </>
      ),
    });
  };
  const fromHint = (other: string) =>
    info.from ? 'Попълнихме го от мястото, откъдето дойде.' : other;

  const formOf = (key: Key) => {
    const spec = FORMS[key];
    const done = sent[key];
    let rest: ReactNode;
    if (key === 'greshka')
      rest = (
        <>
          <div className="s27-pair">
            {fld({
              id: 's27-greshka-from',
              label: 'За кой екран?',
              optional: true,
              hint: fromHint('Така по-лесно ще намерим мястото.'),
              control: (hid) => screenSelect('s27-greshka-from', info.from, hid),
            })}
            {fld({
              id: 's27-greshka-val',
              label: 'Кое число или кой текст?',
              optional: true,
              hint: info.val
                ? 'Попълнихме го от мястото, откъдето дойде.'
                : 'Например числото, както го виждаш на екрана.',
              control: (hid) => (
                <input
                  className="input"
                  id="s27-greshka-val"
                  name="val"
                  type="text"
                  maxLength={120}
                  defaultValue={info.val}
                  aria-describedby={`${hid} s27-greshka-val-err`}
                />
              ),
            })}
          </div>
          {info.src
            ? facts([{ k: 'Източник на числото', v: srcShort(info.src) }], { cls: 's27-src' })
            : null}
        </>
      );
    else if (key === 'neyasno')
      rest = fld({
        id: 's27-neyasno-from',
        label: 'За кой екран?',
        optional: true,
        hint: fromHint('Така по-лесно ще видим къде е неясно.'),
        control: (hid) => screenSelect('s27-neyasno-from', info.from, hid),
      });
    else
      rest = (
        <div className="s27-pair">
          {fld({
            id: 's27-ideya-topic',
            label: 'За коя част от сайта?',
            optional: true,
            hint: 'Избери най-близкото.',
            control: (hid) => (
              <span className="select">
                <select
                  id="s27-ideya-topic"
                  name="topic"
                  aria-describedby={`${hid} s27-ideya-topic-err`}
                >
                  <option value="">Не знам или е за целия сайт</option>
                  {TOPICS.map((t) => (
                    <option value={t.value} key={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </span>
            ),
          })}
          {fld({
            id: 's27-ideya-contact',
            label: 'Имейл за отговор',
            optional: true,
            hint: 'Само ако искаш да ти отговорим.',
            control: (hid) => (
              <input
                className="input"
                id="s27-ideya-contact"
                name="contact"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={120}
                defaultValue=""
                aria-describedby={`${hid} s27-ideya-contact-err`}
                aria-invalid={invalid('s27-ideya-contact')}
              />
            ),
          })}
        </div>
      );
    return (
      <>
        <p className="s27-intro">{spec.intro}</p>
        <form className="s27-form" data-s27-form={key} noValidate hidden={!!done}>
          {textField(key)}
          {rest}
          <div className="cluster">
            <button type="submit" className="btn btn-primary">
              {SEND}
            </button>
          </div>
        </form>
        <div className="s27-ok" data-s27-ok={key} hidden={!done}>
          <span className="s27-ok-ic" aria-hidden="true">
            {icon('checkCircle', { size: 24 })}
          </span>
          <div className="s27-ok-main">
            <h3 className="s27-ok-h" tabIndex={-1}>
              {SENT}
            </h3>
            <p className="s27-ok-note">
              {to
                ? `Имейлът до ${to} е готов: отвори го и го изпрати от пощата си. Копие остава долу, в „Записано в този браузър“.`
                : 'Изпращането към екипа още не е включено. Записахме съобщението в този браузър: виж го долу, в „Записано в този браузър“.'}
            </p>
            <p className="s27-warn" data-s27-warn="" hidden={!done || done.persisted}>
              {icon('alert', { size: 16 })}
              <span>
                Браузърът не позволява да се пази запис. Съобщението остава само докато не
                презаредиш страницата.
              </span>
            </p>
            <div className="cluster">
              {to ? (
                <a className="btn btn-primary" data-s27-mail="" href={done?.mail || `mailto:${to}`}>
                  {icon('message', { size: 16 })}
                  <span>Отвори имейла</span>
                </a>
              ) : null}
              <button
                type="button"
                className="btn"
                data-s27-again={key}
                onClick={() => {
                  setSent((s) => ({ ...s, [key]: undefined }));
                  setFocus(`#s27-${key}-text`);
                }}
              >
                {to ? 'Изпрати още едно' : 'Напиши още едно'}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  };

  const body = (
    <>
      {to
        ? callout({
            kind: 'info',
            title: 'Как стига до нас',
            body: (
              <p>
                Формулярът подготвя имейл до <a href={`mailto:${to}`}>{to}</a> и го изпращаш от
                своята поща. Копие остава в този браузър. Не пиши лични данни в текста.
              </p>
            ),
          })
        : callout({
            kind: 'info',
            title: 'Изпращането предстои',
            body: <p>Формулярът още не изпраща до екипа: написаното остава само в този браузър.</p>,
          })}
      <section
        className="s27-main"
        aria-labelledby="s27-main-h"
        ref={root}
        onSubmit={onSubmit}
        onInput={onInput}
        onChange={(e) => {
          const c = (e.target as Element).closest('form[data-s27-form] select');
          const f = c instanceof HTMLSelectElement ? c.form : null;
          if (f) saveDraft(f);
        }}
        onKeyDown={(e) => {
          const t = e.target as Element;
          if (
            e.key === 'Enter' &&
            (e.ctrlKey || e.metaKey) &&
            t instanceof HTMLTextAreaElement &&
            t.matches('form[data-s27-form] textarea')
          ) {
            e.preventDefault();
            t.form?.requestSubmit();
          }
        }}
      >
        <h2 id="s27-main-h">Какво искаш да ни кажеш?</h2>
        <Tabs
          id="s27-tabs"
          label="Вид съобщение"
          query="tab"
          active={activeKey(model.query)}
          tabs={KEYS.map((k) => ({ key: k, label: FORMS[k].tab, body: formOf(k) }))}
          onSelect={(key) => navigation.setQuery?.({ tab: key }, { rerender: false })}
        />
      </section>
      <section className="s27-saved" aria-labelledby="s27-saved-h">
        <h2 id="s27-saved-h" tabIndex={-1}>
          Записано в този браузър
        </h2>
        <p className="s27-saved-note">
          Нищо не напуска устройството ти. Съобщенията стоят в паметта на този браузър и можеш да ги
          изчистиш, когато поискаш.
        </p>
        <div className="s27-saved-bar">
          <p className="s27-saved-count" id="s27-saved-count">
            {savedCount(items.length)}
          </p>
          <button
            type="button"
            className="btn btn-sm"
            data-s27-clear=""
            hidden={!items.length}
            onClick={() => {
              feedback.clear();
              setItems([]);
              setFocus('#s27-saved-h');
              navigation.announce('Изчистено. В този браузър няма записани съобщения.');
            }}
          >
            Изчисти всичко
          </button>
        </div>
        <div id="s27-saved-body">
          {items.length ? (
            <ol className="s27-saved-list">{items.map(savedItem)}</ol>
          ) : (
            <p className="s27-saved-empty">
              Тук ще видиш съобщенията, които {to ? 'изпратиш' : 'запазиш'} от тази страница.
            </p>
          )}
        </div>
      </section>
    </>
  );

  return (
    <PageFrame model={model} lede={lede}>
      {compactText(body)}
    </PageFrame>
  );
}
