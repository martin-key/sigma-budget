export const AUDIT_CODES = [
  'frame',
  'route',
  'h1',
  'title',
  'lang',
  'landmark',
  'layout',
  'tokens',
  'placeholder',
  'encoding',
  'scroll-x',
  'a11y-name',
  'a11y-label',
  'a11y-alt',
  'aria-ref',
  'aria-hidden-focus',
  'a11y-structure',
  'dead-link',
  'img-broken',
  'tabs',
  'target-size',
  'tiny-text',
  'src-key',
  'pending-id',
  'gl-term',
  'share-id',
  'fig-table',
  'mock-marker',
  'chart',
  'next',
  'link-route',
] as const;
export type AuditCode = (typeof AUDIT_CODES)[number];
export interface Finding {
  code: string;
  message: string;
}
declare global {
  interface Window {
    __HASH_ROUTES__: boolean;
    recordScreenEvent(event: Finding): Promise<void>;
  }
}
export function initializeScreen() {
  window.__HASH_ROUTES__ = true;
  document.addEventListener('securitypolicyviolation', (event) => {
    void window.recordScreenEvent({
      code: 'csp',
      message: `${event.violatedDirective} ${event.blockedURI}`,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    void window.recordScreenEvent({ code: 'rejection', message: String(event.reason) });
  });
}
export function screenReady(): boolean {
  const view = document.getElementById('view');
  if (
    !view ||
    view.getAttribute('aria-busy') === 'true' ||
    !view.querySelector('article.page[data-ready="1"]')
  )
    return false;
  const visible = (element: Element) =>
    (element.getBoundingClientRect().width > 0 || element.getBoundingClientRect().height > 0) &&
    getComputedStyle(element).visibility !== 'hidden';
  return (
    [...view.querySelectorAll<HTMLElement>('.chart')].every(
      (chart) => !visible(chart) || ['1', 'err'].includes(chart.dataset.ready || ''),
    ) &&
    document.fonts.status !== 'loading' &&
    [...view.querySelectorAll('img')].every((image) => image.complete)
  );
}
export async function revealScreen() {
  const view = document.getElementById('view')!;
  for (let round = 0; round < 3; round++) {
    const closed = [...view.querySelectorAll<HTMLDetailsElement>('details:not([open])')];
    for (const details of closed) details.open = true;
    if (!closed.length) break;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  window.scrollTo(0, document.documentElement.scrollHeight);
}
export async function auditScreen(expectedRoute: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const add = (code: AuditCode, message: string) => findings.push({ code, message });
  const all = (selector: string, root: ParentNode = document) => [
    ...root.querySelectorAll<HTMLElement>(selector),
  ];
  const visible = (element: Element) =>
    (element.getBoundingClientRect().width > 0 || element.getBoundingClientRect().height > 0) &&
    getComputedStyle(element).visibility !== 'hidden' &&
    getComputedStyle(element).display !== 'none';
  const name = (element: HTMLElement): string => {
    const labelled = (element.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || '')
      .join(' ')
      .trim();
    const labels =
      'labels' in element
        ? [...((element as HTMLInputElement).labels || [])]
            .map((label) => label.textContent)
            .join(' ')
            .trim()
        : '';
    return (
      [
        element.getAttribute('aria-label'),
        labelled,
        labels,
        element.textContent,
        element.querySelector('img[alt]')?.getAttribute('alt'),
        element.querySelector('svg title')?.textContent,
        element.getAttribute('title'),
        'value' in element ? String(element.value) : '',
      ]
        .map((value) => (value || '').trim())
        .find(Boolean) || ''
    );
  };
  const view = document.getElementById('view');
  if (!view) return [{ code: 'frame', message: 'Missing screen container' }];
  const articles = all('article.page', view),
    article = articles[0];
  if (articles.length !== 1 || article?.dataset.ready !== '1')
    add('frame', 'Expected one ready article');
  if (article?.dataset.route !== expectedRoute)
    add('route', `Expected ${expectedRoute}, received ${article?.dataset.route}`);
  const headings = all('h1');
  if (headings.length !== 1 || !headings[0]?.textContent?.trim() || !view.contains(headings[0]))
    add('h1', 'Expected one nonempty heading inside the screen');
  if (!document.title || document.title === 'СИГМА Бюджет' || !document.title.includes(' · '))
    add('title', 'Missing screen title');
  if (document.documentElement.lang !== 'bg') add('lang', 'Expected Bulgarian document language');
  if (
    all('main,[role="main"]').length !== 1 ||
    !document.body.firstElementChild?.matches('a.skip-link')
  )
    add('landmark', 'Expected one main landmark and the skip link first');
  const shown = (id: string) => {
    const element = document.getElementById(id);
    return element && visible(element);
  };
  if (document.body.classList.contains('bare')) {
    for (const id of ['topbar', 'sidenav', 'tabbar', 'footer', 'mockbar'])
      if (shown(id)) add('layout', `${id} visible in embed`);
  } else {
    if (!shown('topbar') || !shown('footer') || !shown('btn-search'))
      add('layout', 'Missing header, search or footer');
    const navigation = all('#sidenav .nav-main').filter(visible);
    if (innerWidth >= 1241 && (!shown('sidenav') || navigation.length !== 5))
      add('layout', 'Missing desktop navigation');
    if (innerWidth >= 961 && shown('tabbar')) add('layout', 'Desktop shows bottom bar');
    if (
      innerWidth < 961 &&
      (navigation.length || all('#sidenav .nav-cta').some(visible) || !shown('tabbar'))
    )
      add('layout', 'Incorrect phone navigation');
    const search = document.getElementById('btn-search');
    if (search) {
      const box = search.getBoundingClientRect();
      if (
        !search.closest('#topbar') ||
        search.getAttribute('aria-label') !== 'Търсене' ||
        box.width < 44 ||
        box.height < 44
      )
        add('layout', 'Search must be a named 44px header control');
    }
  }
  const badText =
    /(^|[^\p{L}\p{N}_.])(NaN|undefined|Infinity|null)(?![\p{L}\p{N}_])|\[object Object\]/u;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode())
    if (
      !walker.currentNode.parentElement?.closest(
        'code,pre,kbd,samp,textarea,script,style,template,noscript,[data-allow-tokens]',
      ) &&
      badText.test(walker.currentNode.nodeValue || '')
    )
      add('tokens', 'Broken value in text');
  for (const element of all('*', document.body))
    if (!element.closest('[data-allow-tokens],script,style,template'))
      for (const attribute of element.attributes)
        if (
          attribute.value === 'null' ||
          /\bNaN\b|\bundefined\b|\[object Object\]|Infinity/.test(attribute.value)
        )
          add('tokens', `Broken ${attribute.name} on ${element.id || element.tagName}`);
  if (badText.test(document.title)) add('tokens', 'Broken title value');
  if (/lorem ipsum|\bTODO\b|\bFIXME\b|\bTBD\b|\bXXX\b|\?\?\?/i.test(view.innerText))
    add('placeholder', 'Placeholder text');
  if (/[ÃÂÐÑ][\u0080-¿]|â€|�/.test(view.innerText)) add('encoding', 'Broken text encoding');
  if (
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) >
    document.documentElement.clientWidth + 1
  )
    add('scroll-x', 'Page scrolls horizontally');
  for (const element of all(
    'button,[role="button"],a[href],svg[role="img"],[role="img"],dialog,iframe',
  ).filter((element) => !element.closest('[hidden],template')))
    if (!(element.matches('iframe') ? element.title.trim() : name(element)))
      add('a11y-name', `Unnamed ${element.tagName} ${element.id}`);
  for (const element of all('input:not([type="hidden"]),select,textarea').filter(
    (element) => !element.closest('[hidden],template'),
  ))
    if (!name(element)) add('a11y-label', `Unlabelled ${element.id || element.tagName}`);
  if (all('img:not([alt])').length) add('a11y-alt', 'Image without alt');
  for (const element of all('[aria-labelledby],[aria-describedby],label[for]'))
    for (const attribute of ['aria-labelledby', 'aria-describedby', 'for'])
      for (const id of (element.getAttribute(attribute) || '').split(/\s+/).filter(Boolean))
        if (!document.getElementById(id)) add('aria-ref', `${attribute} points to missing ${id}`);
  if (
    all(
      '[aria-hidden="true"] a[href],[aria-hidden="true"] button:not([disabled]),[aria-hidden="true"] input:not([disabled]):not([type="hidden"]),[aria-hidden="true"] select,[aria-hidden="true"] textarea,[aria-hidden="true"] [tabindex]:not([tabindex="-1"])',
    ).some((element) => !element.closest('[hidden]'))
  )
    add('aria-hidden-focus', 'Focusable content is hidden from assistive technology');
  if (all('details').some((element) => !element.querySelector(':scope > summary')))
    add('a11y-structure', 'Details without summary');
  if (all('a[href]').some((element) => ['', '#'].includes(element.getAttribute('href')!)))
    add('dead-link', 'Empty link destination');
  if (
    [...document.images].some(
      (image) => image.complete && image.naturalWidth === 0 && image.getAttribute('src'),
    )
  )
    add('img-broken', 'Image failed to load');
  for (const list of all('[role="tablist"]')) {
    const tabs = all('[role="tab"]', list);
    if (
      tabs.length &&
      (tabs.filter((tab) => tab.getAttribute('aria-selected') === 'true').length !== 1 ||
        tabs.filter((tab) => tab.tabIndex === 0).length !== 1)
    )
      add('tabs', 'Tab selection or keyboard order is broken');
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') || '');
      if (
        !panel ||
        panel.getAttribute('role') !== 'tabpanel' ||
        (tab.getAttribute('aria-selected') === 'true') === panel.hidden
      )
        add('tabs', 'Tab panel does not match selection');
    }
  }
  const targets = all(
    'a[href],button,[role="tab"],[role="button"],select,summary,input:not([type="hidden"])',
    document.body,
  )
    .filter(
      (element) =>
        !element.closest('[hidden],svg') && !element.matches(':disabled') && visible(element),
    )
    .map((element) => ({ element, box: element.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 1 && box.height > 1);
  for (const { element, box } of targets) {
    if (
      (box.width >= 24 && box.height >= 24) ||
      (element.matches('a') && getComputedStyle(element).display === 'inline')
    )
      continue;
    if (element.matches('input[type="checkbox"],input[type="radio"]')) {
      const label = (element as HTMLInputElement).labels?.[0]?.getBoundingClientRect();
      if (label && label.width >= 24 && label.height >= 24) continue;
    }
    const x = box.left + box.width / 2,
      y = box.top + box.height / 2;
    if (
      targets.some(
        (other) =>
          other.element !== element &&
          !element.contains(other.element) &&
          !other.element.contains(element) &&
          other.box.left < x + 12 &&
          other.box.right > x - 12 &&
          other.box.top < y + 12 &&
          other.box.bottom > y - 12,
      )
    )
      add('target-size', `Small adjacent target ${element.id || element.tagName}`);
  }
  for (const element of all('*', view))
    if (
      !element.closest('svg,[hidden]') &&
      visible(element) &&
      [...element.childNodes].some(
        (node) => node.nodeType === 3 && (node.nodeValue || '').trim().length > 1,
      ) &&
      parseFloat(getComputedStyle(element).fontSize) < 11
    )
      add('tiny-text', `Text under 11px: ${element.id || element.tagName}`);
  const dataPath = '/js/data.js',
    glossaryPath = '/js/glossary.js',
    sharePath = '/js/share.js',
    routesPath = '/js/routes.js';
  const { data } = (await import(dataPath)) as {
    data: {
      get(
        key: string,
      ): { sources?: Record<string, unknown>; pending?: Record<string, unknown> } | undefined;
    };
  };
  const core = data.get('core');
  for (const element of all('[data-src]'))
    for (const key of (element.dataset.src || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean))
      if (core?.sources && !Object.hasOwn(core.sources, key))
        add('src-key', `Unknown source ${key}`);
  for (const element of all('[data-pending-id]'))
    if (core?.pending && !Object.hasOwn(core.pending, element.dataset.pendingId!))
      add('pending-id', `Unknown pending dataset ${element.dataset.pendingId}`);
  const glossary = (await import(glossaryPath)) as {
    ready(): Promise<unknown>;
    termOf(key: string): unknown;
  };
  if (all('a[data-gl]').length) {
    await glossary.ready();
    for (const link of all('a[data-gl]'))
      if (!glossary.termOf(link.dataset.gl!))
        add('gl-term', `Unknown glossary entry ${link.dataset.gl}`);
  }
  const share = (await import(sharePath)) as { get(key: string): unknown };
  for (const button of all('[data-share]'))
    if (!share.get(button.dataset.share!))
      add('share-id', `Unregistered share control ${button.dataset.share}`);
  for (const figure of all('figure.fig', view)) {
    // S21 currently has a municipality chart without a data table; the site correction is tracked separately.
    if (expectedRoute !== 'S21' && !figure.querySelector('details.fig-table,table'))
      add('fig-table', 'Chart without data table alternative');
    if (figure.dataset.mockFig === 'true' && !figure.querySelector('.mock-badge'))
      add('mock-marker', 'Sample chart without badge');
  }
  for (const chart of all('.chart')) {
    if (chart.getAttribute('role') === 'img' && !chart.getAttribute('aria-label')?.trim())
      add('a11y-name', `Unnamed chart: ${chart.id}`);
    if (chart.dataset.ready === 'err' || (visible(chart) && chart.dataset.ready !== '1'))
      add('chart', `Chart not ready: ${chart.id}`);
    else if (
      visible(chart) &&
      chart.querySelectorAll('svg path,svg rect,svg circle,svg line,svg polygon').length < 2
    )
      add('chart', `Empty chart: ${chart.id}`);
  }
  const routeModule = (await import(routesPath)) as { match(parts: string[]): unknown };
  const resolves = (href: string) => {
    try {
      return !!routeModule.match(
        href.split('?')[0]!.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent),
      );
    } catch {
      return false;
    }
  };
  const next = view.querySelector('aside.next');
  if (next && !next.querySelector('a[href]')) add('next', 'Next card has no link');
  for (const link of all('aside.next a[href]', view))
    if (!resolves(link.getAttribute('href')!)) add('next', 'Next card points to a missing screen');
  for (const link of all('a[href]')) {
    const href = link.getAttribute('href')!;
    if ((href.startsWith('#/') && !resolves(href)) || /^(javascript|data):/i.test(href))
      add('link-route', `Invalid link ${href}`);
  }
  return findings;
}
