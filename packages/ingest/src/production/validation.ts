import { verifyPublishedProgrammes } from './programmes.js';
import { programmeReferences } from '@sigma-budget/dataset-schema';
import { verifyDebtCells } from './debt-cells.js';
import { readTaxDatasets } from './taxes.js';
import { isPublishedDataset } from '@sigma-budget/dataset-schema';
import { isDeepStrictEqual } from 'node:util';
import { applyWave17aExceptions } from '../validate/wave17a.js';
import { productionSourceGroups } from './source-validation.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Context } from '../validate/context.js';
import { Check } from '../validate/checks.js';
import {
  runGroups,
  foundationGroups,
  applyExceptions,
  type Group,
  type Exception,
} from '../validate/runner.js';
import { wave15Groups } from '../validate/wave15.js';
import { core, catalog } from '../validate/catalog.js';
import { budget2027 } from '../validate/budget-2027.js';
import { kfp } from '../validate/kfp.js';
import { feed } from '../validate/feed.js';
import { search } from '../validate/search.js';
import { debtLocalGroups } from '../validate/debt-local-rules.js';
import { debtLocalSafetyGroups } from '../validate/debt-local-safety.js';
import { independentRuleGroups, type ExecutionLawTable } from '../validate/independent-rules.js';
import { readNapRows } from '../readers/fiscal-documents/nap.js';
import { validateRegistry } from '../validate/registry.js';
import {
  REQUIRED_VALIDATION_GROUPS,
  type ValidationGroup,
  type ExecutionContext,
} from '../release-build/types.js';
import { readPdf, spans, assert } from '../readers/pdf/index.js';
import type { PreparedProduction } from './loader.js';
import { sha256 } from './loader.js';

/** Independent physical Annex 1 selection. Only PDF transport is shared with the producer. */
export function readExecutionLaw(pdf: { bytes: Uint8Array; sha256: string }): ExecutionLawTable {
  assert(sha256(pdf.bytes) === pdf.sha256, 'Annex 1 member changed');
  const doc = readPdf(pdf.bytes),
    rows: ExecutionLawTable['rows'] = [];
  const pages = doc.pages.filter((p) => p.text.includes('Отчет 30.09.2026') && p.number > 150);
  assert(pages.length > 0, 'Annex 1 execution pages absent');
  for (const page of pages) {
    const all = spans(page),
      heads = all
        .filter((s) => s.text.startsWith('к.'))
        .sort((a, b) => a.x - b.x)
        .slice(1);
    assert(heads.length === 5, 'Annex 1 physical columns changed');
    const top = Math.max(...heads.map((h) => h.y)) + 6,
      bottom = Math.min(
        page.height - 75,
        ...all.filter((s) => s.y > top && s.text.startsWith('*')).map((s) => s.y),
      );
    const selected = all.filter((s) => top < s.y && s.y < bottom),
      numeric = selected.filter(
        (s) => s.x0 > 390 && /^[−-]?\d+(?:[\s\d]*\d)?(?:,\d+)?%?$/.test(s.text),
      );
    const groups: (typeof numeric)[] = [];
    for (const token of numeric.sort((a, b) => a.y - b.y || a.x - b.x)) {
      if (!groups.length || token.y - groups.at(-1)![0]!.y > 3) groups.push([]);
      groups.at(-1)!.push(token);
    }
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i]!,
        lo = i ? (groups[i - 1]![0]!.y + g[0]!.y) / 2 : top,
        hi = i + 1 < groups.length ? (g[0]!.y + groups[i + 1]![0]!.y) / 2 : bottom;
      const cells = heads.map((h, c) =>
        g
          .filter(
            (t) =>
              heads.reduce(
                (best, x, k) => (Math.abs(t.x - x.x) < Math.abs(t.x - heads[best]!.x) ? k : best),
                0,
              ) === c,
          )
          .map((t) => t.text)
          .join(' '),
      );
      assert(cells.some(Boolean), 'Annex 1 row has no physical numeric evidence');
      const printed = cells.map((t) => t || null),
        values = printed.map((t) =>
          t === null ? null : Number(t.replace(/[\s%]/gu, '').replace('−', '-').replace(',', '.')),
        );
      assert(
        values.every((v) => v === null || Number.isFinite(v)),
        'Annex 1 numeric token',
      );
      rows.push({
        label: selected
          .filter((s) => s.x0 <= 390 && lo <= s.y && s.y < hi)
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((s) => s.text)
          .join(' '),
        page: page.number,
        printed,
        values,
        units: cells.map((t, c) => (c === 4 && t.endsWith('%') ? '% от закона' : 'млн. €')),
      });
    }
  }
  return {
    columns: [
      ['програма', 'млн. €', 'КФП'],
      ['отчет', 'млн. €', 'КФП'],
      ['отчет', 'млн. €', 'национален бюджет'],
      ['отчет', 'млн. €', 'ЕС'],
      [undefined, '% от закона', 'КФП'],
    ].map(([vintage, unit, scope]) => ({
      year: 2026,
      ...(vintage ? { vintage } : {}),
      unit: unit!,
      scope: scope!,
    })),
    rows,
  };
}
const PRODUCTION_UNLISTED_FILES = ['dbp2027.json', 'sebra.json'] as const;
const UNLISTED_FILES_OBSERVATION =
  "files on disk but not in the catalog: ['dbp2027.json', 'sebra.json']; in the catalog but not on disk: []";
const COUNT_KEYS = ['datasets', 'files', 'real', 'mock', 'pending', 'primarySources'];

function countObservation(text: string): Record<string, number> | null {
  if (!text.startsWith('{') || !text.endsWith('}')) return null;
  const pairs = text
    .slice(1, -1)
    .split(', ')
    .map((part) => /^'([A-Za-z]+)': (0|[1-9]\d*)$/.exec(part));
  if (pairs.length !== COUNT_KEYS.length || pairs.some((pair) => !pair)) return null;
  const counts = Object.fromEntries(pairs.map((pair) => [pair![1]!, Number(pair![2])]));
  if (
    Object.keys(counts).length !== COUNT_KEYS.length ||
    !COUNT_KEYS.every((key) => Number.isSafeInteger(counts[key]))
  )
    return null;
  return counts;
}

/** The unchanged two-file defect, accepted only with its exact observation accepted in this run. */
export function acceptProductionCatalogCounts(
  c: Check,
  accepted: readonly Exception[],
): Exception[] {
  if (c.name !== 'CATALOG') return [];
  const observation = accepted.find(
    (item) => item.group === c.name && item.problem === UNLISTED_FILES_OBSERVATION,
  );
  if (!observation) return [];
  const found: Exception[] = [];
  const keep = c.problems.filter((problem) => {
    const match = /^counts (\{[^{}]+\}) do not match the catalog (\{[^{}]+\})$/.exec(problem);
    if (!match) return true;
    const declared = countObservation(match[1]!),
      actual = countObservation(match[2]!);
    if (
      !declared ||
      !actual ||
      !COUNT_KEYS.filter((key) => key !== 'files').every((key) => declared[key] === actual[key]) ||
      actual.files! - declared.files! !== PRODUCTION_UNLISTED_FILES.length
    )
      return true;
    found.push({ group: c.name, problem, reason: observation.reason });
    return false;
  });
  if (found.length) {
    c.problems.splice(0, c.problems.length, ...keep);
    c.fact(`${found.length} accepted production catalog count exception(s): ${observation.reason}`);
  }
  return found;
}

/** Keep the legacy validator's financial facts; update only its pending count for production. */
export function reviseProductionPendingFact(c: Check, pendingCount: number): void {
  if (c.name !== 'CORE') return;
  c.facts.forEach((fact, index) => {
    if (fact.startsWith('core 2026:') && fact.endsWith('; 7 pending blocks'))
      c.facts[index] = fact.replace(/7 pending blocks$/, `${pendingCount} pending blocks`);
  });
}

export function validateProduction(
  context: Readonly<ExecutionContext>,
  prepared: PreparedProduction,
): { completeValidation: true; groups: ValidationGroup[] } {
  const sourceRoot = context.preparedInputRoot ?? context.exportRoot;
  const ctx = new Context(
    sourceRoot,
    context.buildDate,
    'data',
    context.candidateRoot,
    context.generatedIntermediates,
  );
  const expected = prepared.independentIndirect;
  const sourceGroups = productionSourceGroups(context, prepared);
  const budgetTables: Group<Context> = {
    name: 'BUDGET-TABLES',
    description: 'Pinned monthly and quarterly budget tables, exact identities and missing scope',
    run(c) {
      const check = new Check('BUDGET-TABLES');
      for (const [file, expected] of Object.entries(readTaxDatasets(context))) {
        const actual = c.get(file);
        check.ok(isPublishedDataset(file, actual), file + ': strict contract');
        check.ok(
          isDeepStrictEqual(actual, expected),
          file + ': every published cell equals the pinned original and conversion',
        );
      }
      for (const [code, reference] of Object.entries(programmeReferences)) {
        verifyPublishedProgrammes(
          c.get(`ministries/${code}.json`),
          join(sourceRoot, 'data/originals/program_budgets', reference.file),
        );
        check.ok(true, `Every programme cell for ${code} equals independent PDFMiner decoding`);
      }
      const debt = c.get('debt-issues.json');
      check.ok(
        isPublishedDataset('debt-issues.json', c.get('debt-issues.json')),
        'debt issues contract',
      );
      verifyDebtCells(
        debt,
        join(sourceRoot, 'data/originals/debt/Bulletin_GovDebt_09-2026_bg.pdf'),
      );
      check.ok(true, 'every debt table cell equals independent PDFMiner extraction');
      for (const finding of debt.validation) {
        check.fact(finding.check + ': ' + finding.outcome + ' — ' + finding.reason);
        check.warn(finding.check + ': ' + finding.outcome + ' — ' + finding.reason);
      }
      return check;
    },
  };
  const groups: Group<Context>[] = [
    budgetTables,
    ...sourceGroups,
    ...foundationGroups,
    ...wave15Groups,
    { name: 'CORE', description: 'core source and derived contract', run: core },
    { name: 'CATALOG', description: 'actual owner inventory and gzip/schema facts', run: catalog },
    {
      name: 'BUDGET2027',
      description: 'physical annual PDF gates and publication rules',
      run(c) {
        const check = budget2027(c);
        for (const role of ['forecast', 'bill'] as const)
          check.ok(
            prepared.annual[role].tables !== undefined,
            'physical ' + role + ' PDF was decoded and freshness verified',
          );
        return check;
      },
    },
    {
      name: 'KFP',
      description: 'independent rules on actual decoded BIFF cells',
      run: (c) => kfp(c, prepared.kfp),
    },
    { name: 'FEED', description: 'calendar, events and actual RSS bytes', run: feed },
    {
      name: 'SEARCH',
      description: 'independent search selection and reference implementation',
      run: search,
    },
    ...debtLocalGroups,
    ...debtLocalSafetyGroups,
    ...independentRuleGroups({
      nap: readNapRows,
      indirect(originals) {
        for (const [role, o] of Object.entries(originals)) {
          if (o.sha256 !== prepared.originals[role]?.sha256 || sha256(o.bytes) !== o.sha256)
            throw new Error('Independent indirect original changed: ' + role);
        }
        return expected;
      },
      executionLaw: readExecutionLaw,
    }),
    {
      name: 'REGISTRY',
      description: 'registered closure, owners, sources, pinned inputs and exported code',
      run() {
        const c = new Check('REGISTRY');
        const paths = context.inputs.map((f) => f.path);
        c.ok(
          paths.length > 0 && new Set(paths).size === paths.length,
          'authenticated declared input closure',
        );
        const exported = readFileSync(join(context.scratchRoot, 'exported-paths.json'), 'utf8');
        const registry = validateRegistry(sourceRoot, {
          trackedPaths: JSON.parse(exported),
          outputRoot: context.candidateRoot,
          lifecycleMetadata: true,
          onCheck: () => c.n++,
        });
        for (const p of registry.errors) c.fail(p);
        c.fact(
          'Registry inspected recorded export inventory; lifecycle owns releases/current.json after package hashing',
        );
        return c;
      },
    },
  ];
  const wanted = [
    ...REQUIRED_VALIDATION_GROUPS,
    'REGISTRY',
    'BUDGET-TABLES',
    ...debtLocalSafetyGroups.map((g) => g.name),
    ...sourceGroups.map((g) => g.name),
  ];
  const result = runGroups(groups, ctx, wanted);
  for (const c of result.groups) {
    if (c.name === 'CORE')
      reviseProductionPendingFact(c, Object.keys(ctx.get('core.json').pending).length);
    applyExceptions(c, true);
    const accepted = applyWave17aExceptions(c, true);
    acceptProductionCatalogCounts(c, accepted);
  }
  const output = result.groups.map((c) => ({
    group: c.name,
    status: c.problems.length
      ? ('FAIL' as const)
      : c.warnings.length
        ? ('WARN' as const)
        : ('OK' as const),
    checks: c.n,
    summary: c.facts.join('; '),
    problems: c.problems,
    warnings: c.warnings,
  }));
  const missing = wanted.filter((name) => !output.some((g) => g.group === name));
  if (missing.length || output.some((g) => g.problems.length || g.checks === 0))
    throw new Error(
      'Production validation failed: ' +
        JSON.stringify({
          missing,
          groups: output.filter((g) => g.problems.length || g.checks === 0),
        }),
    );
  return { completeValidation: true, groups: output };
}
