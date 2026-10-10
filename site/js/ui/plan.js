// The plan block, shared by «Начало» (S01) and «Изпълнение» (S15): «Изпълнение на плана за 2026 г.» (working-group feedback, 2026-10-09; on the start page 2026-10-10).
//   planModel(C)        → { month, asOf, rows:[{id, name, kind, verb, cum, plan, share, earlier}] } | null   C = a model of js/exec.js (execModel)
//   planBlock(C, {link})→ the block: three bars (приходи, разходи, капиталови разходи), the latest report against the annual plan
// КФП only, independent of the controls of S15; neutral colours, no „lagging“ verdict (UX V2 §7: % от плана е вторичен блок с точния документ и знаменател).
// Every number comes from execution.json (D06/D16/D26) through the model; none is typed in. Styles: css/components.css («Изпълнение на плана»).
import { html } from '../html.js';
import { num, pct, date, monthName, EUR_RATE, NBSP, DASH } from '../format.js';
import { block } from './block.js';
import { progress } from './progress.js';
import { store } from '../store.js';
import { fin } from '../exec.js';

const B = v => (fin(v) ? num(v / 1000, 2) : DASH);
const joinBg = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}` : String(xs.length ? xs[0] : ''));
const monthsTo = month => (month === 1 ? 'януари' : `януари${DASH}${monthName(month)}`);

const PLAN_ROWS = [
  { id: 'rev', name: 'Приходи', kind: 'revenue', verb: 'събрано' },
  { id: 'exp.total', name: 'Разходи с вноската в ЕС', kind: 'expenditure', verb: 'изразходвано' },
  { id: 'exp.capex', name: 'Капиталови разходи', kind: 'expenditure', verb: 'изразходвано' },
];
/** the rows of the plan block: null when the latest report or the plan is missing */
export function planModel(C) {
  const L = C.ex && C.ex.latest, K = L && L.kfp;
  if (!K || !fin(L.month)) return null;
  const rows = PLAN_ROWS.map(r => {
    const v = K[r.id] || {};
    const share = fin(v.cum) && fin(v.plan) && v.plan > 0 ? (v.cum / v.plan) * 100 : null;
    const earlier = ['2025', '2024'].map(y => {
      const a = C.ex.pace && C.ex.pace[y] && C.ex.pace[y][r.id];
      return Array.isArray(a) && fin(a[L.month - 1]) ? { year: y, share: a[L.month - 1] } : null;
    }).filter(Boolean);
    return { ...r, cum: v.cum, plan: v.plan, share, earlier };
  });
  return rows.every(r => fin(r.share)) ? { month: L.month, asOf: L.asOf, rows } : null;
}
const planCsv = P => ({
  columns: ['Показател', `Отчет към ${P.asOf}, млрд. €`, 'План за 2026 г., млрд. €', 'Дял от плана, %'],
  rows: P.rows.map(r => [r.name, Math.round(r.cum) / 1000, Math.round(r.plan) / 1000, Math.round(r.share * 10) / 10]),
});
function planRow(P, r) {
  const lev = store.get('leva') ? html`<span class="s15-lev">≈${NBSP}${num((r.cum / 1000) * EUR_RATE, 2)} от ${num((r.plan / 1000) * EUR_RATE, 2)}${NBSP}млрд. лв.</span>` : '';
  const before = r.earlier.length ? `За сравнение, към края на ${monthName(P.month)} вече е било ${r.verb}: ${joinBg(r.earlier.map(e => `${pct(e.share, 0)} през ${e.year}${NBSP}г.`))} от цялата година.` : '';
  const id = `s15-plan-${r.id.replace('.', '-')}`;
  return html`<li class="s15-plan-row" data-kind="${r.kind}">
    ${progress({ id, cls: 's15-prog', label: r.name, value: r.share, text: `${pct(r.share, 1)} от плана` })}
    <p class="s15-plan-fig">${B(r.cum)}${NBSP}млрд.${NBSP}€ от${NBSP}${B(r.plan)}${NBSP}млрд.${NBSP}€${lev}</p>
    ${before ? html`<p class="s15-plan-before small muted">${before}</p>` : ''}
  </li>`;
}
export function planBlock(C, o = {}) {
  const P = planModel(C);
  if (!P) return '';
  const words = `КФП, ${monthsTo(P.month)} 2026 г.: ${P.rows.map(r => `${r.name.toLowerCase()} ${pct(r.share, 1)} от плана`).join(', ')}.`;
  return block({
    id: 's15-b-plan', level: 2, cls: 's15-planblock', scope: 'kfp', source: ['kfp', 'asbp'], asOf: P.asOf, status: 'real', statusLabel: 'Отчет спрямо проект',
    title: 'Изпълнение на плана за 2026 г.',
    sub: `Последният отчет, към ${date(P.asOf, true)}, спрямо плана за цялата година. КФП, млрд.${NBSP}€.`,
    share: { text: words, table: () => planCsv(P), link: o.link, period: `${monthsTo(P.month)} 2026 г. · млрд. €` },
    body: html`<div class="s15-plan-wrap"><ul class="s15-plan" aria-label="Изпълнение на плана за 2026 г.">${P.rows.map(r => planRow(P, r))}</ul></div>
      <p class="table-note small muted">Планът е „Проект“ към законопроекта за бюджета (мотиви на МФ, Приложение 3, внесен на 01.07.2026 г.); приетият закон може да се различава. Процентът е отчетът към края на месеца, разделен на плана за цялата 2026 г. Приходите и разходите не са равномерни през годината, затова няма „правилен“ процент за месеца. Разходите включват вноската в бюджета на ЕС.</p>`,
  });
}
