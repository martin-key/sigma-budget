import type { DebtInput } from '../../build/debt.js';
import { pythonRound } from '../../common/format.js';
import { isIsoDay } from '../../common/dates.js';
import { parseXml, descendants, xmlText } from '../documents/xml.js';

export interface BnbObservation {
  quarter: string;
  /** Preserve the SDMX decimal token before the builder's 2-place projection. */
  rawValue: string;
  value: number;
  status: 'A';
}
export type BnbSeries = DebtInput['bnbGg'];
export interface BnbDocument {
  series: BnbSeries;
  observations: BnbObservation[];
  attributes: Record<string, string>;
}
const MESSAGE = 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/message';
const DATA = 'http://www.sdmx.org/resources/sdmxml/schemas/v2_1/data/structurespecific';

/** BNB structure-specific SDMX 2.1, quarterly BG series, UNIT_MULT=6.
 * Generic SDMX and non-final/missing/duplicate observations fail explicitly. */
export function parseBnbDocument(text: string, indicator: string): BnbDocument {
  if (!/^[A-Z][A-Z0-9_]+$/u.test(indicator)) throw new Error('Invalid BNB indicator');
  const root = parseXml(text),
    all = [...descendants(root)];
  if (root.uri !== MESSAGE || root.local !== 'StructureSpecificData')
    throw new Error('Unsupported SDMX document');
  const prepared = all.filter((n) => n.uri === MESSAGE && n.local === 'Prepared');
  const asOf = prepared.length === 1 ? xmlText(prepared[0]!).slice(0, 10) : '';
  if (!isIsoDay(asOf)) throw new Error('Missing or invalid SDMX Prepared date');
  const series = all.filter(
    (n) =>
      ['', DATA].includes(n.uri) && n.local === 'Series' && n.attributes.INDICATOR === indicator,
  );
  if (series.length !== 1)
    throw new Error(`BNB indicator ${indicator} found ${series.length} times`);
  const node = series[0]!,
    a = node.attributes;
  if (a.UNIT_MULT !== '6' || a.REF_AREA !== 'BG' || a.FREQ !== 'Q')
    throw new Error('Unexpected BNB series units/area/frequency');
  const observations: BnbObservation[] = [],
    seen = new Set<string>();
  for (const obs of node.children) {
    if (obs.local !== 'Obs' || obs.uri !== node.uri)
      throw new Error('Unsupported BNB series child');
    const q = obs.attributes.TIME_PERIOD,
      raw = obs.attributes.OBS_VALUE;
    if (!q || !/^\d{4}-Q[1-4]$/u.test(q) || Number(q.slice(0, 4)) < 1 || seen.has(q))
      throw new Error('Invalid or duplicate BNB quarter');
    if (
      !raw ||
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/u.test(raw) ||
      !Number.isFinite(Number(raw)) ||
      obs.attributes.OBS_STATUS !== 'A'
    )
      throw new Error(`Bad BNB observation: ${q}`);
    seen.add(q);
    observations.push({ quarter: q, rawValue: raw, value: Number(raw), status: 'A' });
  }
  observations.sort((a, b) => a.quarter.localeCompare(b.quarter));
  if (!observations.length) throw new Error('Empty BNB series');
  const ordinal = (q: string) => Number(q.slice(0, 4)) * 4 + Number(q.at(-1));
  if (
    observations.some(
      (o, i) => i > 0 && ordinal(o.quarter) !== ordinal(observations[i - 1]!.quarter) + 1,
    )
  )
    throw new Error('Missing BNB quarter');
  return {
    series: {
      asOf,
      indicator,
      quarters: observations.map((o) => o.quarter),
      mln: observations.map((o) => pythonRound(o.value, 2)),
    },
    observations,
    attributes: a,
  };
}

/** Exact existing builder IR; raw observations remain available separately. */
export const parseBnbSdmx = (text: string, indicator: string): BnbSeries =>
  parseBnbDocument(text, indicator).series;
