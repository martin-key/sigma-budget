import { isBudgetPlan } from './budget-documents.js';

/** Resolve legacy publication choices before screen identity, SSR, caching and sharing.
 * @param {string | undefined} routeId
 * @param {Record<string, string>} params
 * @param {Record<string, string>} query
 * @returns {Record<string, string>}
 */
export function publicationQuery(routeId, params = {}, query = {}) {
  const result = { ...query };
  // These introductions always describe the current bill, rather than the session's historical period.
  if (routeId === 'S01' || routeId === 'S04') delete result.per;
  if (routeId === 'S34' && !result.dokument && isBudgetPlan(result)) result.dokument = 'plan';
  if (result.per == null) {
    const historicDebtTarget = routeId === 'S17' && /^(?:s17-b-maastricht|s17-b-quarterly)(?:-|$)/.test(result.to || '');
    const historicDebtEmbed = routeId === 'S29' && ['dalg.s17-maastricht', 'dalg.s17-quarterly'].includes(params.chart);
    if (historicDebtTarget || historicDebtEmbed) result.per = '2026.law';
  }
  return result;
}
