import { ROUTES } from '../../../apps/web/app/lib/routes.ts';
import { PERIODS } from '../../../apps/web/client/periods.js';
export const routes = ROUTES.map((route) => ({
  ...route,
  samples: route.samples.length ? route.samples : ['#/nyama-takava'],
}));
export const displays = ['desktop', 'touch'] as const;
export const auditCases = routes.flatMap((route) =>
  route.samples.flatMap((address) =>
    displays.map((display) => ({ route: route.id, address, display })),
  ),
);
export const stateCases = routes.flatMap((route) =>
  ['loading', 'empty', 'error', 'pending', 'offline'].flatMap((state) =>
    (['S01', 'S06', 'S28'].includes(route.id) ? displays : displays.slice(0, 1)).map((display) => ({
      route: route.id,
      address: route.samples[0]!,
      state,
      display,
    })),
  ),
);
export const periodCases = routes
  .filter((route) => route.periods !== 'none')
  .flatMap((route, index) =>
    PERIODS.map((period, offset) => ({
      route: route.id,
      address: route.samples[0]!,
      period: period.key,
      supported: route.periods === 'all' || route.periods.includes(period.key),
      display: displays[(index * PERIODS.length + offset + 1) % 2]!,
    })),
  );
export function withQuery(address: string, values: Record<string, string>) {
  const [path, query] = address.split('?');
  const params = new URLSearchParams(query);
  for (const [key, value] of Object.entries(values)) params.set(key, value);
  return path + '?' + params.toString();
}
