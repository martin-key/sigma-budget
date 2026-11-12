import { resolvePeriod, DEFAULT_PERIOD } from './periods.js';
// The <head> of a screen for search engines, social cards and answer engines (SEO/GEO/AEO). The router calls apply() after every paint;
// the server writes the same head into the first response (apps/web/app/root.tsx, head()), so one place decides what a crawler reads.
//   description   the screen's short answer (parts.answer / mod.answer), else its lede, else the route's desc; at most ~160 characters
//   Q&A           a screen named as a question („Колко дължим?“), or one that names its question (mod.question), with a factual answer that is
//                 on the screen: mod.answer (the page's own „Накратко“) or the lede when it has a number in it -> FAQPage in the JSON-LD
//   canonical     the production origin (<meta name="site-origin">) + the path, without the query: a view switch is not a page of its own
//   robots        noindex for the 404 screen, the embed view, the ?demo= states and old hash addresses opened in hash mode
//   JSON-LD       WebSite (with the search action), Organization, WebPage with its BreadcrumbList; FAQPage when a question screen has an answer;
//                 a screen may add its own nodes (parts.schema / mod.schema(ctx): a Dataset, a DefinedTerm, a GovernmentOrganization)
// Nothing here is sent anywhere: the tags are read by whoever fetches the page.
import { here, parts as addrParts, HASH } from './loc.js';
import { data } from './data.js';
import { serverScope } from './env.js';

const SITE = 'СИГМА Бюджет';
const ORG = 'СИГМА Бюджет';
const MAXD = 160;
const origin = () =>
  (
    serverScope()?.origin ||
    document.querySelector('meta[name="site-origin"]')?.content ||
    location.origin
  ).replace(/\/+$/, '');
/** the production address of a path of the site ('/danni/execution', '/data/core.json'): for the JSON-LD a screen adds through mod.schema */
export const siteUrl = (path = '/') =>
  origin() + (String(path).startsWith('/') ? path : '/' + path);
/** the publisher node, to reference from a screen's own nodes ({ '@id': … }) */
export const orgRef = () => ({ '@id': origin() + '/#org' });

/** plain text of a value that may be SafeHtml, a string with tags or a number */
export function plain(v) {
  if (v == null) return '';
  const s = String(v);
  if (!/[<&]/.test(s)) return s.replace(/\s+/g, ' ').trim();
  if (typeof document === 'undefined') return textOf(s);
  const t = document.createElement('template');
  t.innerHTML = s;
  t.content
    .querySelectorAll('.sr-only,[aria-hidden="true"],script,style')
    .forEach((n) => n.remove());
  return (t.content.textContent || '').replace(/\s+/g, ' ').trim();
}
/* The same text without a DOM (the server): the HTML comes from js/html.js, so it is well formed. Elements that plain() drops in the
   browser (.sr-only, aria-hidden="true", script, style) are skipped with everything inside them; entities are decoded. */
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
const decode = (t) =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, c) =>
    c[0] === '#'
      ? String.fromCodePoint(c[1] === 'x' || c[1] === 'X' ? parseInt(c.slice(2), 16) : +c.slice(1))
      : (ENT[c.toLowerCase()] ?? m),
  );
const hidden = (name, attrs) =>
  name === 'script' ||
  name === 'style' ||
  /\baria-hidden\s*=\s*"true"/.test(attrs) ||
  /\bclass\s*=\s*"[^"]*\bsr-only\b/.test(attrs);
function textOf(s) {
  let out = '',
    skip = 0;
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)([^>]*)>|([^<]+)/g;
  for (let m; (m = re.exec(s)); ) {
    if (m[3] !== undefined) {
      if (!skip) out += m[3];
      continue;
    }
    if (!m[1]) continue;
    const name = m[1].toLowerCase(),
      close = m[0][1] === '/',
      selfClosing = VOID.has(name) || /\/\s*$/.test(m[2] || '');
    if (close) {
      if (skip) skip--;
      continue;
    }
    if (selfClosing) continue;
    if (skip || hidden(name, m[2] || '')) skip++;
  }
  return decode(out).replace(/\s+/g, ' ').trim();
}
/** shorten on a word boundary, with an ellipsis */
export function clip(s, n = MAXD) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1),
    i = cut.lastIndexOf(' ');
  return (i > n * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,;:–—-]+$/, '') + '…';
}

function upsert(sel, make) {
  let el = document.head.querySelector(sel);
  if (!el) {
    el = make();
    document.head.appendChild(el);
  }
  return el;
}
const meta = (attr, key, content) => {
  const el = upsert(`meta[${attr}="${key}"]`, () => {
    const m = document.createElement('meta');
    m.setAttribute(attr, key);
    return m;
  });
  el.setAttribute('content', content);
};
const link = (rel, href) => {
  upsert(`link[rel="${rel}"]`, () => {
    const l = document.createElement('link');
    l.rel = rel;
    return l;
  }).href = href;
};

/** the date of the data behind the site (core.build.dataVersion '2026-10-09.1' -> '2026-10-09') */
function modified() {
  const b = data.get('core')?.build;
  const v = b?.dataVersion || b?.kfpPublished || '';
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

function graph(vm, { url, title, desc, question, answer }) {
  const o = origin(),
    home = o + '/';
  const g = [
    {
      '@type': 'WebSite',
      '@id': home + '#website',
      url: home,
      name: SITE,
      alternateName: 'Sigma Budget',
      inLanguage: 'bg',
      publisher: { '@id': home + '#org' },
      description:
        'Държавният бюджет на България на разбираем език, по официални данни: откъде идват парите, къде отиват, изпълнява ли се планът, колко дължим.',
      potentialAction: {
        '@type': 'SearchAction',
        target: { '@type': 'EntryPoint', urlTemplate: o + '/tarsene?q={search_term_string}' },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'Organization',
      '@id': home + '#org',
      name: ORG,
      url: home,
      logo: { '@type': 'ImageObject', url: o + '/icon-512.png', width: 512, height: 512 },
    },
  ];
  const crumbs = (vm.crumbs || []).filter((c) => c && c.label);
  const faq = !!(question && answer); // FAQPage is a WebPage: the question and its answer, both on the screen
  const page = {
    '@type': faq ? 'FAQPage' : 'WebPage',
    '@id': url + '#webpage',
    url,
    name: title,
    description: desc,
    inLanguage: 'bg',
    isPartOf: { '@id': home + '#website' },
    publisher: { '@id': home + '#org' },
    primaryImageOfPage: { '@type': 'ImageObject', url: o + '/og.png' },
  };
  const dm = modified();
  if (dm) page.dateModified = dm;
  if (crumbs.length > 1) {
    page.breadcrumb = { '@id': url + '#breadcrumb' };
    g.push({
      '@type': 'BreadcrumbList',
      '@id': url + '#breadcrumb',
      itemListElement: crumbs.map((c, i) => {
        const it = { '@type': 'ListItem', position: i + 1, name: plain(c.label) };
        if (c.href && i < crumbs.length - 1)
          it.item =
            o +
            addrParts(
              String(c.href)
                .replace(/^#/, '')
                .replace(/^(?!\/)/, '/'),
            ).path;
        else it.item = url;
        return it;
      }),
    });
  }
  if (faq)
    page.mainEntity = [
      { '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } },
    ];
  g.push(page);
  for (const n of vm.schema || [])
    if (n && typeof n === 'object')
      g.push({ ...n, isPartOf: n.isPartOf || { '@id': home + '#website' } });
  return { '@context': 'https://schema.org', '@graph': g };
}

/** the head of a view model, as data: [{tag:'meta'|'link', attrs:{…}}] and the JSON-LD text. The browser writes it into the page (apply),
 *  the server writes it into the document it sends (apps/web/app/root.tsx); title = the document title */
export function head(vm, docTitle) {
  const o = origin();
  const { path } = addrParts(here());
  const defaultPeriod =
    Array.isArray(vm.route.periods) && vm.route.periods.length === 1
      ? vm.route.periods[0]
      : DEFAULT_PERIOD;
  const per = resolvePeriod(vm.query?.per ?? defaultPeriod).resolved;
  const qs = new URLSearchParams();
  if (vm.route.periods !== 'none' && per !== defaultPeriod) qs.set('per', per);
  if (vm.query?.variant === 'billMc') qs.set('variant', 'billMc');
  if (vm.query?.dokument === 'plan') qs.set('dokument', 'plan');
  const url = o + (path === '/' ? '/' : path) + (qs.size ? '?' + qs : '');
  const title = plain(vm.docTitle || vm.title) || vm.route.title;
  const heading = plain(vm.title);
  const lede = plain(vm.lede);
  const question = plain(vm.question) || (!vm.docTitle && /\?\s*$/.test(heading) ? heading : ''); // /prihodi/dds answers about ДДС, not the heading's question
  const answer = plain(vm.answer) || (question && /\d/.test(lede) ? lede : '');
  const desc = clip(answer || lede || vm.route.desc || SITE);
  const noindex =
    vm.route.id === 'S30' || vm.route.bare || !!vm.demo || vm.view === 'error' || HASH;
  const m = (attr, key, content) => ({ tag: 'meta', attrs: { [attr]: key, content } });
  const tags = [
    m('name', 'description', desc),
    m(
      'name',
      'robots',
      noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large,max-snippet:-1',
    ),
    { tag: 'link', attrs: { rel: 'canonical', href: url } },
    m('property', 'og:type', vm.route.id === 'S01' ? 'website' : 'article'),
    m('property', 'og:site_name', SITE),
    m('property', 'og:locale', 'bg_BG'),
    m('property', 'og:title', title),
    m('property', 'og:description', desc),
    m('property', 'og:url', url),
    m('property', 'og:image', o + '/og.png'),
    m('property', 'og:image:width', '1200'),
    m('property', 'og:image:height', '630'),
    m('property', 'og:image:alt', `${SITE}: ${title}`),
    m('name', 'twitter:card', 'summary_large_image'),
    m('name', 'twitter:title', docTitle || title),
    m('name', 'twitter:description', desc),
  ];
  const ld = noindex
    ? '{}'
    : JSON.stringify(graph(vm, { url, title, desc, question, answer })).replace(/</g, '\\u003c');
  return { tags, ld };
}

/** set the head for the painted view model; title = document.title */
export function apply(vm, docTitle) {
  if (!vm || !vm.route) return;
  const h = head(vm, docTitle);
  for (const { tag, attrs } of h.tags) {
    if (tag === 'link') {
      link(attrs.rel, attrs.href);
      continue;
    }
    const [attr, key] = Object.entries(attrs).find(([a]) => a !== 'content');
    meta(attr, key, attrs.content);
  }
  const ld = upsert('script#ld-page', () => {
    const s = document.createElement('script');
    s.type = 'application/ld+json';
    s.id = 'ld-page';
    return s;
  });
  ld.textContent = h.ld;
}
