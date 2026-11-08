/** Parsed evidence used by the law builder, after the Python extraction stage. */
export type LawKey = 'zdb' | 'zbdoo' | 'zbnzok';
export type LawHeadlineKey = 'rev' | 'exp' | 'transfers' | 'eucontrib' | 'balance' | 'financing';
export type LawAmount = number | null;
export interface LawAmountPair {
  bill: LawAmount;
  law: LawAmount;
  diff: LawAmount;
}
export type LawSourceLine = [section: string, number: string, text: string, amount: LawAmount];
export interface LawPolicy {
  n: string;
  name: string;
  khil: LawAmount;
  parts?: LawPolicy[];
}
export interface LawBody {
  name: string;
  khil: LawAmount;
}
export interface LawArticleEvidence {
  name: string;
  headline: Partial<Record<LawHeadlineKey, LawAmount>>;
  lines?: LawSourceLine[];
  policies: LawPolicy[];
  bodies: LawBody[];
  commitments: { entered: LawAmount; new: LawAmount } | null;
}
export interface LawDiffLine {
  op: 'chg' | 'add' | 'del';
  sec: string;
  no: string;
  text: string;
  bill?: LawAmount;
  law?: LawAmount;
}
export interface LawDiffEvidence {
  lines: LawDiffLine[];
  policies?: unknown;
  bodies?: unknown;
  commitments?: unknown;
}
export interface ParsedLawEvidence {
  bill: Record<string, LawArticleEvidence>;
  law: Record<string, LawArticleEvidence>;
  diff: Record<string, LawDiffEvidence>;
  sums: { budgets: number; expKhil: number; revKhil: number };
}
export interface LawMinistryEvidence {
  art: number;
  name: string;
  revKhil?: LawAmount;
  expKhil?: LawAmount;
  transfersKhil?: LawAmount;
  billVsLaw?: Partial<Record<'revKhil' | 'expKhil' | 'transfersKhil', LawAmountPair>> | null;
}
export interface ParliamentEvidence {
  activity: { L_Act_St_date: string; L_Act_St2_name: string; L_Act_St_name: string }[];
  stan_list: { A_Cm_Stan_date: string; A_ns_CL_value: string }[];
  standp_list: { A_Cm_Stan_date: string; A_Cm_Stanid: number }[];
  proposal_12_list: { RN_DOC: string; DAT_DOC: string; act_files: { FILENAME: string }[] }[];
  stan_list2_1: { A_Cm_Stan_date: string }[];
  dist_list: { A_ns_CL_value: string; L_Act_DTL_value: string }[];
  L_Act_sign: string;
  L_ActL_title: string;
  L_ActL_final: string;
  L_Act_date: string;
  L_Act_date2: string;
  L_Act_dv_iss: string | number;
  static_archive?: string | null;
  order: { FILENAME: string }[];
  file_list: { FILENAME: string }[];
}
export type GazetteBlock = ['p', string] | ['t', string[][]];
export interface LawEvidence {
  law: ParsedLawEvidence;
  ministries: { items: LawMinistryEvidence[] } | null;
  parliament: Record<LawKey, ParliamentEvidence>;
  dvBlocks: Record<LawKey, GazetteBlock[]>;
  archiveBytes?: number | null;
}

export interface LawMetadata {
  id: string;
  title: string;
  status: string;
  source: string[];
  sourceNote?: string;
  asOf: string;
  retrieved: string;
  unit?: string;
  pending: string[];
  mock: boolean;
}
export interface LawVersion {
  label: string;
  date: string;
  ref: string;
  url: string;
}
export interface LawArticleRow {
  id: string;
  sec: string;
  no: string;
  level: number;
  text: string;
  header?: boolean;
  bill?: LawAmount;
  law?: LawAmount;
  diff?: LawAmount;
  changed?: boolean;
}
export type LawBudgetAmounts = Record<'rev' | 'exp' | 'transfers', LawAmount>;
export interface LawBudgetRow {
  art: number;
  id: string;
  name: string;
  short: string;
  kind: string;
  bill: LawBudgetAmounts;
  law: LawBudgetAmounts;
  diff: LawBudgetAmounts;
  changed: boolean;
  lines: { chg: number; add: number; del: number };
}
export interface LawChangeLine extends LawAmountPair {
  op: string;
  sec: string;
  no: string;
  text: string;
}
export interface LawChange {
  art: number;
  id: string;
  name: string;
  headline: Partial<Record<LawHeadlineKey, LawAmountPair>>;
  lines: LawChangeLine[];
  notes: string[];
  areas?: (LawAmountPair & { n: string; name: string })[];
  areasNote?: string;
  bodies?: (LawAmountPair & { name: string })[];
  commitments?: (LawAmountPair & { key: string; label: string })[];
}
export interface LawBill {
  id: LawKey;
  short: string;
  sign: string;
  title: string;
  lawTitle: string;
  submitted: string;
  firstReading: string;
  secondReading: string[];
  adopted: string;
  decree: { no: number; issued: string };
  gazette: { issue: number; date: string };
  inForce: { from: string; exceptions: { from: string | null; when: string; scope: string }[] };
  counts: { committeeReports: number; opinions: number; proposals: number };
  page: string;
  law: string;
  source: string[];
}
export interface LawTimelineEvent {
  kind: string;
  phase: string;
  date?: string;
  dateTo?: string;
  month?: string;
  ongoing?: boolean;
  dateText: string;
  title: string;
  detail?: string;
  ref?: string;
  href?: string;
  source: string[];
}
export interface LawDataset {
  meta: LawMetadata;
  note: string;
  versions: { bill: LawVersion; law: LawVersion };
  art1: {
    unit: string;
    title: string;
    headline: Partial<Record<LawHeadlineKey, LawAmountPair>>;
    lines: LawArticleRow[];
  };
  budgets: LawBudgetRow[];
  totals: {
    count: number;
    bill: { rev: number; exp: number };
    law: { rev: number; exp: number };
    diff: { rev: number; exp: number };
  };
  changes: LawChange[];
  reconciliation: {
    unit: string;
    rows: { art: number; name: string; rev: number; exp: number }[];
    sum: { rev: number; exp: number; balance: number };
    art1: { rev: number; exp: number; balance: number };
    ok: boolean;
  };
  bills: LawBill[];
  timeline: LawTimelineEvent[];
  kinds: Record<string, string>;
  counts: {
    committeeReports: number;
    opinions: number;
    proposals: number;
    reportDates: Record<string, number>;
    opinionDates: Record<string, number>;
    proposalDates: Record<string, number>;
    committees: { total: number; leading: string; reported: number };
    opinionsNote: string;
  };
  gazette: { issue: number; year: number; date: string; laws: string[]; source: string[] }[];
  documents: { kind: string; title: string; url: string }[];
  proposals: {
    count: number;
    byDate: Record<string, number>;
    urlPattern: string;
    note: string;
    items: { no: string; date: string; file: string }[];
  };
  next: { title: string; status: string; note: string; expected: string };
  pending: string[];
}
