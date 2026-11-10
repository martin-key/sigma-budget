import { Check } from './checks.js';
import type { Context } from './context.js';

/** Monthly reports describe the last calendar day of their stated month. */
export function feedMonthEnds(ctx: Context): Check {
  const c = new Check('FEED_MONTH_END'),
    ex = ctx.get('execution.json'),
    f = ctx.get('feed.json');
  const months = ex.data['2026'].months;
  if (!Number.isInteger(months) || months < 0 || months > 12)
    throw new Error('invalid number of 2026 report months');
  for (let month = 1; month <= months; month++) {
    const last = new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
    const id = `kfp-2026-${String(month).padStart(2, '0')}`;
    const events = f.events.filter((event: any) => event.id === id);
    c.ok(
      ex.data['2026'].asOf[month - 1] === last && events.length === 1 && events[0].date === last,
      `report ${id}: dataset and event must use month end ${last}`,
    );
  }
  return c;
}
