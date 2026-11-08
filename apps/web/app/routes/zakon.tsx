import { cached } from '../lib/cache';
import type { RoutePolicy } from '../lib/cache';
import { ROUTES } from '../lib/routes';
import { loader as documentLoader } from './screen';
export { default } from './screen';
export const loader = documentLoader;
export const handle = {
  screen: 'S14',
  query: ['per', 'demo', ...(ROUTES.find((r) => r.id === 'S14')?.query || [])],
  periods: ['2026.draft', '2026.law'],
  cache: { ttl: 86400 },
} as const satisfies RoutePolicy;
export const meta = ({
  data,
}: {
  data?: { doc: { title: string; tags: { tag: string; attrs: Record<string, string> }[] } };
}) =>
  data
    ? [
        { title: data.doc.title },
        ...data.doc.tags.map((t) => (t.tag === 'link' ? { tagName: 'link', ...t.attrs } : t.attrs)),
      ]
    : [];
export const headers = cached(86400);
