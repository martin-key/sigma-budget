import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { Context } from './context.js';
import { kfp, type KfpEvidence } from './kfp.js';
import { runWave18 } from './kfp-runner.js';
const root = fileURLToPath(new URL('../../test/fixtures/wave18', import.meta.url));
const captures = JSON.parse(readFileSync(`${root}/captures.json`, 'utf8'));
const expected = JSON.parse(readFileSync(`${root}/expected.json`, 'utf8'));
const evidence: KfpEvidence = { rawPresent: true, reports: {}, filesByYear: {} };
for (const capture of captures.reports) {
  evidence.reports[`${capture.year}/${capture.filename}`] = capture;
  (evidence.filesByYear[capture.year] ??= []).push(capture.filename);
}
it('matches all results of the unchanged donor with present and absent originals', () => {
  const ctx = new Context(root);
  expect(JSON.parse(JSON.stringify(kfp(ctx, evidence)))).toEqual(expected.present);
  expect(
    JSON.parse(JSON.stringify(kfp(ctx, { rawPresent: false, reports: {}, filesByYear: {} }))),
  ).toEqual(expected.absent);
});

const differential = JSON.parse(readFileSync(`${root}/differential.json`, 'utf8'));
for (const scenario of differential.cases) {
  it(`matches independent donor mutation: ${scenario.name}`, () => {
    const ctx = new Context(root);
    const inputOps = scenario.ops.filter((op: any) => op.kind === 'input');
    if (inputOps.length) {
      const originalText = ctx.text.bind(ctx),
        rawText = originalText('execution.json');
      const parsed = JSON.parse(rawText);
      const percent = inputOps[0].path[0] === 'latest',
        row = inputOps[0].path[0] === 'rows';
      const old = row
        ? parsed.rows[0].row
        : percent
          ? parsed.latest.kfp.rev.pctPlan
          : parsed.data['2024'].kfp.rev[0];
      const prefix = row
        ? `"short":${JSON.stringify(parsed.rows[0].short)},"row":`
        : percent
          ? '"pctPlan":'
          : '"kfp":{"rev":[';
      const needle = prefix + JSON.stringify(old);
      if (!rawText.includes(needle)) throw new Error('encoded mutation target missing');
      const changed = rawText.replace(
        needle,
        prefix + (inputOps[0].literal ?? JSON.stringify(inputOps[0].value)),
      );
      ctx.text = (name: string) => (name === 'execution.json' ? changed : originalText(name));
    }
    const docs: Record<string, any> = {};
    for (const name of [
      'execution.json',
      'outlook.json',
      'revenue.json',
      'expenditure.json',
      'components.json',
    ])
      if (name !== 'execution.json' || !inputOps.length)
        docs[name] = structuredClone(ctx.get(name));
    const forecast = structuredClone(ctx.proto('budget_forecast_2027.json')) as any;
    const originalGet = ctx.get.bind(ctx),
      originalProto = ctx.proto.bind(ctx);
    ctx.get = (name: string) => (name in docs ? docs[name] : originalGet(name));
    ctx.proto = (name: string) =>
      name === 'budget_forecast_2027.json' ? forecast : originalProto(name);
    const input = structuredClone(evidence);
    for (const op of scenario.ops) {
      if (op.kind === 'data' || op.kind === 'delete') {
        let obj = op.name === 'forecast' ? forecast : docs[op.name];
        for (const key of op.path.slice(0, -1)) obj = obj[key];
        if (op.kind === 'delete') delete obj[op.path.at(-1)];
        else obj[op.path.at(-1)] = op.value;
      } else if (op.kind === 'cell') {
        const cap = input.reports[`${op.year}/${op.file}`]!;
        cap.cells[op.row]![op.col] = {
          type: op.cellType,
          value: op.value,
        };
      } else if (op.kind === 'dims') {
        const cap = input.reports[`${op.year}/${op.file}`]!;
        cap.dims = op.value;
        cap.cells = cap.cells.slice(0, op.value[0]).map((row) => row.slice(0, op.value[1]));
      } else if (op.kind === 'missing') {
        delete input.reports[`${op.year}/${op.file}`];
        input.filesByYear[op.year] = input.filesByYear[op.year]!.filter((name) => name !== op.file);
      } else if (op.kind === 'extra') input.filesByYear[op.year]!.push(op.file);
    }
    if (scenario.expected.crash) {
      try {
        kfp(ctx, input);
        expect.fail('expected donor crash');
      } catch (error) {
        expect(`${(error as Error).name}: ${(error as Error).message}`).toBe(
          scenario.expected.crash,
        );
        const group = runWave18(ctx, input, ['KFP']).groups[0]!;
        expect(group.n).toBe(1);
        expect(group.problems).toEqual([`group crashed: ${scenario.expected.crash}`]);
      }
    } else {
      const result = JSON.parse(JSON.stringify(kfp(ctx, input)));
      expect(result).toEqual(scenario.expected);
    }
  });
}
