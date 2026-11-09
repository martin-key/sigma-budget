import { isDeepStrictEqual } from 'node:util';
import { Check, pyRepr } from './checks.js';
import { feedEvents } from './feed-events.js';
import { feedRest } from './feed-rest.js';
import { feedXml } from './feed-xml.js';
import { iterable, length, listLike, required } from './feed-python.js';
import type { Context } from './context.js';

/** Independent checks against owning datasets and the RSS document. */
export function feed(ctx: Context): Check {
  const c = new Check('FEED'),
    f = ctx.get('feed.json');
  iterable(f);
  const keys = listLike(f).sort();
  c.ok(
    isDeepStrictEqual(
      keys,
      ['meta', 'kinds', 'dateKinds', 'events', 'expected', 'highlights', 'sentences'].sort(),
    ),
    `feed keys ${pyRepr(keys)}`,
  );
  feedEvents(c, f, ctx);
  feedRest(c, f, ctx);
  feedXml(c, f, ctx);
  c.fact(
    `${length(f.events)} events, ${length(f.kinds)} kinds, the newest on ${required(f.events[0], 'date')}; ${length(f.expected)} announced`,
  );
  return c;
}
