import { object } from '@sigma-budget/dataset-schema';
import type { MunicipalityInput } from '../../build/municipalities.js';
import { parseSavedJson, parseEurostatSnapshot } from './jsonstat.js';
import { isIsoDay } from '../../common/dates.js';

export type GiscoSnapshot = MunicipalityInput['gis'] & {
  source: string;
  release: string;
  populationDate: string;
  urlCsv: string;
  urlGeojson: string;
};

/** The registered GISCO input is a reduced, pinned cache, not the unavailable
 * original streamed GeoJSON. Preserve its coordinates; builders own topology,
 * simplification and the documented historical Chirpan decision. */
export function parseGiscoSnapshot(text: string): GiscoSnapshot {
  const data = parseSavedJson(text);
  if (
    !object(data) ||
    !Array.isArray(data.items) ||
    !data.items.length ||
    !['source', 'release', 'populationDate', 'urlCsv', 'urlGeojson'].every(
      (k) => typeof data[k] === 'string',
    ) ||
    !isIsoDay(data.populationDate) ||
    !Number.isSafeInteger(data.populationSum)
  )
    throw new Error('Invalid GISCO cache');
  const ids = new Set<string>();
  let sum = 0;
  for (const item of data.items) {
    if (
      !object(item) ||
      typeof item.id !== 'string' ||
      !/^[A-Z]{3}\d{2}$/u.test(item.id) ||
      ids.has(item.id) ||
      typeof item.name !== 'string' ||
      !item.name ||
      typeof item.pop !== 'number' ||
      !Number.isSafeInteger(item.pop) ||
      item.pop < 0 ||
      typeof item.areaKm2 !== 'number' ||
      !Number.isFinite(item.areaKm2) ||
      item.areaKm2 <= 0 ||
      !Array.isArray(item.rings) ||
      !item.rings.length
    )
      throw new Error('Invalid GISCO municipality');
    ids.add(item.id);
    sum += item.pop;
    for (const polygon of item.rings) {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error('Invalid GISCO polygon');
      for (const ring of polygon) {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid GISCO ring');
        for (const point of ring)
          if (
            !Array.isArray(point) ||
            point.length !== 2 ||
            point.some((v) => typeof v !== 'number' || !Number.isFinite(v)) ||
            Math.abs(point[0] as number) > 180 ||
            Math.abs(point[1] as number) > 90
          )
            throw new Error('Invalid GISCO coordinate');
        if (JSON.stringify(ring[0]) !== JSON.stringify(ring.at(-1)))
          throw new Error('Unclosed GISCO ring');
      }
    }
  }
  if (sum !== data.populationSum) throw new Error('GISCO population sum differs');
  return data as unknown as GiscoSnapshot;
}

export function parseOblastSnapshot(text: string): MunicipalityInput['oblast'] {
  const raw = parseSavedJson(text);
  if (!object(raw) || typeof raw.updated !== 'string' || !object(raw.jsonstat))
    throw new Error('Invalid oblast population cache');
  const jsonstat = parseEurostatSnapshot(text);
  if (raw.updated !== jsonstat.updated) throw new Error('Oblast updated dates differ');
  return { updated: raw.updated, jsonstat };
}
