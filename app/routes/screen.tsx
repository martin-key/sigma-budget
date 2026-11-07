// A screen: its loader draws it from the release of the request (app/lib/screen.server.ts); the component puts the drawn parts into the
// body of the document, in the same elements as site/index.html, which site/js/main.js expects.
import { data, redirect } from 'react-router';
import type { Route } from './+types/screen';
import { renderScreen } from '../lib/screen.server';

export async function loader({ request, context }: Route.LoaderArgs) {
  const r = await renderScreen(new URL(request.url), context.release);
  if ('redirect' in r) throw redirect(r.redirect, 301);
  return data({ doc: r.doc }, { status: r.doc.status });
}

const html = (s: string) => ({ __html: s });

export default function Screen({ loaderData }: Route.ComponentProps) {
  const { doc } = loaderData;
  return (
    <>
      <a className="skip-link" href="#main">Към съдържанието</a>
      <div className="mockbar" id="mockbar" role="region" aria-label="Забележка за данните" dangerouslySetInnerHTML={html(doc.banner)} />
      <div className="offline-banner" id="offline" role="status" hidden />
      <header className="topbar" id="topbar" dangerouslySetInnerHTML={html(doc.topbar)} />
      <div className="shell">
        <main className="main" id="main" tabIndex={-1}>
          <div className="view" id="view" aria-busy={doc.busy ? 'true' : undefined} dangerouslySetInnerHTML={html(doc.view)} />
        </main>
      </div>
      <footer className="footer" id="footer" dangerouslySetInnerHTML={html(doc.footer)} />
      <nav className="tabbar" id="tabbar" aria-label="Бърза навигация" dangerouslySetInnerHTML={html(doc.tabbar)} />
      <div className="sr-only" id="live" role="status" aria-live="polite" aria-atomic="true" />
      <div className="toasts" id="toasts" aria-live="polite" aria-atomic="false" />
      <noscript>
        <p className="noscript">Този сайт показва данни и графики с JavaScript. Включи го в браузъра си, за да го разгледаш. Файловете с
          данни са отворени и са в папка <a href="/data/catalog.json"><code>data/</code></a>.</p>
      </noscript>
    </>
  );
}
