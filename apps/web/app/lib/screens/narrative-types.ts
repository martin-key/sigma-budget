import type { EditorialScreenModel } from '../screen-state';
import type { EditorialCore } from '../editorial-types';
import type { href } from '../legacy';
export interface NarrativeCore extends EditorialCore {
  kpis?: { gdp?: { mln?: number; mlnPrecise?: number } };
  sources?: Record<string, { publisher?: string }>;
}
export interface Meta {
  source?: string[];
  asOf?: string;
  sourceNote?: string;
}
export interface Comparison {
  bill?: number | null;
  law?: number | null;
  diff?: number | null;
}
export interface LawLine extends Comparison {
  text: string;
  no?: string;
  level?: number;
  header?: boolean;
  changed?: boolean;
  op?: string;
}
export interface NamedComparison extends Comparison {
  name?: string;
  label?: string;
  n?: string | number;
}
export interface LawChange {
  art: number;
  id: string;
  name: string;
  headline?: Record<string, Comparison>;
  lines?: LawLine[];
  notes?: string[];
  areas?: NamedComparison[];
  areasNote?: string;
  bodies?: NamedComparison[];
  commitments?: NamedComparison[];
}
export interface Amounts {
  rev?: number;
  exp?: number;
  balance?: number;
}
export interface LawBudget {
  id: string;
  art: number;
  name: string;
  short?: string;
  changed?: boolean;
  bill?: Amounts;
  law?: Amounts;
  diff?: Amounts;
}
export interface LawDocument {
  meta?: Meta;
  versions?: { bill?: { date?: string; ref?: string }; law?: { date?: string; ref?: string } };
  art1?: { headline?: Record<string, Comparison>; lines?: LawLine[] };
  budgets?: LawBudget[];
  totals?: { count?: number; bill?: Amounts; law?: Amounts; diff?: Amounts };
  changes?: LawChange[];
  reconciliation?: {
    rows?: { art: number; name: string; rev?: number; exp?: number }[];
    sum?: Amounts;
    art1?: Amounts;
    ok?: boolean;
  };
  timeline?: {
    kind: string;
    phase?: string;
    dateText: string;
    title: string;
    detail?: string;
    ref?: string;
    href?: string;
  }[];
  counts?: {
    opinions?: number;
    opinionsNote?: string;
    proposals?: number;
    proposalDates?: Record<string, number>;
    committees?: { reported?: number; total?: number; leading?: string };
  };
  proposals?: { urlPattern?: string; items?: { no: string; date: string; file: string }[] };
  bills?: {
    id: string;
    lawTitle: string;
    sign: string;
    submitted?: string;
    firstReading?: string;
    secondReading?: string[];
    gazette?: { issue: number; date: string };
    inForce?: { from: string; exceptions: { when: string; scope: string }[] };
    counts?: { committeeReports?: number; opinions?: number; proposals?: number };
  }[];
  documents?: { title: string; url: string }[];
  next?: { title?: string; note?: string; expected?: string };
}
export interface MinistryDocument {
  items?: {
    id: string;
    name: string;
    short?: string;
    programBudgetVsLaw?: { diffKhil: number; prbKhil: number; lawKhil: number };
    programs?: { status?: string };
  }[];
}
export interface FeedEvent {
  id: string;
  date: string;
  dateTo?: string;
  dateKind?: string;
  kind: string;
  title: string;
  href?: string;
  text?: string;
}
export interface ExpectedEvent {
  id: string;
  title: string;
  expected?: string;
  note?: string;
}
export interface Highlights {
  asOf: string;
  month?: number;
  revenueMln?: number;
  revenueYoyPct?: number;
  expenditureMln?: number;
  expenditureYoyPct?: number;
  deficitMln?: number;
  deficitPrevYearMln?: number;
  capexPctPlan?: number;
  planBasis?: { periodKey?: string; basis?: string; source?: string[]; citation?: string };
  newBorrowingMln?: number;
  newBorrowingPrevYearMln?: number;
}
export interface FeedDocument {
  meta?: Meta;
  events?: FeedEvent[];
  kinds?: { id: string; label: string }[];
  dateKinds?: Record<string, string>;
  expected?: ExpectedEvent[];
  highlights?: Highlights;
}
export interface NarrativeModel extends Omit<EditorialScreenModel, 'screen' | 'core'> {
  screen: 'S14' | 'S16';
  period: { key: string; label: string; desc: string };
  unsupported?: boolean;
  core: NarrativeCore;
  content: { law?: LawDocument; ministries?: MinistryDocument; feed?: FeedDocument };
  failed: string[];
}
export interface NarrativeContext {
  data: NarrativeModel['content'];
  core: NarrativeCore;
  query: Record<string, string>;
  unit: 'eur' | 'pct';
  origin: string;
  href: typeof href;
}
