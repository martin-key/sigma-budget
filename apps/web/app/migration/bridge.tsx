import type { WebRoute } from '../lib/routes';
import { useSyncExternalStore, type ReactNode } from 'react';
import { createRoot, hydrateRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { bannerHtml, topbarHtml, tabbarHtml, footerHtml } from '../components/chrome/chrome';
import { data } from '../lib/legacy';
import { chromeTree, chromeDOM } from './chrome-tree';
import { MigratedScreen, textModel } from './registry';
import type { Navigation, TextScreenModel } from '../lib/screen-state';
let root: Root | undefined;
export function dispose() {
  if (root) {
    flushSync(() => root!.unmount());
    root = undefined;
    document.getElementById('view')?.removeAttribute('data-react-owned');
  }
}
export function mount(model: TextScreenModel, navigation: Navigation, adopt = false) {
  document.body.classList.remove('bare');
  const view = document.getElementById('view')!;
  view.setAttribute('data-react-owned', '');
  const actions: Navigation = {
    ...navigation,
    openGlossary:
      navigation.openGlossary ||
      ((anchor, slug) => {
        import(new URL('./glossary.js', import.meta.url).href)
          .then((module: unknown) => {
            const glossary = module as {
              openTerm(anchor: HTMLElement, slug: string): Promise<void>;
            };
            if (anchor.isConnected) return glossary.openTerm(anchor, slug);
          })
          .catch(() => {
            if (anchor.isConnected) navigation.go(`/rechnik/${encodeURIComponent(slug)}`);
          });
      }),
  };
  const element = <MigratedScreen model={model} navigation={actions} />;
  if (adopt) {
    root = hydrateRoot(view, element);
  } else {
    root = createRoot(view);
    flushSync(() => root!.render(element));
  }
  view.removeAttribute('aria-busy');
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => {
      resolve();
    }),
  );
}

interface ChromeOwner {
  root?: Root;
  initial: ReactNode;
  element: ReactNode;
  listeners: Set<() => void>;
}
const chromeRoots = new Map<string, ChromeOwner>();
// Adopt legacy indentation without changing server bytes. Both snapshots and
// updates use the same host tree and keys, preserving focused DOM elements.
function ChromeRoot({ owner }: { owner: ChromeOwner }) {
  return useSyncExternalStore(
    (fn) => {
      owner.listeners.add(fn);
      return () => owner.listeners.delete(fn);
    },
    () => owner.element,
    () => owner.initial,
  );
}
export function refreshChrome(
  options: {
    route?: WebRoute;
    periods?: WebRoute['periods'];
    wide?: boolean;
    cur?: string;

    from?: string;
  } = {},
) {
  const pieces: Record<string, ReactNode> = {
    mockbar: bannerHtml(),
    topbar: topbarHtml(options),
    footer: footerHtml(options),
    tabbar: tabbarHtml(options.route),
  };
  for (const [id, piece] of Object.entries(pieces)) {
    const element = chromeTree(piece);
    const node = document.getElementById(id);
    if (!node) continue;
    let owner = chromeRoots.get(id);
    if (!owner) {
      owner = {
        initial: chromeDOM(node),
        element,
        listeners: new Set(),
      };
      chromeRoots.set(id, owner);
      if (node.childNodes.length) owner.root = hydrateRoot(node, <ChromeRoot owner={owner} />);
      else {
        owner.root = createRoot(node);
        flushSync(() => owner!.root!.render(<ChromeRoot owner={owner!} />));
      }
    } else {
      owner.element = element;
      owner.listeners.forEach((fn) => fn());
    }
  }
}

export function loadModel(
  screen: TextScreenModel['screen'],
  params: Record<string, string>,
  query: Record<string, string>,
  signal?: AbortSignal,
) {
  const meta = (name: string) =>
    document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content || '';
  return textModel(screen, params, query, {
    release: {
      id: meta('release-id'),
      dataBase: meta('data-base') || '/data/',
      origin: meta('site-origin'),
      sigmaUrl: meta('sigma-url'),
      feedbackEmail: meta('feedback-email'),
    },
    get: <T,>(name: string) => data.get(name) as T | undefined,
    load: (name) => data.load(name, { signal }),
  });
}

export { textMetadata as metadata } from '../lib/screens/text';
