/** Additional safety checks, deliberately separate from frozen donor parity. */
import { Check, isnum } from './checks.js';
import type { Context } from './context.js';
import type { Group } from './runner.js';
import { isIsoDay } from '../common/dates.js';
import { validateMunicipalityGeometry } from '../build/municipality-geometry.js';

export function debtSafety(ctx: Context): Check {
  const c = new Check('DEBT_SAFETY'),
    d = ctx.get('debt.json');
  c.ok(
    d.quarterly.eurostat.pctGdp.every(isnum),
    'quarterly.eurostat.pctGdp: finite numbers required',
  );
  return c;
}

export function municipalSafety(ctx: Context): Check {
  const c = new Check('MUNIC_SAFETY'),
    m = ctx.get('municipalities.json');
  for (const item of m.items)
    c.ok(
      Object.values(item.perCapita).every(isnum),
      `${item.id}: all perCapita values must be finite numbers`,
    );
  for (const f of ctx.get('geo/obshtini.json').features) {
    try {
      // This is a topology predicate, not a dataset builder. Its historical opt-in
      // admits only the two existing exact coordinate hashes for SZR36.
      const g = f.geometry;
      if (!['Polygon', 'MultiPolygon'].includes(g.type))
        throw new Error('unsupported geometry type');
      validateMunicipalityGeometry(
        g.type === 'Polygon' ? [g.coordinates] : g.coordinates,
        f.properties.id,
        { preserveHistoricalChirpan: true },
      );
      c.ok(true, `geo ${f.properties.id}: topology`);
    } catch (error) {
      c.fail(`geo ${f.properties.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  c.warn(
    'Historical SZR36 topology is retained only at the existing exact coordinate hashes; original historical GISCO response unavailable.',
  );
  return c;
}

export function sebraSafety(ctx: Context): Check {
  const c = new Check('SEBRA_SAFETY'),
    s = ctx.get('sebra.json');
  for (const value of [
    s.meta.asOf,
    s.period.from,
    s.period.to,
    ...s.days.map((d: any) => d.date),
    s.publication.retrieved,
    s.publication.sectionPublished,
    ...s.publication.files.flatMap((f: any) => [f.day, f.listedOn]),
  ])
    c.ok(isIsoDay(value), `SEBRA date must be a real calendar day: ${String(value)}`);
  return c;
}

export const debtLocalSafetyGroups: Group<Context>[] = [
  {
    name: 'DEBT_SAFETY',
    run: debtSafety,
    description: 'Additional finite quarterly percentages; outside donor parity',
  },
  {
    name: 'MUNIC_SAFETY',
    run: municipalSafety,
    description:
      'Additional numeric per-capita and topology checks with exact historical SZR36 exception',
  },
  {
    name: 'SEBRA_SAFETY',
    run: sebraSafety,
    description: 'Additional Gregorian calendar checks; outside donor parity',
  },
];
