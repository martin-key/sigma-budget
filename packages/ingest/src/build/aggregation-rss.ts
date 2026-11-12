import { aggregationInt } from './aggregation-core.js';

/** RSS 2.0 serialization of the aggregation feed. No site origin is inferred. */
export interface RssEvent {
  id: string;
  date: string;
  kind: string;
  title: string;
  href: string;
  text?: string;
}
export interface RssFeed {
  events: RssEvent[];
  kinds: { id: string; label: string }[];
}
export const DEFAULT_RSS_ORIGIN = 'https://budget-na-svetlo.example/';

// xml.sax.saxutils.escape escapes these three characters, including in attributes.
const escapeXml = (s: string): string =>
  s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

/** Match the donor's date construction and explicit +0000 timezone. */
export function rssDate(iso: string): string {
  if (typeof iso !== 'string') throw new Error('Invalid RSS date');
  const parts = iso.split('-');
  if (parts.length !== 3) throw new Error('Invalid RSS date');
  const [year, month, day] = parts.map(aggregationInt) as [number, number, number];
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31)
    throw new Error('Invalid RSS date');
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    throw new Error('Invalid RSS date');
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getUTCDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    month - 1
  ];
  return `${dow}, ${String(day).padStart(2, '0')} ${mon} ${String(year).padStart(4, '0')} 12:00:00 +0000`;
}

/** The editorial document preserves its own site identity in its source footer. */
export function editorialSiteName(input: { source?: { footer?: unknown } }): string {
  const footer = input.source?.footer;
  if (typeof footer !== 'string' || !footer.includes('|'))
    throw new Error('Missing editorial site identity in source.footer');
  const name = footer.slice(0, footer.indexOf('|')).trim();
  if (!name) throw new Error('Empty editorial site identity');
  return name;
}

export function buildRss(feed: RssFeed, base: string, buildDate: string, siteName: string): string {
  if (typeof siteName !== 'string' || !siteName.trim()) throw new Error('Missing RSS site identity');
  base = base.endsWith('/') ? base : base + '/';
  const labels = new Map(feed.kinds.map((kind) => [kind.id, kind.label]));
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `<title>${escapeXml(siteName)}: какво е ново</title>`,
    `<link>${escapeXml(base)}</link>`,
    '<description>Събития по данните за държавния бюджет: месечни отчети, законодателен път, ставки и нови набори. Прототип с примерни данни, където е отбелязано.</description>',
    '<language>bg</language>',
    `<lastBuildDate>${rssDate(buildDate)}</lastBuildDate>`,
    `<atom:link href="${escapeXml(base)}data/feed.xml" rel="self" type="application/rss+xml"/>`,
  ];
  for (const event of feed.events.slice(0, 30)) {
    const label = labels.get(event.kind);
    if (label === undefined) throw new Error(`Unknown RSS kind: ${event.kind}`);
    lines.push(
      '<item>',
      `<title>${escapeXml(event.title)}</title>`,
      `<link>${escapeXml(base)}${escapeXml(event.href)}</link>`,
      `<guid isPermaLink="false">${escapeXml(event.id)}</guid>`,
      `<pubDate>${rssDate(event.date)}</pubDate>`,
      `<category>${escapeXml(label)}</category>`,
      `<description>${escapeXml(event.text ?? '')}</description>`,
      '</item>',
    );
  }
  lines.push('</channel>', '</rss>');
  return lines.join('\n') + '\n';
}
