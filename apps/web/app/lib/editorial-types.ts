export interface EditorialCore {
  build?: {
    dataVersion?: string;
    kfpLatest?: string;
    kfpNext?: string;
    kfpPublished?: string;
    kfpMonths2026?: number;
    eurRate?: number;
  };
  counts?: {
    budgets?: number;
    programs?: number;
    measures?: number;
    terms?: number;
    municipalities?: number;
  };
  meta?: { retrieved?: string };
  pending?: Record<string, { title?: string; screens?: string[] }>;
}
