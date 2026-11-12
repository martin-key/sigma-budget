// Feedback box. The forms of S03 („Още не разбирам“) and S27 (three forms) keep what a visitor sent in this browser, through `safe`
// (localStorage, key bns.feedback.v1; in memory until reload when storage is blocked), and prepare an e-mail to the team: mailto(rec).
// The site has no server that receives messages: the visitor sends the e-mail from their own mail app, to <meta name="feedback-email">.
// Without that address the forms only keep the message here and say so (to() is '').
//   add({type, text, ...context})  -> the stored record (always returns one; `persisted` says whether it reached localStorage)
//   list()                         -> records, newest first
//   clear()                        -> forget them all
//   mailto(rec)                    -> 'mailto:…' with the message and its context, or '' without an address
//   send()                         -> the label of the submit button: without an address nothing is sent, so it says where the message goes
//   sent()                         -> the one success sentence (PLAN S27)
//   to()                           -> the team's address (the server's FEEDBACK_EMAIL or <meta name="feedback-email">), or ''
//   TYPES                          -> {error, unclear, idea} -> visible form names
import { safe } from './store.js';
import { serverScope } from './env.js';

export const KEY = 'bns.feedback.v1';
/** the team's address: the server request's FEEDBACK_EMAIL when drawn on the server, else <meta name="feedback-email">; '' without one */
export const to = () =>
  String(
    serverScope()?.feedbackEmail ??
      (typeof document === 'undefined'
        ? ''
        : document.querySelector('meta[name="feedback-email"]')?.content) ??
      '',
  ).trim();
export const send = () => (to() ? 'Изпрати' : 'Запази в този браузър');
export const sent = () =>
  to() ? 'Благодарим. Остава да изпратиш имейла.' : 'Благодарим. Записахме го в този браузър.';
export const TYPES = { error: 'Намерих грешка', unclear: 'Още не разбирам', idea: 'Предложи идея' };
export const MAX_TEXT = 1000;

const CAP = 30; // newest records kept
const FIELDS = ['route', 'term', 'from', 'block', 'val', 'src', 'topic', 'contact'];
let mem = [];

const clean = (v, n = 300) =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '';

function read() {
  try {
    const a = JSON.parse(safe.get('localStorage', KEY) || '[]');
    return Array.isArray(a)
      ? a.filter((r) => r && typeof r === 'object' && typeof r.text === 'string' && TYPES[r.type])
      : [];
  } catch {
    return [];
  }
}

export function list() {
  const stored = read();
  const ids = new Set(stored.map((r) => r.id));
  return [...stored, ...mem.filter((r) => !ids.has(r.id))].sort((a, b) =>
    String(b.at).localeCompare(String(a.at)),
  );
}

export function add(entry = {}) {
  const rec = {
    id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type: TYPES[entry.type] ? entry.type : 'unclear',
    text: String(entry.text ?? '')
      .replace(/\r\n?/g, '\n')
      .trim()
      .slice(0, MAX_TEXT),
    at: new Date().toISOString(),
  };
  for (const f of FIELDS) {
    const v = clean(entry[f]);
    if (v) rec[f] = v;
  }
  const next = [rec, ...read()].slice(0, CAP);
  const persisted = safe.set('localStorage', KEY, JSON.stringify(next));
  if (!persisted) mem = [rec, ...mem].slice(0, CAP);
  return { ...rec, persisted };
}

export function clear() {
  safe.del('localStorage', KEY);
  mem = [];
}

const LABEL = {
  from: 'Екран',
  val: 'Число или текст',
  src: 'Източник',
  block: 'Блок',
  topic: 'Част от сайта',
  term: 'Термин',
  contact: 'Имейл за отговор',
};
/** the e-mail the visitor sends from their own mail app: subject „[СИГМА Бюджет] <form>“, the text, then the context lines and the page */
export function mailto(rec) {
  const TO = to();
  if (!TO || !rec) return '';
  const lines = [
    rec.text,
    '',
    ...Object.keys(LABEL)
      .filter((k) => rec[k])
      .map((k) => `${LABEL[k]}: ${rec[k]}`),
    `Страница: ${location.href}`,
  ];
  const q = `subject=${encodeURIComponent(`[СИГМА Бюджет] ${TYPES[rec.type] || 'Съобщение'}`)}&body=${encodeURIComponent(lines.join('\n'))}`;
  return `mailto:${encodeURIComponent(TO).replace(/%40/g, '@')}?${q}`;
}
