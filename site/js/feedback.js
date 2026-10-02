// Feedback box of the Mock. Nothing is sent anywhere: the forms of S03 („Още не разбирам“) and S27 (three forms) keep what a visitor
// "sent" in this browser only, through `safe` (localStorage, key bns.feedback.v1). If storage is blocked the entries live in memory until reload.
//   add({type, text, ...context})  -> the stored record (always returns one; `persisted` says whether it reached localStorage)
//   list()                         -> records, newest first
//   clear()                        -> forget them all
//   SENT                           -> the one success sentence of the Mock (PLAN S27)
//   TYPES                          -> {error, unclear, idea} -> visible form names
import { safe } from './store.js';

export const KEY = 'bns.feedback.v1';
export const SENT = 'Благодарим. В истинското приложение това отива при екипа.';
export const TYPES = { error: 'Намерих грешка', unclear: 'Още не разбирам', idea: 'Предложи идея' };
export const MAX_TEXT = 1000;

const CAP = 30;                 // newest records kept
const FIELDS = ['route', 'term', 'from', 'block', 'val', 'src', 'topic', 'contact'];
let mem = [];

const clean = (v, n = 300) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');

function read() {
  try {
    const a = JSON.parse(safe.get('localStorage', KEY) || '[]');
    return Array.isArray(a) ? a.filter(r => r && typeof r === 'object' && typeof r.text === 'string' && TYPES[r.type]) : [];
  } catch { return []; }
}

export function list() {
  const stored = read();
  const ids = new Set(stored.map(r => r.id));
  return [...stored, ...mem.filter(r => !ids.has(r.id))].sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

export function add(entry = {}) {
  const rec = {
    id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    type: TYPES[entry.type] ? entry.type : 'unclear',
    text: String(entry.text ?? '').replace(/\r\n?/g, '\n').trim().slice(0, MAX_TEXT),
    at: new Date().toISOString()
  };
  for (const f of FIELDS) { const v = clean(entry[f]); if (v) rec[f] = v; }
  const next = [rec, ...read()].slice(0, CAP);
  const persisted = safe.set('localStorage', KEY, JSON.stringify(next));
  if (!persisted) mem = [rec, ...mem].slice(0, CAP);
  return { ...rec, persisted };
}

export function clear() { safe.del('localStorage', KEY); mem = []; }
