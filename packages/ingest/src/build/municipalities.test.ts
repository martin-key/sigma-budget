import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseJsonStat } from '../io/data.js';
import {
  buildMunicipalities,
  municipalityGeometry,
  type MunicipalityInput,
} from './municipalities.js';
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
  it('rejects the known historical Chirpan topology in the normal API', () => {
    expect(() => buildMunicipalities(input(), '2026-11-08')).toThrow(/topology: SZR36/);
    const changed = input();
    changed.gis.items.find((i) => i.id === 'SZR36')!.rings[0]![0]![1]![0] += 0.00001;
    expect(() =>
      buildMunicipalities(changed, '2026-11-08', { preserveHistoricalChirpan: true }),
    ).toThrow(/topology/);
  });
  it('matches Python text whitespace without changing municipality identities', () => {
    const changed = input();
    changed.art.law.rows.find((r) => r.name === 'Банско')!.name += '\u0085';
    expect(
      buildMunicipalities(changed, '2026-11-08', { preserveHistoricalChirpan: true })
        .municipalities,
    ).toEqual(read('donor/municipalities.json'));
  });
  it.each([0.5, -1])(
    'rejects balanced fractional or negative municipal population: %s',
    (value) => {
      const changed = input(),
        a = changed.gis.items.find((i) => i.id === 'BGS01')!,
        b = changed.gis.items.find((i) => i.id === 'BGS04')!;
      const next = value === 0.5 ? a.pop + 0.5 : -1;
      b.pop += a.pop - next;
      a.pop = next;
      expect(() => buildMunicipalities(changed, '2026-11-08')).toThrow(/population/);
    },
  );
  it('rejects negative law transfers even with matching copies and balanced column totals', () => {
    const changed = input();
    const delta = -100 - changed.art.law.rows[0]!.values[1]!;
    for (const [i, d] of [
      [0, delta],
      [1, -delta],
    ]) {
      changed.art.law.rows[i!]!.values[0]! += d!;
      changed.art.law.rows[i!]!.values[1]! += d!;
      changed.proto.municipalities[i!]!.total! += d!;
      changed.proto.municipalities[i!]!.delegated! += d!;
    }
    expect(() => buildMunicipalities(changed, '2026-11-08')).toThrow(/municipal value/);
  });
  it('matches both complete independent Python outputs', () => {
    const result = buildMunicipalities(input(), '2026-11-08', { preserveHistoricalChirpan: true });
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
    const a = buildMunicipalities(original, '2026-11-08', { preserveHistoricalChirpan: true });
    const b = buildMunicipalities(changed, '2026-11-08', { preserveHistoricalChirpan: true });
    expect(b.municipalities.items).not.toEqual(a.municipalities.items);
    expect(b.municipalities.totals).toEqual(a.municipalities.totals);
  });
  it('rejects a changed source row, duplicate code, population and broken geometry', () => {
    const row = input();
    row.art.law.rows[0]!.values[0]! += 1;
    expect(() =>
      buildMunicipalities(row, '2026-11-08', { preserveHistoricalChirpan: true }),
    ).toThrow();
    const code = input();
    code.gis.items[0]!.id = code.gis.items[1]!.id;
    expect(() =>
      buildMunicipalities(code, '2026-11-08', { preserveHistoricalChirpan: true }),
    ).toThrow();
    const pop = input();
    pop.gis.items[0]!.pop += 1;
    expect(() =>
      buildMunicipalities(pop, '2026-11-08', { preserveHistoricalChirpan: true }),
    ).toThrow();
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
    expect(() =>
      buildMunicipalities(geo, '2026-11-08', { preserveHistoricalChirpan: true }),
    ).toThrow();
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
    const actual = buildMunicipalities(changed, '2026-11-08', { preserveHistoricalChirpan: true })
      .municipalities as any;
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
    expect(() =>
      buildMunicipalities(changed, '2026-11-08', { preserveHistoricalChirpan: true }),
    ).toThrow(/population/i);
  });
  it.each([null, 0, -1, NaN, Infinity])('rejects invalid Dobrich area evidence: %s', (value) => {
    const changed = input();
    changed.gis.items.find((i) => i.id === 'DOB28')!.areaKm2 = value as number;
    expect(() =>
      buildMunicipalities(changed, '2026-11-08', { preserveHistoricalChirpan: true }),
    ).toThrow(/areas/i);
  });
  it('rejects an extra law-total column', () => {
    const changed = input();
    changed.art.law.total.push(1);
    expect(() =>
      buildMunicipalities(changed, '2026-11-08', { preserveHistoricalChirpan: true }),
    ).toThrow(/column/i);
  });
});
