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
});
