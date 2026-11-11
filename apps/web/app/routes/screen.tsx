// A screen: its loader draws it from the release of the request (apps/web/app/lib/screen.server.ts); the component puts the drawn parts into the
// body of the document, in the same elements as apps/web/public/index.html, which apps/web/client/main.js expects.
import { data, redirect, useLocation } from 'react-router';
import type { Route } from './+types/screen';
import { ROUTES } from '../lib/routes';
import { AppShell, TopBar, Footer, BottomNav } from '../components/chrome/AppShell';
import { MigratedScreen, safeJSON } from '../migration/registry';
import { renderScreen } from '../lib/screen.server';

// Keep one text node: formatting must not introduce SSR comment separators in legacy responses.
const NOSCRIPT_TEXT =
  'Този сайт показва данни и графики с JavaScript. ' +
  'Включи го в браузъра си, за да го разгледаш. ' +
  'Файловете с данни са отворени и са в папка ';

export async function loader({ request, context }: Route.LoaderArgs) {
  const r = await renderScreen(new URL(request.url), context.release);
  if ('redirect' in r) throw redirect(r.redirect, 301);
  return data({ doc: r.doc }, { status: r.doc.status });
}

const html = (s: string) => ({ __html: s });

export default function Screen({ loaderData }: Route.ComponentProps) {
  const { doc } = loaderData;
  const pathname = useLocation().pathname;
  const route = doc.model ? ROUTES.find((r) => r.id === doc.model!.screen) : undefined;
  return (
    <>
      <a className="skip-link" href="#main">
        Към съдържанието
      </a>
      <div className="mockbar" id="mockbar" hidden />
      <div className="offline-banner" id="offline" role="status" hidden />
      {doc.model ? (
        <header className="topbar" id="topbar">
          <TopBar route={route} periods={route?.periods} />
        </header>
      ) : (
        <header className="topbar" id="topbar" dangerouslySetInnerHTML={html(doc.topbar)} />
      )}
      {doc.model ? (
        <AppShell>
          <MigratedScreen model={doc.model} navigation={{ go() {}, announce() {} }} />
        </AppShell>
      ) : (
        <div className="shell">
          <main className="main" id="main" tabIndex={-1}>
            <div
              className="view"
              id="view"
              aria-busy={doc.busy ? 'true' : undefined}
              dangerouslySetInnerHTML={html(doc.view)}
            />
          </main>
        </div>
      )}
      {doc.model ? (
        <script
          id="react-screen-seed"
          type="application/json"
          dangerouslySetInnerHTML={html(safeJSON(doc.model))}
        />
      ) : null}
      {doc.model ? (
        <footer className="footer" id="footer">
          <Footer cur={route?.id} wide from={pathname.replace(/^\//, '')} />
        </footer>
      ) : (
        <footer className="footer" id="footer" dangerouslySetInnerHTML={html(doc.footer)} />
      )}
      {doc.model ? (
        <nav className="tabbar" id="tabbar" aria-label="Бърза навигация">
          <BottomNav route={route} />
        </nav>
      ) : (
        <nav
          className="tabbar"
          id="tabbar"
          aria-label="Бърза навигация"
          dangerouslySetInnerHTML={html(doc.tabbar)}
        />
      )}
      <div className="sr-only" id="live" role="status" aria-live="polite" aria-atomic="true" />
      <div className="toasts" id="toasts" aria-live="polite" aria-atomic="false" />
      <noscript>
        <p className="noscript">
          {NOSCRIPT_TEXT}
          <a href="/data/catalog.json">
            <code>data/</code>
          </a>
          .
        </p>
      </noscript>
    </>
  );
}
