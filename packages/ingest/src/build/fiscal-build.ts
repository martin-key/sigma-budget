import type { Json } from '@sigma-budget/dataset-schema';
import { buildOutlook, buildRevenue, type FiscalEvidence } from './fiscal.js';
import { buildExpenditure, type ExpenditureEvidence } from './fiscal-expenditure.js';
import { buildMeasures, type MeasureSource, type MeasureExcerpts } from './measures.js';
import { buildAnnualPeriods, type AnnualForecast } from './fiscal-annual.js';

export interface FiscalBuildInput extends ExpenditureEvidence {
  measures: MeasureSource;
  excerpts: MeasureExcerpts;
  forecast: AnnualForecast;
}
export interface FiscalOutputs {
  'outlook.json': Record<string, Json>;
  'revenue.json': Record<string, Json>;
  'expenditure.json': Record<string, Json>;
  'measures.json': Record<string, Json>;
}
export function buildFiscalDonor(input: FiscalBuildInput, date: string): FiscalOutputs {
  return {
    'outlook.json': buildOutlook(input, date),
    'revenue.json': buildRevenue(input, date),
    'expenditure.json': buildExpenditure(input, date),
    'measures.json': buildMeasures(input.measures, input.excerpts, date),
  };
}
/** The four files have no wording/active-data changes; the annual layer is additive. */
export function projectFiscalPublished(
  donor: FiscalOutputs,
  forecast: AnnualForecast,
): FiscalOutputs {
  const annual = buildAnnualPeriods(forecast);
  return {
    'outlook.json': { ...donor['outlook.json'], byPeriod: annual.outlook as unknown as Json },
    'revenue.json': { ...donor['revenue.json'], byPeriod: annual.revenue as unknown as Json },
    'expenditure.json': {
      ...donor['expenditure.json'],
      byPeriod: annual.expenditure as unknown as Json,
    },
    'measures.json': structuredClone(donor['measures.json']),
  };
}
export function buildFiscal(input: FiscalBuildInput, date: string): FiscalOutputs {
  return projectFiscalPublished(buildFiscalDonor(input, date), input.forecast);
}
