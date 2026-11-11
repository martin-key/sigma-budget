// A tiny "remember this in the browser" helper for screens that let the visitor set something up and come back to it.
// Nothing leaves the browser: it is localStorage only, through the safe wrapper of store.js, so a blocked or full store never throws.
//
// API (every function is safe to call anywhere; none of them ever throws):
//   get(slot)        -> { data, at } | null   the saved value (any JSON) and the ISO time it was saved; null when nothing usable is stored
//   set(slot, data)  -> boolean               true only when the value is stored AND reads back unchanged; false when the browser refuses
//                                             (private window, blocked site data, store full) or the value is larger than MAX
//   remove(slot)     -> void                  forget one slot
//   KEY, MAX         the one namespaced key that holds every slot as a JSON object, and its size cap in characters
// `slot` is a short lowercase id (letters, digits, hyphen; up to 40), usually the key of the screen, e.g. 'moyat-byudzhet'.
// The whole store lives under the single key KEY. If it holds anything unexpected it is read as empty and overwritten by the next set().
import { safe } from '../store.js';

export const KEY = 'bns.saved.v1';
export const MAX = 20000;
const SLOT = /^[a-z0-9-]{1,40}$/;
/** a slot id is a string of that shape; RegExp.test would otherwise turn undefined into the text "undefined" and accept it */
const okSlot = (s) => typeof s === 'string' && SLOT.test(s);

/** the whole store as a plain object; {} when missing, blocked or damaged */
function read() {
  try {
    const raw = safe.get('localStorage', KEY);
    if (!raw) return {};
    const all = JSON.parse(raw);
    return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
  } catch {
    return {};
  }
}

export function get(slot) {
  try {
    if (!okSlot(slot)) return null;
    const all = read();
    if (!Object.hasOwn(all, slot)) return null;
    const rec = all[slot];
    if (!rec || typeof rec !== 'object' || typeof rec.at !== 'string' || !('data' in rec))
      return null;
    return { data: rec.data, at: rec.at };
  } catch {
    return null;
  }
}

export function set(slot, data) {
  try {
    if (!okSlot(slot)) return false;
    const all = read();
    all[slot] = { at: new Date().toISOString(), data };
    const text = JSON.stringify(all);
    if (typeof text !== 'string' || text.length > MAX) return false;
    return safe.set('localStorage', KEY, text) === true && safe.get('localStorage', KEY) === text;
  } catch {
    return false;
  }
}

export function remove(slot) {
  try {
    if (!okSlot(slot)) return;
    const all = read();
    if (!Object.hasOwn(all, slot)) return;
    delete all[slot];
    if (Object.keys(all).length) safe.set('localStorage', KEY, JSON.stringify(all));
    else safe.del('localStorage', KEY);
  } catch {
    /* nothing to do */
  }
}
