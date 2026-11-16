import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { ROOT } from '../../../apps/web/scripts/serve.ts';
// Expected screen text computed from the published execution dataset.
interface Execution {
  latest: {
    month: number;
    asOf: string;
    kfp: Record<string, { cum: string | number; plan: string | number }>;
  };
  pace: Record<string, Record<string, number[]>>;
  data: Record<string, { kfp: Record<string, (string | number)[]> }>;
}
const ex: Execution = JSON.parse(readFileSync(join(ROOT, 'data/release/execution.json'), 'utf8'));
const num = (v: number, digits = 2, sign = false) => {
  const s = Math.abs(v).toFixed(digits).replace('.', ',');
  return (v < 0 && Number(s.replace(',', '.')) !== 0 ? '−' : sign ? '+' : '') + s;
};
const planRows = ['rev', 'exp.total', 'exp.capex'];
const sums = planRows.map(
  (r) =>
    `${num(Number(ex.latest.kfp[r]!.cum) / 1000)} от ${num(Number(ex.latest.kfp[r]!.plan) / 1000)}`,
);
const current = planRows.map(
  (r) => num((Number(ex.latest.kfp[r]!.cum) / Number(ex.latest.kfp[r]!.plan)) * 100, 1) + '%',
);
const previous = planRows.map((r) => num(ex.pace['2025']![r]![ex.latest.month - 1]!, 1) + '%');
const compareRows = ['rev', 'exp.total', 'balance'];
const year = Number(ex.latest.asOf.slice(0, 4));
const a = compareRows.map((r) => Number(ex.data[String(year - 1)]!.kfp[r]![ex.latest.month - 1]!));
const b = compareRows.map((r) => Number(ex.data[String(year)]!.kfp[r]![ex.latest.month - 1]!));
export const VALUE_CHECKS: Record<string, { all: string[] }> = {
  S01: {
    all: [
      'Държавният бюджет на достъпен език',
      'Разгледай бюджета за 5 минути',
      'Изпълнение на плана за 2026 г.',
      'Приходи',
      'Разходи с вноската в ЕС',
      'Капиталови разходи',
      ...current,
      ...previous,
      ...sums.map((s) => s + ' млрд. €'),
      'Виж приходите и разходите по проекта за 2027 г. и прогнозата до 2029 г., както и изпълнението за 2026 г.',
      'Откъде идват парите?',
      'За какво се харчат?',
      'Изпълнява ли се планът?',
      'Колко плащам аз?',
      'Кой харчи парите?',
      'Колко е държавният дълг?',
      'Какво се променя?',
      'Накъде върви бюджетът?',
    ],
  },
  S15: {
    all: [
      ...a.map((v) => num(v / 1000)),
      ...b.map((v) => num(v / 1000)),
      ...[0, 1].map((i) => num((b[i]! - a[i]!) / 1000, 2, true)),
      'дефицит',
    ],
  },
};
export async function visibleValues(page: Page, route: string) {
  const expected = VALUE_CHECKS[route]!;
  // innerText follows CSS: buttons and labels are drawn in capitals, so the comparison ignores case
  const text = (await page.locator('#view').innerText())
    .replace(/[\u00a0\u2007\u2009\u202f]/g, ' ')
    .toLocaleLowerCase('bg');
  return expected.all.filter((value) => text.includes(value.toLocaleLowerCase('bg')));
}
