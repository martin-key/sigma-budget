import registry from './budget-source-cells.json' with { type: 'json' };

/** Physical source addresses; generated from pinned XLS bytes, including absent BIFF cells. */
export type BudgetSourceCells = {
  file: string;
  scope: string;
  year: number;
  period: number;
  columns: string[];
  rows: number[];
  blanks: { row: number; column: string }[];
};
export const budgetSourceCells: Readonly<Record<string, BudgetSourceCells>> = registry.tables;
