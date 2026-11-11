// The document of every screen (docs/adr/0002-react-router-ssr.md): the skeleton of the static site's apps/web/public/index.html, with the screen,
// the shell and the head drawn on the server (apps/web/app/lib/screen.server.ts). The document has no <Scripts/> or HydratedRouter:
// apps/web/client/main.js owns navigation; the migration bridge adopts disjoint screen/chrome React roots.
import type { ReactNode } from 'react';
import { Outlet, useMatches } from 'react-router';
import type { ScreenDoc } from './lib/screen.server';
import { CSP } from './lib/security';

const SHARED_CSS = ['tokens', 'base', 'layout', 'components', 'charts', 'motion'];
const FIRST = new Set(['description', 'robots']); // apps/web/public/index.html has these two before the site's own meta tags

const docOf = (matches: ReturnType<typeof useMatches>) =>
  matches.map((m) => (m.loaderData as { doc?: ScreenDoc } | undefined)?.doc).find(Boolean);

function Tag({ t }: { t: ScreenDoc['tags'][number] }) {
  return t.tag === 'link' ? <link {...t.attrs} /> : <meta {...t.attrs} />;
}

export function Layout({ children }: { children: ReactNode }) {
  const doc = docOf(useMatches());
  const first = doc ? doc.tags.filter((t) => t.tag === 'meta' && FIRST.has(t.attrs.name)) : [];
  const rest = doc ? doc.tags.filter((t) => !(t.tag === 'meta' && FIRST.has(t.attrs.name))) : [];
  return (
    <html
      lang="bg"
      data-theme="light"
      data-prerendered={doc && !doc.busy ? doc.prerendered : undefined}
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <title>{doc?.title ?? 'Бюджет на светло'}</title>
        <meta httpEquiv="Content-Security-Policy" content={CSP} />
        {first.map((t, i) => (
          <Tag key={i} t={t} />
        ))}
        <meta name="site-origin" content={doc?.release.origin ?? ''} />
        <meta name="feedback-email" content={doc?.release.feedbackEmail ?? ''} />
        <meta name="sigma-url" content={doc?.release.sigmaUrl ?? ''} />
        <meta name="release-id" content={doc?.release.id ?? ''} />
        <meta name="data-base" content={doc?.release.dataBase ?? '/data/'} />
        <meta name="color-scheme" content="light" />
        <meta name="theme-color" content="#FDFAF4" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="icon" href="/icon-192.png" type="image/png" sizes="192x192" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <link
          rel="alternate"
          type="application/rss+xml"
          title="Бюджет на светло: какво ново"
          href="/data/feed.xml"
        />
        <link
          rel="alternate"
          type="text/plain"
          title="Бюджет на светло за езикови модели"
          href="/llms.txt"
        />
        {SHARED_CSS.map((n) => (
          <link key={n} rel="stylesheet" href={`/css/${n}.css`} />
        ))}
        {(doc?.css ?? []).map((n) => (
          <link key={n} rel="stylesheet" href={`/css/pages/${n}.css`} data-page={n} />
        ))}
        <link rel="modulepreload" href="/js/router.js" />
        <script type="module" src="/js/main.js" />
        {rest.map((t, i) => (
          <Tag key={i} t={t} />
        ))}
        {doc ? (
          <script
            type="application/ld+json"
            id="ld-page"
            dangerouslySetInnerHTML={{ __html: doc.ld }}
          />
        ) : null}
      </head>
      <body className={doc?.bare ? 'bare' : undefined}>{children}</body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary() {
  return (
    <main className="main" id="main">
      <div className="view" id="view">
        <article className="page" data-view="error">
          <h1 className="page-title" id="page-title">
            Нещо се обърка
          </h1>
          <p className="lede">Не успяхме да покажем страницата. Опресни я и опитай пак.</p>
        </article>
      </div>
    </main>
  );
}
