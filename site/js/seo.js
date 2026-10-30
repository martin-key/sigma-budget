// The <head> of a screen for search engines, social cards and answer engines (SEO/GEO/AEO). The router calls apply() after every paint;
// the build (tools/site/build.py) snapshots the result into the prerendered HTML, so one place decides what a crawler reads.
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

const SITE = 'Бюджет на светло';
const ORG = 'Работна група „Бюджет на светло“';
const MAXD = 160;
const origin = () => (document.querySelector('meta[name="site-origin"]')?.content || location.origin).replace(/\/+$/, '');

/** plain text of a value that may be SafeHtml, a string with tags or a number */
export function plain(v) {
  if (v == null) return '';
  const s = String(v);
  if (!/[<&]/.test(s)) return s.replace(/\s+/g, ' ').trim();
  const t = document.createElement('template');
  t.innerHTML = s;
  t.content.querySelectorAll('.sr-only,[aria-hidden="true"],script,style').forEach(n => n.remove());
  return (t.content.textContent || '').replace(/\s+/g, ' ').trim();
}
/** shorten on a word boundary, with an ellipsis */
export function clip(s, n = MAXD) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n - 1), i = cut.lastIndexOf(' ');
  return (i > n * 0.6 ? cut.slice(0, i) : cut).replace(/[\s,;:–—-]+$/, '') + '…';
}

function upsert(sel, make) {
  let el = document.head.querySelector(sel);
  if (!el) { el = make(); document.head.appendChild(el); }
  return el;
}
const meta = (attr, key, content) => {
  const el = upsert(`meta[${attr}="${key}"]`, () => { const m = document.createElement('meta'); m.setAttribute(attr, key); return m; });
  el.setAttribute('content', content);
};
const link = (rel, href) => { upsert(`link[rel="${rel}"]`, () => { const l = document.createElement('link'); l.rel = rel; return l; }).href = href; };

/** the date of the data behind the site (core.build.dataVersion '2026-10-09.1' -> '2026-10-09') */
function modified() {
  const b = data.get('core')?.build;
  const v = b?.dataVersion || b?.kfpPublished || '';
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

function graph(vm, { url, title, desc, question, answer }) {
  const o = origin(), home = o + '/';
  const g = [
    { '@type': 'WebSite', '@id': home + '#website', url: home, name: SITE, inLanguage: 'bg', publisher: { '@id': home + '#org' },
      description: 'Държавният бюджет на България на разбираем език, по официални данни: откъде идват парите, къде отиват, изпълнява ли се планът, колко дължим.',
      potentialAction: { '@type': 'SearchAction', target: { '@type': 'EntryPoint', urlTemplate: o + '/tarsene?q={search_term_string}' }, 'query-input': 'required name=search_term_string' } },
    { '@type': 'Organization', '@id': home + '#org', name: ORG, url: home, logo: { '@type': 'ImageObject', url: o + '/icon-512.png', width: 512, height: 512 } }
  ];
  const crumbs = (vm.crumbs || []).filter(c => c && c.label);
  const faq = !!(question && answer);                                 // FAQPage is a WebPage: the question and its answer, both on the screen
  const page = {
    '@type': faq ? 'FAQPage' : 'WebPage',
    '@id': url + '#webpage', url, name: title, description: desc, inLanguage: 'bg', isPartOf: { '@id': home + '#website' },
    publisher: { '@id': home + '#org' }, primaryImageOfPage: { '@type': 'ImageObject', url: o + '/og.png' }
  };
  const dm = modified();
  if (dm) page.dateModified = dm;
  if (crumbs.length > 1) {
    page.breadcrumb = { '@id': url + '#breadcrumb' };
    g.push({ '@type': 'BreadcrumbList', '@id': url + '#breadcrumb', itemListElement: crumbs.map((c, i) => {
      const it = { '@type': 'ListItem', position: i + 1, name: plain(c.label) };
      if (c.href && i < crumbs.length - 1) it.item = o + addrParts(String(c.href).replace(/^#/, '').replace(/^(?!\/)/, '/')).path;
      else it.item = url;
      return it;
    }) });
  }
  if (faq) page.mainEntity = [{ '@type': 'Question', name: question, acceptedAnswer: { '@type': 'Answer', text: answer } }];
  g.push(page);
  for (const n of vm.schema || []) if (n && typeof n === 'object') g.push({ ...n, isPartOf: n.isPartOf || { '@id': home + '#website' } });
  return { '@context': 'https://schema.org', '@graph': g };
}

/** set the head for the painted view model; title = document.title */
export function apply(vm, docTitle) {
  if (!vm || !vm.route) return;
  const o = origin();
  const { path } = addrParts(here());
  const url = o + (path === '/' ? '/' : path);
  const title = plain(vm.docTitle || vm.title) || vm.route.title;
  const heading = plain(vm.title);
  const lede = plain(vm.lede);
  const question = plain(vm.question) || (!vm.docTitle && /\?\s*$/.test(heading) ? heading : '');   // /prihodi/dds answers about ДДС, not the heading's question
  const answer = plain(vm.answer) || (question && /\d/.test(lede) ? lede : '');
  const desc = clip(answer || lede || vm.route.desc || SITE);
  const noindex = vm.route.id === 'S30' || vm.route.bare || !!vm.demo || vm.view === 'error' || HASH;
  meta('name', 'description', desc);
  meta('name', 'robots', noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large,max-snippet:-1');
  link('canonical', url);
  meta('property', 'og:type', vm.route.id === 'S01' ? 'website' : 'article');
  meta('property', 'og:site_name', SITE);
  meta('property', 'og:locale', 'bg_BG');
  meta('property', 'og:title', title);
  meta('property', 'og:description', desc);
  meta('property', 'og:url', url);
  meta('property', 'og:image', o + '/og.png');
  meta('property', 'og:image:width', '1200');
  meta('property', 'og:image:height', '630');
  meta('property', 'og:image:alt', `${SITE}: ${title}`);
  meta('name', 'twitter:card', 'summary_large_image');
  meta('name', 'twitter:title', docTitle || title);
  meta('name', 'twitter:description', desc);
  const ld = upsert('script#ld-page', () => { const s = document.createElement('script'); s.type = 'application/ld+json'; s.id = 'ld-page'; return s; });
  ld.textContent = noindex ? '{}' : JSON.stringify(graph(vm, { url, title, desc, question, answer })).replace(/</g, '\\u003c');
}
