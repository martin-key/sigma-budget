import {
  EXTRA_EXPECTATIONS,
  TABLE_VINTAGES,
  STATUS_HEADERS,
  REVENUE,
  EXPENDITURE,
  SUM_RULES,
} from './forecast-schema.js';
import type { ForecastTable, RecordData } from './forecast.js';
import { forecastNumber } from './forecast.js';
import { pythonFloatSum } from '../../common/numbers.js';
export function validateForecast(
  tables: Record<string, ForecastTable>,
  inventory: RecordData,
): RecordData[] {
  const checks: RecordData[] = [],
    eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const check = (name: string, passed: unknown, detail: RecordData = {}) =>
    checks.push({ name, passed: Boolean(passed), ...detail });
  const close = (name: string, actual: number, expected: number, tolerance: number) =>
    check(name, Math.abs(actual - expected) <= tolerance + 1e-8, { actual, expected, tolerance });
  const values = (k: string, r: number): number[] => tables[k]!.rows[r]!.values as number[];
  const counts: Record<string, [number, number]> = {
    I_2: [16, 6],
    II_1: [15, 5],
    II_2: [17, 5],
    II_3: [10, 5],
    II_5: [25, 8],
    III_1: [32, 8],
    VI_1: [6, 5],
    VI_2: [19, 5],
    annex1_execution2025: [18, 5],
    annex1_execution2026: [18, 5],
    annex3_mln: [63, 5],
    annex3_pct_gdp: [64, 5],
    annex4: [50, 3],
    annex2: [100, 4],
  };
  for (const [key, [nr, nc]] of Object.entries(counts)) {
    const t = tables[key]!;
    check(
      key + ' shape',
      t.rows.length === nr &&
        t.columns.length === nc &&
        t.rows.every((r) => r.values.length === nc && r.label),
    );
  }
  tables.annex2!.rows.forEach((r, i) => {
    for (let c = 0; c < 4; c++) {
      const printed =
        r.fragments
          .map((f: RecordData) => f.printed[c])
          .filter(Boolean)
          .join(' ') || null;
      check(
        `Annex2 fragment alignment ${i}/${c}`,
        r.printed[c] === printed && r.values[c] === (printed ? forecastNumber(printed) : null),
      );
    }
  });
  const rows = tables.annex2!.rows,
    expected = tables.annex2!.source_semantics,
    ids = rows.map((r) => r.source_id),
    headings = new Map(tables.annex2!.headings.map((h: RecordData) => [h.source_id, h]));
  check('Annex2 unique source identities', ids.length === new Set(ids).size && ids.every(Boolean));
  check('Annex2 source semantics count', rows.length === expected.length);
  rows.forEach((r, i) => {
    check(
      `Annex2 heading ownership ${i}`,
      (headings.get(r.source_id) as RecordData)?.label === r.label &&
        r.parent_context.every(
          (p: RecordData) => (headings.get(p.source_id) as RecordData)?.label === p.label,
        ),
    );
    for (const field of [
      'source_id',
      'source_no',
      'label',
      'parent_context',
      'semantic_label',
      'units',
    ])
      check(`Annex2 source ${field} ${i}`, eq(r[field], expected[i][field]), { page: r.page });
  });
  for (const [key, [nr, nc, first, last]] of Object.entries(EXTRA_EXPECTATIONS)) {
    const t = tables[key]!,
      rows = t.rows;
    check(
      key + ' shape',
      rows.length === nr &&
        t.columns.length === nc &&
        rows.every((r) => r.values.length === nc && r.label),
    );
    check(key + ' first anchor', eq(rows[0]!.values, first), { page: rows[0]!.page });
    check(key + ' last anchor', eq(rows.at(-1)!.values, last), { page: rows.at(-1)!.page });
  }
  function sumRows(
    key: string,
    total: number,
    parts: number[],
    cols = tables[key]!.columns.map((_, c) => c),
  ): void {
    for (const c of cols) {
      const raw = parts.map((i) => values(key, i)[c]!).filter((v) => v !== null);
      close(
        `${key} sum ${total}/${c}`,
        pythonFloatSum(raw),
        values(key, total)[c]!,
        0.05 * (parts.length + 1),
      );
    }
  }
  const even = [0, 2, 4, 6];
  sumRows('II_6', 1, [2, 3], even);
  sumRows('II_6', 7, [0, 1, 4, 6], even);
  sumRows('II_6', 15, [8, 9, 10, 11, 12, 13, 14], even);
  sumRows('II_6', 19, [7, 16], even);
  sumRows('II_6', 20, [15, 17, 18], even);
  sumRows(
    'II_7',
    26,
    Array.from({ length: 26 }, (_, i) => i),
  );
  sumRows(
    'II_8',
    10,
    Array.from({ length: 10 }, (_, i) => i),
    [0],
  );
  for (let c = 0; c < 5; c++)
    close(
      `II_9 balance/${c}`,
      values('II_9', 2)[c]! - values('II_9', 3)[c]!,
      values('II_9', 4)[c]!,
      0.05 * 3,
    );
  sumRows('III_2', 0, [1, 2, 3, 4]);
  sumRows('IV_1', 0, [1, 2, 3, 4]);
  for (let i = 0; i < 5; i++)
    close(
      `IV_1 local+delegated/${i}`,
      pythonFloatSum(values('IV_1', i).slice(1, 3)),
      values('IV_1', i)[0]!,
      0.05 * 3,
    );
  for (const key of ['V_1', 'V_2']) sumRows(key, 2, [0, 1]);
  sumRows('VII_1', 0, [1, 2, 3]);
  sumRows('annex6', 5, [6, 7]);
  for (const key of ['annex7', 'annex8'])
    tables[key]!.rows.forEach((r, i) => {
      for (const c of [0, 3, 6])
        close(
          `${key} expenditure-transfer ${i}/${c}`,
          (r.values[c + 1] ?? 0) - (r.values[c + 2] ?? 0),
          r.values[c] ?? 0,
          0.05 * 3,
        );
    });
  for (const [total, parts] of [
    [0, [1, 2, 5]],
    [2, [3, 4]],
    [5, [6, 7]],
  ] as [number, number[]][])
    sumRows('annex9', total, parts);
  for (let c = 0; c < 2; c++) {
    close(
      `annex10 integer total/${c}`,
      pythonFloatSum([0, 1, 2, 3].map((i) => values('annex10', i)[c]!)),
      values('annex10', 4)[c]!,
      2.5,
    );
    check(
      `annex10 GDP ratio/${c}`,
      Math.abs(
        (values('annex10', 4)[c]! / values('annex10', 5)[c]!) * 100 - values('annex10', 6)[c]!,
      ) <= 0.005,
    );
  }
  for (const [key, t] of Object.entries(tables)) {
    check(
      key + ' printed vintages',
      eq(
        t.columns.map((c) => c.vintage ?? null),
        (TABLE_VINTAGES as RecordData)[key] ?? Array(t.columns.length).fill(null),
      ),
    );
    check(
      key + ' status headers',
      t.status_headers.every((h: RecordData) =>
        eq(h.printed, (STATUS_HEADERS as RecordData)[key] ?? []),
      ),
    );
  }
  const scenario = tables.II_6!;
  check(
    'II_6 comparison dimension',
    eq(
      scenario.columns.map((c) => c.measure),
      Array(4).fill(['baseline', 'difference_from_main_scenario_pct']).flat(),
    ),
  );
  for (const h of scenario.scenario_headers)
    check(
      `II_6 printed scenario header p${h.page}`,
      eq(
        h.printed,
        Array(4).fill(['Базисен сценарий', 'Изменение спрямо основния сценарий, %']).flat(),
      ),
    );
  check(
    'II_6 printed GDP-share headers',
    eq(scenario.gdp_share_headers.printed, Array(4).fill('% от БВП')),
  );
  for (const r of scenario.rows)
    check(
      'II_6 row measure ' + r.label,
      eq(
        r.measures ?? null,
        r.label.startsWith('17.') || r.label.startsWith('18.')
          ? Array(4).fill(['baseline', 'gdp_share_pct']).flat()
          : null,
      ),
    );
  for (const [key, i, expected] of [
    ['I_2', 0, [104767, 116018, 130459, 141302, 150819, 160013]],
    ['II_1', 0, [44016.4, 49615.3, 51065.2, 53963.3, 56927.2]],
    ['II_1', 5, [47508.7, 56807.2, 55972.1, 58692.2, 60805.7]],
    ['II_1', 11, [-3492.2, -7191.9, -4907, -4728.8, -3878.4]],
    ['VI_1', 0, [31428.9, 37699, 44343.9, 50657.3, 56747.8]],
  ] as [string, number, number[]][])
    check(`${key} anchor ${i}`, eq(values(key, i), expected), { expected, actual: values(key, i) });
  function identity(
    key: string,
    total: number,
    parts: number[],
    cols = tables[key]!.columns.map((_, c) => c),
  ): void {
    for (const c of cols) {
      const a = values(key, total)[c]!,
        vv: (number | null)[] = [];
      for (const p of parts) {
        const v = values(key, p)[c]!;
        if (key === 'annex3_mln' && ['20/2', '20/3', '20/4', '54/0'].includes(`${p}/${c}`)) {
          check(
            `Annex3 structural blank ${p}/${c}`,
            v === null && tables[key]!.rows[p]!.printed[c] === null,
          );
          continue;
        }
        vv.push(v);
      }
      check(`${key} numeric ${total}/${c}`, a !== null && vv.every((v) => v !== null));
      if (a !== null && vv.every((v) => v !== null))
        close(
          `${key} sum ${total}/${c}`,
          pythonFloatSum(vv as number[]),
          a,
          0.05 * (vv.length + 1),
        );
    }
  }
  for (const key of ['II_1', 'II_2'])
    for (const [t, p] of [
      [0, [2, 3, 4]],
      [5, [7, 10]],
      [7, [8, 9]],
    ] as [number, number[]][])
      identity(key, t, p);
  identity('VI_1', 0, [2, 4]);
  for (const [t, p] of [
    [0, [1, 2, 3]],
    [4, [5, 6, 7, 8, 9]],
    [12, [13, 14, 15]],
    [16, [17, 18]],
    [19, [20, 21, 22, 23]],
    [24, [25, 26, 27, 28, 29, 30]],
  ] as [number, number[]][])
    identity('III_1', t, p, [0, 1, 2, 3]);
  for (let c = 0; c < 5; c++) {
    close(
      `II_1 revenue-expenditure ${2025 + c}`,
      values('II_1', 0)[c]! - values('II_1', 5)[c]!,
      values('II_1', 11)[c]!,
      0.15,
    );
    for (const [main, national, eu] of [
      [0, 0, 0],
      [5, 5, 2],
      [11, 13, 6],
      [13, 15, 8],
    ])
      close(
        `CFP national+EU ${main}/${2025 + c}`,
        values('II_2', national!)[c]! + values('II_3', eu!)[c]!,
        values('II_1', main!)[c]!,
        0.15,
      );
    for (const [key, expense, transfer, balance] of [
      ['II_2', 5, 11, 13],
      ['II_3', 2, 4, 6],
    ] as const)
      close(
        `${key} revenue-expenditure+transfer ${2025 + c}`,
        values(key, 0)[c]! - values(key, expense)[c]! + values(key, transfer)[c]!,
        values(key, balance)[c]!,
        0.2,
      );
    for (const [a, b] of [
      [0, 4],
      [4, 8],
      [8, 10],
      [10, 14],
      [14, 18],
    ] as [number, number][]) {
      const parts = Array.from({ length: b - a }, (_, i) =>
        values('VI_2', a + i)[c] === null && tables.VI_2!.rows[a + i]!.printed[c] === '-'
          ? 0
          : values('VI_2', a + i)[c]!,
      );
      check(
        `VI_2 numeric ${a}/${c}`,
        parts.every((v) => v !== null),
      );
      if (parts.every((v) => v !== null))
        close(`VI_2 shares ${a}/${c}`, pythonFloatSum(parts), 100, 0.05 * (parts.length + 1));
    }
  }
  tables.II_1!.rows.forEach((r, i) => {
    const key = r.printed[0]!.endsWith('%') ? 'annex3_pct_gdp' : 'annex3_mln';
    check(
      `II_1 vs ${key} row ${i}`,
      tables[key]!.rows.some((a) => eq(a.values, r.values)),
    );
  });
  const gdp = values('annex3_pct_gdp', 63);
  tables.annex3_mln!.rows.forEach((a, i) => {
    const p = tables.annex3_pct_gdp!.rows[i]!;
    check(`Annex3 paired label ${i}`, a.label === p.label);
    a.values.forEach((v, c) => {
      const pct = p.values[c]!;
      check(`Annex3 blank pattern ${i}/${c}`, (v === null) === (pct === null));
      if (v !== null && pct !== null)
        close(`Annex3 GDP local ${i}/${2025 + c}`, (v / gdp[c]!) * 100, pct, 0.0501);
    });
  });
  const spec = [...REVENUE, ...EXPENDITURE],
    indices = Object.fromEntries(spec.map((r, i) => [r[0], i]));
  spec.forEach(([rid, label], i) =>
    check('Annex3 hierarchy label ' + rid, tables.annex3_mln!.rows[i]!.label === label),
  );
  for (const [p, children] of Object.entries(SUM_RULES))
    identity(
      'annex3_mln',
      indices[p]!,
      children.map((k) => indices[k]!),
    );
  for (let c = 0; c < 5; c++) {
    close(
      `Annex3 balance ${2025 + c}`,
      values('annex3_mln', 0)[c]! - values('annex3_mln', 31)[c]!,
      values('annex3_mln', 61)[c]!,
      0.15,
    );
    close(
      `Annex3 financing ${2025 + c}`,
      values('annex3_mln', 61)[c]! + values('annex3_mln', 62)[c]!,
      0,
      0.1,
    );
    close(
      `Annex3 noninterest ${2025 + c}`,
      values('annex3_mln', 32)[c]! - values('annex3_mln', 57)[c]!,
      values('annex3_mln', 33)[c]!,
      0.15,
    );
  }
  for (let c = 0; c < 4; c++) {
    close(
      `ESA revenue-expenditure ${2026 + c}`,
      values('II_5', 20)[c * 2]! - values('II_5', 21)[c * 2]!,
      values('II_5', 22)[c * 2]!,
      0.15,
    );
    tables.III_1!.rows.forEach((r, i) =>
      close(
        `functions GDP ${i}/${2026 + c}`,
        (r.values[c]! / gdp[c + 1]!) * 100,
        r.values[c + 4]!,
        0.0501,
      ),
    );
  }
  for (const key of ['annex1_execution2025', 'annex1_execution2026'])
    for (const [i, r] of tables[key]!.rows.entries()) {
      if (r.printed.at(-1)?.endsWith('%')) r.units[r.units.length - 1] = '% от закона';
      const [law, actual, national, eu, pct] = r.values;
      if (actual !== null && national !== null && eu !== null)
        close(`${key} national+EU ${i}`, national! + eu!, actual!, 0.15);
      if (law && actual !== null && pct !== null)
        close(
          `${key} percent law ${i}`,
          (actual! / law) * 100,
          pct!,
          0.05 +
            100 *
              (0.05 / Math.abs(law) +
                (Math.abs(actual!) * 0.05) / (Math.abs(law) * (Math.abs(law) - 0.05))),
        );
    }
  for (let c = 0; c < 5; c++) {
    const local = values('I_2', 0)[c + 1]!;
    if (c === 0)
      check('GDP I-2 vs Annex3 2025 known discrepancy', local === 116018 && gdp[c] === 116548.5, {
        pages: [27, 194],
        source_discrepancy: true,
        actual: local,
        expected: gdp[c],
        reason:
          '2025 GDP differs between I-2 and Annex 3; ratios use the GDP printed in their own table.',
      });
    else close(`GDP I-2 vs Annex3 ${2025 + c}`, local, gdp[c]!, 0.55);
  }
  for (const key of inventory.numbered_tables)
    check('inventory ' + key, Boolean(tables[key]?.rows.length));
  for (const a of inventory.annexes)
    check(
      'inventory ' + a.id,
      Object.keys(tables).some((k) => k === a.id || k.startsWith(a.id + '_')),
    );
  return checks;
}
