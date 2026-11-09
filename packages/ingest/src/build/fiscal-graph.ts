import { AnnualLineage, type BillExtraction, type Extraction } from './annual-lineage.js';
import { buildAnnualPeriods } from './fiscal-annual.js';
import { buildBudget2027 } from './budget-2027.js';
import { buildOutlook, buildRevenue } from './fiscal.js';
import { buildExpenditure } from './fiscal-expenditure.js';
import type { FiscalBuildInput } from './fiscal-build.js';
import { buildMeasures } from './measures.js';
import type { LawEvidence } from './law.js';
import { runGraph, type GraphStage } from './graph.js';

/** Raw evidence only: the legacy fiscal and law datasets are built in this graph. */
export interface FiscalGraphInput {
  fiscal: FiscalBuildInput;
  forecast: Extraction;
  bill: BillExtraction;
  archives: { forecast: Uint8Array; bill: Uint8Array };
  law: LawEvidence;
  buildDate: string;
}

export function fiscalStages(input: FiscalGraphInput): GraphStage[] {
  const { fiscal, forecast, bill, archives, buildDate } = input;
  return [
    { id: 'outlook', requires: [], run: () => buildOutlook(fiscal, buildDate) },
    { id: 'revenue', requires: [], run: () => buildRevenue(fiscal, buildDate) },
    { id: 'expenditure', requires: [], run: () => buildExpenditure(fiscal, buildDate) },
    {
      id: 'annual-periods',
      requires: ['outlook', 'revenue', 'expenditure'],
      run: (read) => {
        const lineage = new AnnualLineage(forecast, bill, archives);
        const annual = buildAnnualPeriods(forecast, lineage);
        return {
          lineage,
          outlook: { ...(read('outlook') as object), byPeriod: annual.outlook },
          revenue: { ...(read('revenue') as object), byPeriod: annual.revenue },
          expenditure: { ...(read('expenditure') as object), byPeriod: annual.expenditure },
        };
      },
    },
    {
      id: 'budget-2027',
      requires: ['annual-periods'],
      run: (read) =>
        buildBudget2027((read('annual-periods') as { lineage: AnnualLineage }).lineage, buildDate),
    },
    {
      id: 'measures',
      requires: [],
      run: () => buildMeasures(fiscal.measures, fiscal.excerpts, buildDate),
    },
  ];
}

export function runFiscalGraph(input: FiscalGraphInput) {
  return runGraph(fiscalStages(input));
}
