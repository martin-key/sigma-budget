import { isBudgetPlan } from './budget-documents.js';
const HISTORICAL_DEBT_EMBEDS = new Set(
  ['maastricht', 'eu', 'quarterly', 'interest', 'balance', 'finance', 'newdebt'].map(
    (id) => 'dalg.s17-' + id,
  ),
);
// s17-zdd and s17-b-zdd are also used by the current bill; their ordinary default stays current.
const HISTORICAL_DEBT_TARGETS = [
  's17-b-balance',
  's17-b-compare',
  's17-b-confuse',
  's17-b-eu',
  's17-b-fin',
  's17-b-fin-table',
  's17-b-guar',
  's17-b-interest',
  's17-b-kpi',
  's17-b-limits',
  's17-b-maastricht',
  's17-b-maturities',
  's17-b-newdebt',
  's17-b-quarterly',
  's17-b-structure',
  's17-balance',
  's17-eu',
  's17-fin-months',
  's17-fin-opp',
  's17-finance',
  's17-guar-sectors',
  's17-interest',
  's17-interest-split',
  's17-issued',
  's17-maastricht',
  's17-meter',
  's17-method',
  's17-newdebt',
  's17-quarterly',
  's17-t-avg',
  's17-t-compare',
  's17-t-fin',
  's17-t-fin-months',
  's17-t-guar',
  's17-t-guar-sectors',
  's17-t-interest',
  's17-t-issued',
  's17-t-limits',
  's17-t-newdebt',
];

/** A shareable display unit; URL values override the browser's saved preference. */
export const viewUnit = (value) => (value === 'eur' || value === 'pct' ? value : null);

/** Resolve publication and display choices before screen identity, SSR, caching and sharing.
 * @param {string | undefined} routeId
 * @param {Record<string, string>} params
 * @param {Record<string, string>} query
 * @returns {Record<string, string>}
 */
export function publicationQuery(routeId, params = {}, query = {}) {
  const result = { ...query };
  if (result.unit != null && !viewUnit(result.unit)) delete result.unit;
  // These introductions always describe the current bill, rather than the session's historical period.
  if (routeId === 'S01' || routeId === 'S04') delete result.per;
  if (routeId === 'S34' && !result.dokument && isBudgetPlan(result)) result.dokument = 'plan';
  if (result.per == null) {
    const historicDebtTarget =
      routeId === 'S17' &&
      HISTORICAL_DEBT_TARGETS.some(
        (id) => result.to === id || String(result.to || '').startsWith(id + '-'),
      );
    const historicDebtEmbed = routeId === 'S29' && HISTORICAL_DEBT_EMBEDS.has(params.chart);
    if (historicDebtTarget || historicDebtEmbed) result.per = '2026.law';
  }
  if (
    routeId === 'S17' &&
    result.obhvat == null &&
    /^s17-(?:(?:b-)?(?:maastricht|quarterly|eu)|meter)(?:-|$)/.test(result.to || '')
  )
    result.obhvat = 'maastricht';
  return result;
}
