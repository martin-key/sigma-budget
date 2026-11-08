/** The route fields used by the editorial link matcher. */
export interface EditorialRoute {
  id: string;
  key: string;
  pattern: string | null;
  title: string;
  step: number | null;
}
export interface EditorialMetadata {
  id: string;
  title: string;
  status: string;
  source: string[];
  sourceNote: string;
  asOf: string;
  retrieved: string;
  mock: boolean;
}
export interface GlossaryCategory {
  id: string;
  title: string;
  short: string;
  from: number;
  to: number;
}
export interface GlossarySourceTerm {
  n: number;
  slug: string;
  title: string;
  name: string;
  abbr?: string | null;
  cat: string;
  def: string;
  example: string;
  aliases: { text: string }[];
}
export interface GlossarySourceRelation {
  text: string;
  from: string;
  to: string[];
  note: string;
  terms: number[];
}
export interface GlossaryIntro {
  lead: string;
  text: string;
  disclaimer: { bold: string; text: string };
}
/** The fields consumed from the historical glossary source. */
export interface GlossarySource {
  title: string;
  subtitle: string;
  intro: GlossaryIntro;
  categories: GlossaryCategory[];
  terms: GlossarySourceTerm[];
  related: { title: string; items: GlossarySourceRelation[] };
  sources: { title: string; intro: string; items: { name: string; url: string }[] };
}
export interface GlossaryTerm {
  n: number;
  slug: string;
  title: string;
  name: string;
  abbr?: string;
  cat: string;
  def: string;
  example: string;
  aliases: string[];
  related: { slug: string; note: string }[];
  see: { label: string; href: string }[];
}
export interface GlossaryDataset {
  meta: EditorialMetadata;
  title: string;
  subtitle: string;
  intro: GlossaryIntro;
  categories: GlossaryCategory[];
  terms: GlossaryTerm[];
  relationsTitle: string;
  relations: { text: string; from: string; to: string[]; note: string; terms: string[] }[];
  sourcesTitle: string;
  sourcesIntro: string;
  sources: { name: string; url: string }[];
}
export interface GuideStep {
  n: number;
  title: string;
  verb: string;
  screen: { id: string; label: string; href: string };
  intro: string;
  blocks: { type: string; role: string; text: string }[];
  next?: { n: number; title: string; href: string; text: string };
}
export interface GuideDataset {
  meta: EditorialMetadata;
  title: string;
  lead: string;
  steps: GuideStep[];
  checks: {
    title: string;
    heading: string;
    lead: string;
    items: { n: number; short: string; text: string }[];
    end: string;
    text: string;
  };
  credit: string;
}
