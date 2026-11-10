/** Injection boundary for independent raw readers being implemented separately.
 * Missing/captured evidence is a failure here, never a complete-source PASS.
 * Donor DEBT/MUNIC/SEBRA rules themselves do not re-read original documents.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { Check } from './checks.js';
import { safePath, type Context } from './context.js';
import type { Group } from './runner.js';

export const debtLocalSourceRequirements = {
  DEBT: [
    'asbp-zdd',
    'asbp-structure',
    'asbp-issuance',
    'adopted-law-limits',
    'eurostat-annual',
    'eurostat-quarterly',
    'bnb-gg',
    'bnb-cg',
    'gdp-vintages',
  ],
  MUNIC: [
    'adopted-law-transfers',
    'gisco-identities-population',
    'gisco-geometry',
    'eurostat-oblast-population',
  ],
  SEBRA: ['publication-listing', 'xlsx-payments', 'ministry-identity'],
} as const;
export type DebtLocalName = keyof typeof debtLocalSourceRequirements;
const sourceIds: Record<DebtLocalName, readonly string[]> = {
  DEBT: ['asbp', 'zdb', 'eurostat', 'bnb'],
  MUNIC: ['zdb', 'gisco', 'eurostat'],
  SEBRA: ['sebra'],
};
export interface OriginalPin {
  /** Expected registry pin, supplied independently of the reader's observations. */
  source: string;
  path: string;
  sha256: string;
}
export interface SourceAssertion {
  scope: string;
  /** Original document paths actually read to derive this expected value. */
  originals: string[];
  file: string;
  /** RFC 6901 pointer in a published dataset (empty string means the whole file). */
  pointer: string;
  expected: unknown;
  /** Only source-printed precision, never a blanket dataset tolerance. */
  tolerance?: number;
}
export type SourceReadResult =
  | { level: 'unavailable' | 'captured'; reason: string }
  | { level: 'original'; assertions: SourceAssertion[] };
export interface DebtLocalSourceBinding {
  pins: readonly OriginalPin[];
  /** Must parse the actual pinned documents, independently of the production builder. */
  read: (context: Context) => SourceReadResult;
}
export type DebtLocalSourceBindings = Partial<Record<DebtLocalName, DebtLocalSourceBinding>>;

function at(value: any, pointer: string): unknown {
  if (pointer === '') return value;
  if (!pointer.startsWith('/')) throw new Error(`invalid source assertion pointer: ${pointer}`);
  for (const key of pointer
    .slice(1)
    .split('/')
    .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'))) {
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key))
      throw new Error(`missing source assertion target: ${pointer}`);
    value = value[key];
  }
  return value;
}

export function createDebtLocalSourceGroups(bindings: DebtLocalSourceBindings): Group<Context>[] {
  return (Object.keys(debtLocalSourceRequirements) as DebtLocalName[]).map((name) => ({
    name: `${name}_SOURCE`,
    description: `Independent pinned original evidence for ${name}; explicit reader binding required`,
    run(ctx) {
      const c = new Check(`${name}_SOURCE`),
        binding = bindings[name];
      if (!binding) {
        c.fail(`${name}: independent original reader is not bound`);
        return c;
      }
      const paths = new Set<string>();
      c.ok(binding.pins.length > 0, `${name}: original pins required`);
      for (const pin of binding.pins) {
        const valid =
          sourceIds[name].includes(pin.source) &&
          /^[a-f0-9]{64}$/.test(pin.sha256) &&
          !paths.has(pin.path);
        c.ok(valid, `${name}: source identity / unique pin ${pin.path}`);
        paths.add(pin.path);
        const bytes = readFileSync(safePath(ctx.root, pin.path));
        c.ok(
          createHash('sha256').update(bytes).digest('hex') === pin.sha256,
          `${name}: original hash ${pin.path}`,
        );
      }
      if (c.problems.length) return c;
      const result = binding.read(ctx);
      if (result.level !== 'original') {
        c.fail(`${name}: ${result.level} evidence: ${result.reason}`);
        return c;
      }
      for (const scope of debtLocalSourceRequirements[name])
        c.ok(
          result.assertions.some((a) => a.scope === scope),
          `${name}: missing required source scope ${scope}`,
        );
      for (const a of result.assertions) {
        c.ok(
          (debtLocalSourceRequirements[name] as readonly string[]).includes(a.scope) &&
            a.originals.length > 0 &&
            a.originals.every((p) => paths.has(p)),
          `${name}: assertion original identity ${a.scope}`,
        );
        const actual = at(ctx.get(a.file), a.pointer),
          message = `${name} source ${a.scope}: ${a.file}#${a.pointer}`;
        if (a.tolerance === undefined) c.ok(isDeepStrictEqual(actual, a.expected), message);
        else {
          c.ok(Number.isFinite(a.tolerance) && a.tolerance >= 0, `${message}: invalid tolerance`);
          c.near(actual, a.expected, a.tolerance, message);
        }
      }
      c.fact(
        `${name}: ${binding.pins.length} pinned originals; ${result.assertions.length} independently read assertions (coverage is supplied by the reader adapter)`,
      );
      return c;
    },
  }));
}
