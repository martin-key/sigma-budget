// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { budgetExecution } from '../../client/ui/budget-execution.js';
it('renders distinct scopes, law blanks and missing central 2025 without unsafe HTML', () => {
  const meta = { title: 'Държавен бюджет', source: [], asOf: '2026-11-13' };
  const row = { row: 10, label: 'Данъчни приходи <script>', eur: [null, 1] };
  const data = {
    'state-budget': {
      meta,
      sourcePage: 'https://www.minfin.bg/bg/statistics/18',
      limitations: ['Само държавен бюджет'],
      tables: [{ year: 2026, period: 1, rows: [row] }],
    },
    'kfp-subsectors': {
      meta: { ...meta, title: 'КФП по подсектори' },
      sourcePage: 'https://www.minfin.bg/bg/statistics/6',
      limitations: ['Тримесечни потоци'],
      missing: [
        { reason: 'Централното правителство за 2025 г. липсва: връзката на МФ сочи 2024 г.' },
      ],
      tables: [{ scope: 'social', year: 2026, columns: [{ id: 'Q1' }, { id: 'Q2' }], rows: [row] }],
    },
  };
  const text = String(budgetExecution({ data }));
  expect(text).toContain('<table');
  expect(text).toContain('href="https://www.minfin.bg/bg/statistics/18"');
  expect(text).toContain('href="https://www.minfin.bg/bg/statistics/6"');
  expect(text).toContain('Държавен бюджет');
  expect(text).toContain('Социалноосигурителни фондове (ДОО и НЗОК)');
  expect(text).toContain('2025 г. липсва');
  expect(text).toContain('—');
  expect(text).not.toContain('<script>');
  expect(text).toContain('&lt;script&gt;');
  expect(budgetExecution({ data: {} })).toBe('');
});
