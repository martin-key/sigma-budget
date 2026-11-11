import type { ReactNode } from 'react';
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="shell">
      <main className="main" id="main" tabIndex={-1}>
        <div className="view" id="view">
          {children}
        </div>
      </main>
    </div>
  );
}
import { topbarHtml, navHtml, footerHtml, tabbarHtml } from './chrome';
import type { WebRoute } from '../../lib/routes';
export function TopBar(props: { route?: WebRoute; periods?: WebRoute['periods'] }) {
  return topbarHtml(props);
}
export function DesktopMenu({ route }: { route?: WebRoute }) {
  return navHtml(route);
}
export function Footer(props: { cur?: string; wide?: boolean; from?: string }) {
  return footerHtml(props);
}
export function BottomNav({ route }: { route?: WebRoute }) {
  return tabbarHtml(route);
}
