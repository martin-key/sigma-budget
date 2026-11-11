// One vocabulary and resolver for the URL, request state, selector and historical bookmarks.
export const DEFAULT_PERIOD = '2027.draft';
export const PERIODS = [
  { key: '2024.report', year: 2024, status: 'report', vintage: 'actual', label: '2024 · Отчет', desc: 'Отчетени данни' },
  { key: '2025.report', year: 2025, status: 'report', vintage: 'actual', label: '2025 · Отчет', desc: 'Всяка серия пази статуса на отчета при издателя' },
  { key: '2026.law', year: 2026, status: 'law', vintage: 'plan', label: '2026 · Закон', desc: 'Приетият Закон за държавния бюджет' },
  { key: '2026.expected', year: 2026, status: 'expected', vintage: 'expected', label: '2026 · Очаквано', desc: 'Оценка на МФ от 06.11.2026, не отчет' },
  { key: '2027.draft', year: 2027, status: 'draft', vintage: 'plan', label: '2027 · Законопроект', desc: 'Законопроект на МФ от 06.11.2026' },
  { key: '2028.forecast', year: 2028, status: 'forecast', vintage: 'forecast', label: '2028 · Прогноза', desc: 'АСБП 2027–2029 от 06.11.2026' },
  { key: '2029.forecast', year: 2029, status: 'forecast', vintage: 'forecast', label: '2029 · Прогноза', desc: 'АСБП 2027–2029 от 06.11.2026' },
];
const notices = {
  '2026.draft': 'Старият адрес избираше проекта за 2026. Показан е приетият закон за 2026.',
  '2027.forecast': 'Прогнозата за 2027 е заменена с проекта, публикуван на 06.11.2026.',
  '2028.forecast': 'Прогнозата за 2028 е обновена с АСБП 2027–2029 от 06.11.2026.',
};
export function resolvePeriod(requested) {
  const aliases = { '2026.draft': '2026.law', '2027.forecast': '2027.draft' };
  const key = Object.hasOwn(aliases, requested) ? aliases[requested] : requested;
  const known = PERIODS.some(p => p.key === key);
  return { requested: requested ?? null, resolved: known ? key : DEFAULT_PERIOD,
    notice: (Object.hasOwn(notices, requested) ? notices[requested] : '') || (requested != null && !known ? `Непознат период „${requested}“. Показан е проектът за 2027.` : '') };
}
export const periodByKey = key => PERIODS.find(p => p.key === resolvePeriod(key).resolved);

/** Pure, release-local read. A legacy physical column is read only with its actual publication status. */
export function selectPeriod(dataset, key) {
  const period = Object.hasOwn(dataset?.byPeriod || {}, key) ? dataset.byPeriod[key] : undefined;
  if (period?.periodKey === key) return { available: true, ...period, legacy: false };
  // Report columns predate byPeriod. Do not recycle old plan/forecast columns as new vintages.
  if (key === '2024.report' || key === '2025.report') {
    const year = Number(key.slice(0, 4));
    const legacy = dataset?.economic || dataset;
    const i = legacy?.years?.findIndex((y, n) => y === year && ['actual', 'prelim'].includes(legacy.vintage?.[n]));
    if (i >= 0) return { available: true, periodKey: key, year, status: 'report', vintage: legacy.vintage[i],
      publication: dataset.meta?.asOf, sourceRefs: dataset.meta?.source || [], legacy: true, column: i };
  }
  return { available: false, periodKey: key, reason: 'Това издание няма този период', historical: !!dataset && !dataset.byPeriod };
}

/** Called after client takeover. No storage read affects SSR or hydration. URL and explicit controls always win, including a default choice without ?per. */
export function migratePeriod({ address, get, set, replace, explicitSelection = false }) {
  try {
    const saved = JSON.parse(get('bns.prefs.v1') || '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved) || !Object.hasOwn(saved, 'period')) return null;
    const url = new URL(address);
    const hash = url.hash.startsWith('#/') ? new URL(url.hash.slice(1), url.origin) : null;
    const view = hash || url;
    const requested = saved.period;
    const result = resolvePeriod(typeof requested === 'string' ? requested : null);
    let applied = false;
    if (!explicitSelection && !view.searchParams.has('per') && typeof requested === 'string' && ['2026.draft', '2027.forecast', '2028.forecast'].includes(requested)) {
      view.searchParams.set('per', result.resolved);
      if (hash) url.hash = view.pathname + view.search;
      replace(url.href); applied = true; // a failed replace must leave the preference intact for another attempt
    }
    delete saved.period;
    try { set('bns.prefs.v1', JSON.stringify(saved)); } catch { /* URL replacement already succeeded; keep its notice. */ }
    return applied ? result : null;
  } catch { return null; }
}
