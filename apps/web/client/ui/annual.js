import { annualSource } from './annual-source.js';
import { html } from '../html.js';
import { dataTable } from './table.js';
import { block } from './block.js';
import { selectPeriod } from '../periods.js';
export function annualGap(ctx, dataset, fields = []) {
  const p = selectPeriod(dataset, ctx.period.key);
  const reasons = p.available ? fields.map(f => p.gaps?.[f]).filter(Boolean) : [p.reason];
  const path = ctx.href(ctx.route.id, ctx.params, { ...ctx.query, per: ctx.period.key });
  const rows = p.available ? (p.rows || []).map(r => ({ label: r.label, amount: r.cell.value,
    period: p.periodKey, provenance: r.cell.provenance })) : [];
  return block({ id: `${ctx.route.id.toLowerCase()}-annual-coverage`, title: p.available ? ctx.period.label : 'Това издание няма този период',
    status: p.available ? 'real' : 'pending', share: rows.length > 0, source: p.available ? p.sourceRefs : [],
    asOf: p.publication, body: html`<p>${annualSource(ctx, dataset)}</p><p>${reasons.join(' ') || 'Няма съпоставими данни за избрания период в този изглед.'}</p>
    ${p.historical ? html`<p>Старите годишни колони са историческата публикация на проекта и прогнозите; не са приет закон.</p>` : ''}
    ${rows.length ? dataTable({ id: 'annual-source-rows', columns: [{key:'label',label:'Показател'}, {key:'amount',label:'Сума',unit:'млн. €',num:true,d:1}, {key:'period',label:'Период'}, {key:'provenance',label:'Произход'}], rows }) : ''}
    ${p.available ? html`<p><a href="${ctx.href(ctx.route.id, ctx.params, { ...ctx.query, per: '2026.expected' })}">Виж очакваното изпълнение на МФ</a></p>` : html`<p><a href="${path}" data-current-release>Отвори текущото издание</a></p>`}` });
}
