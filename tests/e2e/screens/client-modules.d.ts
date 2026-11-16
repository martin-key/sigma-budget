declare module '*/client/chrome.js' {
  import type { WebRoute } from '../../../apps/web/app/lib/routes.ts';
  export function groupItems(ids: string[]): WebRoute[];
  export function navName(route: WebRoute): string;
  export const NAV_GROUPS: [string, string[]][];
}
declare module '*/client/routes.js' {
  export function match(parts: string[]): { route: { id: string } } | null;
}
