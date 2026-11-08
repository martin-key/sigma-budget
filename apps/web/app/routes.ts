// One route for every screen of apps/web/client/routes.js (27), and a catch-all for the rest (an old address, a mistyped one: the 404 screen).
// They share one module: the screen comes from the address itself (apps/web/client/render.js resolve), so an old or non-canonical address is
// redirected exactly as the browser rewrites it.
import { type RouteConfig, index, route } from '@react-router/dev/routes';
import { ROUTES } from '../client/routes.js';

const SCREEN = 'routes/screen.tsx';
// apps/web/client/routes.js pattern grammar -> React Router: /izpalnenie/:sub(byudzheti)? -> izpalnenie/:sub?
const toPath = (p: string) => p.replace(/^\//, '').replace(/:(\w+)\([^)]*\)/g, ':$1');

export default [
  ...ROUTES.filter((r) => r.pattern).map((r) =>
    r.pattern === '/'
      ? index(SCREEN, { id: r.id })
      : route(toPath(r.pattern!), r.id === 'S26' ? 'routes/za-proekta.tsx' : SCREEN, { id: r.id }),
  ),
  route('*', 'routes/not-found.tsx', { id: 'other' }),
] satisfies RouteConfig;
