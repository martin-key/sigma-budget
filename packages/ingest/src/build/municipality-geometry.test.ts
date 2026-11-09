import { describe, expect, it } from 'vitest';
import { municipalityGeometry, type MunicipalityGeo } from './municipalities.js';
import { validateMunicipalityGeometry } from './municipality-geometry.js';

type Polygons = MunicipalityGeo['rings'];
const shell: [number, number][] = [
  [23, 42],
  [24, 42],
  [24, 43],
  [23, 43],
  [23, 42],
];
const inside = (left: number): [number, number][] => [
  [left, 42.1],
  [left, 42.9],
  [23.1, 42.9],
  [23.1, 42.1],
  [left, 42.1],
];
const build = (rings: Polygons) =>
  municipalityGeometry([{ id: 'test', name: 'test', pop: 1, areaKm2: 1, rings }]);

describe('source and simplified municipality topology', () => {
  it('preserves valid holes and disjoint polygon components', () => {
    expect(
      build([
        [shell, inside(23.01)],
        [
          [
            [25, 42],
            [26, 42],
            [26, 43],
            [25, 43],
            [25, 42],
          ],
        ],
      ]).features,
    ).toHaveLength(1);
  });
  it('rejects a valid source hole that rounding makes overlap the shell', () => {
    const polygons = [[shell, inside(23.0004)]];
    expect(() => validateMunicipalityGeometry(polygons, 'test')).not.toThrow();
    expect(() => build(polygons)).toThrow(/topology/);
  });
  it.each(
    (
      [
        [
          [
            shell,
            [
              [25, 42.1],
              [25, 42.2],
              [25.1, 42.2],
              [25.1, 42.1],
              [25, 42.1],
            ],
          ],
        ],
        [[shell, inside(22.99)]],
        [[shell, inside(23.01), inside(23.02)]],
        [[shell], [shell]],
        [
          [
            [
              [23, 42],
              [24, 43],
              [24, 42],
              [23, 43],
              [23, 42],
            ],
          ],
        ],
      ] as Polygons[]
    ).map((polygons) => ({ polygons })),
  )('rejects invalid source topology %#', ({ polygons }) =>
    expect(() => build(polygons)).toThrow(/topology/),
  );
  it.each([
    [200, 42],
    [23, 91],
    [NaN, 42],
    [Infinity, 42],
  ])('rejects invalid WGS84 coordinates %j', (x, y) => {
    const ring = structuredClone(shell);
    ring[1] = [x!, y!];
    expect(() => build([[ring]])).toThrow(/WGS84/);
  });
});
