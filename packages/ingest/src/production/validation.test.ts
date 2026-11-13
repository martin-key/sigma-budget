import { expect, it } from 'vitest';
import { Check, pyRepr } from '../validate/checks.js';
import { applyWave17aExceptions } from '../validate/wave17a.js';
import { acceptProductionCatalogCounts } from './validation.js';

const unlisted =
  "files on disk but not in the catalog: ['dbp2027.json', 'sebra.json']; in the catalog but not on disk: []";
const counts = { datasets: 32, files: 67, real: 26, mock: 0, pending: 6, primarySources: 74 };
const mismatch = (actual = { ...counts, files: 69 }) =>
  `counts ${pyRepr(counts)} do not match the catalog ${pyRepr(actual)}`;
function check(problem = mismatch(), observation = unlisted) {
  const c = new Check('CATALOG');
  c.fail(observation);
  c.fail(problem);
  const accepted = applyWave17aExceptions(c);
  return { c, accepted, result: acceptProductionCatalogCounts(c, accepted) };
}

it('accepts only the unchanged two-file defect after its observation was accepted in this run', () => {
  const { c, accepted, result } = check();
  expect(c.problems).toEqual([]);
  expect(result).toEqual([{ group: 'CATALOG', problem: mismatch(), reason: accepted[0]!.reason }]);
  expect(result[0]!.reason).toContain('sebra.json');
  expect(result[0]!.reason).toContain('dbp2027.json');
});
it.each(['datasets', 'real', 'mock', 'pending', 'primarySources'] as const)(
  'retains the failure when %s also differs',
  (key) => {
    const problem = mismatch({ ...counts, files: 69, [key]: counts[key] + 1 });
    const { c, result } = check(problem);
    expect(result).toEqual([]);
    expect(c.problems).toEqual([problem]);
  },
);
it.each([66, 67, 68, 70])('retains a different file delta (%i)', (files) => {
  const problem = mismatch({ ...counts, files });
  expect(check(problem).c.problems).toEqual([problem]);
});
it('rejects a third unlisted file, even when its count difference agrees', () => {
  const observation =
    "files on disk but not in the catalog: ['dbp2027.json', 'other.json', 'sebra.json']; in the catalog but not on disk: []";
  const problem = mismatch({ ...counts, files: 70 });
  const { c, result, accepted } = check(problem, observation);
  expect(accepted).toEqual([]);
  expect(result).toEqual([]);
  expect(c.problems).toEqual([observation, problem]);
});
it('requires the accepted observation from this invocation and the CATALOG group', () => {
  const c = new Check('CATALOG');
  c.fail(mismatch());
  expect(acceptProductionCatalogCounts(c, [])).toEqual([]);
  expect(c.problems).toEqual([mismatch()]);
  const other = new Check('CORE');
  other.fail(mismatch());
  expect(acceptProductionCatalogCounts(other, check().accepted)).toEqual([]);
  expect(other.problems).toEqual([mismatch()]);
});
it.each([
  mismatch().replace("'files': 67", "'files': 67, 'extra': 1"),
  mismatch().replace("'files': 67", "'files': 67.0"),
  mismatch().replace("'files': 67", "'files': -1"),
])('rejects malformed or extended count observations: %s', (problem) => {
  expect(check(problem).c.problems).toEqual([problem]);
});
