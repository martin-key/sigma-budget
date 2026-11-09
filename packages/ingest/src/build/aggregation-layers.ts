import { SearchRows, type SearchRow } from './aggregation-search.js';
import type { buildCore } from './aggregation-core.js';
import type { buildFeed } from './aggregation-feed.js';
import type { buildSearch } from './aggregation-search.js';

interface GlueTerm {
  name: string;
  title: string;
  abbr?: string;
  slug: string;
  def: string;
  aliases: string[];
}
export interface ScopeLayersInput {
  core: ReturnType<typeof buildCore>;
  feed: ReturnType<typeof buildFeed>['feed'];
  rss: string;
  search: ReturnType<typeof buildSearch>;
  wording: Record<string, Record<string, string>>;
  sourceGlue: { sources: Record<string, unknown>; terms: GlueTerm[] };
}
/** The ordered, scope-limited parts of wording, active_data and apply_sources. */
export function projectAggregation(input: ScopeLayersInput) {
  const wording = (value: unknown, name: string) => {
    let text = JSON.stringify(value);
    for (const [from, to] of Object.entries(input.wording[name] ?? {}))
      text = text.replaceAll(JSON.stringify(from).slice(1, -1), JSON.stringify(to).slice(1, -1));
    return JSON.parse(text);
  };
  const core = wording(input.core, 'core.json') as ReturnType<typeof buildCore>,
    search = wording(input.search, 'search-index.json') as ReturnType<typeof buildSearch>,
    feed = structuredClone(input.feed);
  const gone = new Set(feed.events.filter((e) => e.source.includes('sebra')).map((e) => e.id));
  feed.events = feed.events.filter((e) => !gone.has(e.id));
  feed.meta.source = (feed.meta.source as string[]).filter((s) => s !== 'sebra');
  feed.meta.sourceNote = (feed.meta.sourceNote as string).replace(
    ', Евростат, СЕБРА)',
    ', Евростат)',
  );
  feed.expected = feed.expected.filter((x) => !JSON.stringify(x).includes('СЕБРА'));
  feed.sentences = feed.sentences.filter((x) => !JSON.stringify(x).includes('СЕБРА'));
  let rss = input.rss;
  for (const id of gone) {
    const safe = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    rss = rss.replace(
      new RegExp(
        `<item>\\n(?:(?!</item>)[\\s\\S])*?<guid[^>]*>${safe}</guid>(?:(?!</item>)[\\s\\S])*?</item>\\n?`,
        'g',
      ),
      '',
    );
  }
  search.items = search.items.filter(
    (i) =>
      i[5] === 'real' &&
      !['#/plashtania', '#/proekti', '#/moyat-byudzhet'].some((r) => i[6].startsWith(r)) &&
      !i[1].includes('СЕБРА'),
  );
  search.meta.sourceNote = (search.meta.sourceNote as string).replace(
    'Редовете с примерни данни са отбелязани и се скриват при „Само официални данни“. ',
    '',
  );
  delete core.sources.sebra;
  if (!Object.hasOwn(core.sources, 'dbp2027')) {
    Object.assign(core.sources, structuredClone(input.sourceGlue.sources));
    if (![64, 69].includes(core.counts.terms)) throw new Error('unexpected glossary count');
    core.counts.terms = 69;
  }
  if (!search.items.some((r) => r[6] === '#/rechnik/ess-2010')) {
    let last = -1;
    for (let i = 0; i < search.items.length; i++) if (search.items[i]![0] === 4) last = i;
    if (last < 0) throw new Error('no terms group for source glue');
    const added: SearchRow[] = input.sourceGlue.terms.map((t) => {
      const helper = new SearchRows(),
        title = t.abbr ? `${t.name} – ${t.abbr}` : t.title,
        clean = t.def.replace(/[ \t\r\n]+/g, ' ').trim(),
        m = /^(.{20,160}?[.!?])(\s|$)/u.exec(clean),
        first = m ? m[1]! : Array.from(clean).slice(0, 160).join(''),
        seen = new Set<string>(),
        words: string[] = [];
      for (const part of [t.aliases.join(' '), t.abbr ?? '', t.name])
        for (const w of part
          .replace(/[ \t\r\n]+/g, ' ')
          .trim()
          .split(' ')) {
          const key = w.toLowerCase();
          if (w && !seen.has(key)) {
            seen.add(key);
            words.push(w);
          }
        }
      helper.add('terms', title, first, '', '', 'real', `#/rechnik/${t.slug}`, words.join(' '));
      return helper.rows[0]!;
    });
    search.items.splice(last + 1, 0, ...added);
  }
  return { core, feed, rss, search };
}
