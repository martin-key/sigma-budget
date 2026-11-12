// Data status (plan 2.2 / DATA_SPEC §1): real | partial | pending | mock | forecast.
// A status is never colour alone: every pill carries an icon and words; mock is also hatched (▨).
//   statusPill('mock')  ·  statusPill('real', {label:'Към 31.07.2026'})  ·  openLegend()
import { html } from '../html.js';
import { icon } from '../icons.js';
import { sheet } from './sheet.js';

export const STATUS = {
  real: {
    label: 'Официални данни',
    icon: 'checkCircle',
    text: 'Взети от официален източник. Показваме откъде са и към коя дата.',
  },
  partial: {
    label: 'Частични данни',
    icon: 'partial',
    text: 'Част от показателя е официална, друга част още липсва или е изчислена. Бележката до числото казва коя.',
  },
  forecast: {
    label: 'Прогноза',
    icon: 'forecast',
    text: 'Официална оценка за бъдещи години. Това не е отчет и може да се промени.',
  },
  mock: {
    label: 'Примерни данни',
    icon: 'hatch',
    text: 'Измислени стойности, които показват как ще изглежда екранът. Не са истински и не бива да се цитират. Белязани са със щриховка ▨.',
  },
  pending: {
    label: 'Няма данни',
    icon: 'dashed',
    text: 'Не показваме число без налични официални данни за този показател.',
  },
};
const ORDER = ['real', 'partial', 'forecast', 'pending'];
export const statusLabel = (s) => (STATUS[s] || STATUS.pending).label;

/** statusPill('real') -> <span class="st" data-st="real">✓ Официални данни</span> */
export function statusPill(status, o = {}) {
  const key = status in STATUS ? status : 'pending';
  const s = STATUS[key];
  return html`<span class="st" data-st="${key}">${icon(s.icon, { size: 14 })}<span>${o.label || s.label}</span></span>`;
}

/** the legend as a list (also the body of the „Легенда“ sheet) */
export function legendBody() {
  return html`<ul class="legend-list">${ORDER.map((k) => html`<li>${statusPill(k)}<p class="small">${STATUS[k].text}</p></li>`)}</ul>
    <p class="small muted">Обхватът (КФП, национален бюджет, ЕС средства, ЗДД, Маастрихт) е показан с етикет до всяко число. Натисни етикета, за да прочетеш какво означава.</p>`;
}
export const openLegend = (returnFocus) =>
  sheet.open({ title: 'Легенда: какво означават белезите', body: legendBody(), returnFocus });
