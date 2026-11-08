// The monthly-report model (V5): everything the start screen and the "Изпълнение" screen print about the monthly reports of the КФП,
// derived once from execution.json (D06/D16/D26). Pure functions: no DOM, no html. Every number comes from the file; nothing is typed.
//   execModel(ex, query) → { years, g1, g2, n1, n2, month, scope, mode, val(y,row,i), … }
// Query keys of the screen: mesec (1-12; default = the latest reported month of g2, `defMonth`), obhvat (kfp|nat|eu), rez (natrupano|mesec), g1 (the earlier year), g2 (the later year, default = the latest).
// "За месеца" is the difference of two adjacent cumulative reports (January = the first value) — it is computed here from the reports,
// never taken from a different series; "Натрупано" is the report itself. A month is never compared with a cumulative value.

export const SCOPES = [['kfp', 'КФП'], ['nat', 'Национален бюджет'], ['eu', 'Средства от ЕС']];
export const SCOPE_NAME = { kfp: 'КФП', nat: 'национален бюджет', eu: 'средства от ЕС' };
export const SCOPE_IN = { kfp: 'в КФП', nat: 'в националния бюджет', eu: 'по средствата от ЕС' };
export const MODES = [{ value: 'natrupano', label: 'Натрупано' }, { value: 'mesec', label: 'За месеца' }];
export const REV_ROWS = ['rev.tax', 'rev.nontax', 'rev.grants'];
export const EXP_ROWS = ['exp.personnel', 'exp.maint', 'exp.interest', 'exp.social', 'exp.subsidies', 'exp.capex', 'exp.abroad', 'exp.reserve'];
export const EARLIEST_REPORT = 2022;      // core.pending P05: the monthly reports from this year up to the first year in the file are still to come

export const fin = v => typeof v === 'number' && Number.isFinite(v);
/** change in % from a to b, only on a positive base: a deficit or a zero gives null (no percent on a non-positive base) */
export const pctChange = (a, b) => (fin(a) && fin(b) && a > 0 && b >= 0 ? (b / a - 1) * 100 : null);
export const mlrd = v => (fin(v) ? v / 1000 : null);
const isoLast = (y, m) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

export function execModel(ex, q = {}) {
  const data = ex.data || {};
  const years = Object.keys(data).map(Number).filter(fin).sort((a, b) => a - b);
  const lastY = years[years.length - 1];
  const yearOf = (v, def) => { const s = v == null ? '' : String(v).trim(); return s === '' ? def : /^\d{4}$/.test(s) ? Number(s) : s; };
  const g2 = yearOf(q.g2, lastY);
  const earlier = years.filter(y => typeof g2 === 'number' && y < g2);
  const g1 = yearOf(q.g1, earlier.length ? earlier[earlier.length - 1] : (typeof g2 === 'number' && years.includes(g2 - 1) ? g2 - 1 : lastY));
  const has = y => typeof y === 'number' && years.includes(y);
  const nOf = y => (has(y) ? data[String(y)].months : 0);
  const n1 = nOf(g1), n2 = nOf(g2);
  const maxM = Math.max(n1, n2) || 12;
  const common = Math.min(n1, n2) || maxM;                  // the latest month both years have a report for
  // The default month is the latest report of the newest year (it moves by itself when a month is added to the file). The earlier year is the previous year, which has
  // at least as many reports, so this is also `common`; a pair picked by hand keeps `common` (the latest month both years have).
  const defMonth = g2 === lastY && n2 >= 1 ? n2 : common;
  const want = Math.floor(Number(q.mesec));
  const month = fin(want) && want >= 1 ? Math.min(want, 12) : defMonth;
  const scope = SCOPES.some(s => s[0] === q.obhvat) ? q.obhvat : 'kfp';
  const mode = MODES.some(m => m.value === q.rez) ? q.rez : 'natrupano';
  const i = month - 1;
  const cumArr = (y, row, sc = scope) => (has(y) && data[String(y)][sc] && data[String(y)][sc][row]) || null;
  const at = (arr, k) => (Array.isArray(arr) && k >= 0 && fin(arr[k]) ? arr[k] : null);
  const cum = (y, row, k = i, sc = scope) => at(cumArr(y, row, sc), k);
  /** the value of the month alone: this cumulative report minus the one before it (January = the first value) */
  const mon = (y, row, k = i, sc = scope) => {
    const a = cumArr(y, row, sc);
    const c = at(a, k);
    if (c == null) return null;
    if (k === 0) return c;
    const p = at(a, k - 1);
    return p == null ? null : c - p;
  };
  const val = (y, row, k = i, sc = scope) => (mode === 'mesec' ? mon(y, row, k, sc) : cum(y, row, k, sc));
  const asOfOf = (y, k = i) => { const b = has(y) ? data[String(y)] : null; return b && Array.isArray(b.asOf) && b.asOf.length ? b.asOf[Math.min(k, b.asOf.length - 1)] : null; };
  const rowName = id => { const r = (ex.rows || []).find(x => x.id === id); return r ? r.short || r.label : id; };
  const bad = [...new Set([g1, g2].filter(y => !has(y)))];
  const problem = bad.length ? 'year' : g1 === g2 ? 'same' : null;
  const missing = [g1, g2].filter(y => has(y) && month > nOf(y));          // a year with no report for the chosen month yet
  const pendingMonths = (ex.pendingMonths || []).map(p => p.month);
  return { ex, years, lastY, g1, g2, n1, n2, maxM, common, defMonth, month, i, scope, mode, has, cum, mon, val, cumArr, at, asOfOf, rowName, bad, problem, missing, pendingMonths, isoLast };
}

/** the headline rows of a model: revenue, expenditure (with the EU contribution), (transfers), balance — for both years, with the changes */
export function headline(E) {
  const out = [];
  const mk = (id, name) => {
    const a = E.val(E.g1, id), b = E.val(E.g2, id);
    return { id, name, a, b, d: fin(a) && fin(b) ? b - a : null, p: pctChange(a, b) };
  };
  out.push(mk('rev', 'Приходи'));
  out.push(mk('exp.total', 'Разходи с вноската в ЕС'));
  if (E.scope !== 'kfp') out.push(mk('transfers', 'Трансфери между бюджетите, нето'));
  out.push(mk('balance', 'Салдо'));
  return out;
}

/** "дефицит" / "излишък" for a balance value */
export const balanceWord = v => (!fin(v) ? '' : v < 0 ? 'дефицит' : v > 0 ? 'излишък' : 'нула');
