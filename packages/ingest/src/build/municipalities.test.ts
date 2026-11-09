import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseJsonStat } from '../io/data.js';
import { buildMunicipalities, type MunicipalityInput } from './municipalities.js';
const root = fileURLToPath(new URL('../../test/fixtures/debt-local/', import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(root + name, 'utf8'));
const input = (): MunicipalityInput => ({
  art: read('inputs/data/cache/law_bill.json').municipal.art51,
  proto: read('inputs/data/inputs/municipal_transfers_2026.json'),
  gis: read('inputs/data/cache/gisco_lau_bg.json'),
  oblast: (() => {
    const v = read('inputs/data/cache/eurostat_pop_nuts3_bg.json');
    v.jsonstat = parseJsonStat(JSON.stringify(v.jsonstat));
    return v;
  })(),
  population: read('inputs/data/inputs/population.json'),
});
describe('Municipalities and geographic data', () => {
  it('matches both complete independent Python outputs', () => {
    const result = buildMunicipalities(input(), '2026-11-08');
    expect(result.municipalities).toEqual(read('donor/municipalities.json'));
    expect(result.geo).toEqual(read('donor/geo/obshtini.json'));
  });
  it('recomputes transfers when both independently supplied law tables change consistently', () => {
    const original = input();
    const changed = input();
    for (const [i, delta] of [
      [0, 1],
      [1, -1],
    ] as const) {
      changed.art.law.rows[i]!.values[0]! += delta;
      changed.art.law.rows[i]!.values[1]! += delta;
      changed.proto.municipalities[i]!.total! += delta;
      changed.proto.municipalities[i]!.delegated! += delta;
    }
    const a = buildMunicipalities(original, '2026-11-08');
    const b = buildMunicipalities(changed, '2026-11-08');
    expect(b.municipalities.items).not.toEqual(a.municipalities.items);
    expect(b.municipalities.totals).toEqual(a.municipalities.totals);
  });
  it('rejects a changed source row, duplicate code, population and broken geometry', () => {
    const row = input();
    row.art.law.rows[0]!.values[0]! += 1;
    expect(() => buildMunicipalities(row, '2026-11-08')).toThrow();
    const code = input();
    code.gis.items[0]!.id = code.gis.items[1]!.id;
    expect(() => buildMunicipalities(code, '2026-11-08')).toThrow();
    const pop = input();
    pop.gis.items[0]!.pop += 1;
    expect(() => buildMunicipalities(pop, '2026-11-08')).toThrow();
    const geo = input();
    geo.gis.items[0]!.rings = [
      [
        [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
      ],
    ];
    expect(() => buildMunicipalities(geo, '2026-11-08')).toThrow();
  });
  it('accepts the Python 3.12 half-tenth column change without widening tolerances', () => {
    const changed = input();
    for (const [column, key] of [
      [0, 'total'],
      [1, 'delegated'],
    ] as const) {
      changed.art.law.rows[0]!.values[column]! += 0.05;
      changed.art.law.total[column]! += 0.05;
      changed.proto.municipalities[0]![key]! += 0.05;
      changed.proto.sums[key]! += 0.05;
    }
    const actual = buildMunicipalities(changed, '2026-11-08').municipalities as any;
    expect(actual.check.columnSums).toEqual([4887464, 4351706, 255658, 25100, 255000, 40500]);
  });
  it('rejects fractional oblast population even when the national sum is unchanged', () => {
    const changed = input();
    const stat = changed.oblast.jsonstat;
    const index = (geo: string, year: string) => {
      let position = 0;
      for (let i = 0; i < stat.id.length; i++) {
        const dimension = stat.id[i]!;
        const category = stat.dimension[dimension]!.category.index as Record<string, number>;
        position =
          position * stat.size[i]! +
          (dimension === 'geo' ? category[geo]! : dimension === 'time' ? category[year]! : 0);
      }
      return String(position);
    };
    const values = stat.value as Record<string, number>;
    values[index('BG311', '2025')]! += 0.5;
    values[index('BG312', '2025')]! -= 0.5;
    expect(() => buildMunicipalities(changed, '2026-11-08')).toThrow(/population/i);
  });
  it.each([null, 0, -1, NaN, Infinity])('rejects invalid Dobrich area evidence: %s', (value) => {
    const changed = input();
    changed.gis.items.find((i) => i.id === 'DOB28')!.areaKm2 = value as number;
    expect(() => buildMunicipalities(changed, '2026-11-08')).toThrow(/areas/i);
  });
  it('rejects an extra law-total column', () => {
    const changed = input();
    changed.art.law.total.push(1);
    expect(() => buildMunicipalities(changed, '2026-11-08')).toThrow(/column/i);
  });
});
