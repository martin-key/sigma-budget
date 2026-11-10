import { pythonRound } from '../common/format.js';
import { jsonstatSeries, parseJsonStat } from '../io/data.js';

export const NUTS3_BG = [
  'BG311',
  'BG312',
  'BG313',
  'BG314',
  'BG315',
  'BG321',
  'BG322',
  'BG323',
  'BG324',
  'BG325',
  'BG331',
  'BG332',
  'BG333',
  'BG334',
  'BG341',
  'BG342',
  'BG343',
  'BG344',
  'BG411',
  'BG412',
  'BG413',
  'BG414',
  'BG415',
  'BG421',
  'BG422',
  'BG423',
  'BG424',
  'BG425',
];
export const LAU_RELEASE = '2024';
export const LAU_BASE = 'https://gisco-services.ec.europa.eu/distribution/v2/lau/';
export const GISCO_CSV = LAU_BASE + 'csv/LAU_RG_01M_2024_4326.csv';
export const GISCO_GEOJSON = LAU_BASE + 'geojson/LAU_RG_01M_2024_4326.geojson';
export const OBLAST_BASE =
  'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/demo_r_pjanaggr3';
export const OBLAST_URL =
  OBLAST_BASE +
  '?format=JSON&lang=EN&sex=T&age=TOTAL&unit=NR&' +
  NUTS3_BG.map((id) => 'geo=' + id).join('&');

/** RFC4180 records, including escaped quotes/newlines. The GISCO CSV is UTF-8. */
function csvRecords(bytes: Buffer): string[][] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
        closed = true;
      } else field += c;
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field);
      field = '';
      closed = false;
      if (c !== ',') {
        rows.push(row);
        row = [];
        if (c === '\r' && text[i + 1] === '\n') i++;
      }
    } else if (c === '"' && !field && !closed) quoted = true;
    else {
      if (closed || c === '"') throw new Error('Malformed GISCO CSV');
      field += c;
    }
  }
  if (quoted) throw new Error('Unclosed GISCO CSV quote');
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
function number(text: string | undefined, field: string): number {
  if (
    !text ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(text.trim()) ||
    !Number.isFinite(Number(text))
  )
    throw new Error('Invalid GISCO ' + field);
  return Number(text);
}
export interface GiscoReductionOptions {
  release?: string;
  expectedCount?: number;
  csvUrl?: string;
  geojsonUrl?: string;
}
/** Actual raw -> reduced-cache steps of boundaries.py, without claiming historical raw recovery. */
export function reduceGisco(csv: Buffer, geojson: Buffer, options: GiscoReductionOptions = {}) {
  const release = options.release ?? LAU_RELEASE;
  if (!/^\d{4}$/.test(release)) throw new Error('Invalid LAU release');
  const records = csvRecords(csv),
    headers = records.shift();
  if (!headers || new Set(headers).size !== headers.length)
    throw new Error('Invalid GISCO CSV header');
  for (const key of ['CNTR_CODE', 'GISCO_ID', 'LAU_NAME', 'POP_' + release, 'AREA_KM2'])
    if (!headers.includes(key)) throw new Error('Missing GISCO CSV column: ' + key);
  const ids = new Set<string>();
  const rows = records
    .filter((r) => r.some(Boolean))
    .flatMap((r) => {
      if (r.length !== headers.length) throw new Error('Invalid GISCO CSV row width');
      const item = Object.fromEntries(headers.map((h, i) => [h, r[i]]));
      if (item.CNTR_CODE !== 'BG') return [];
      if (!/^BG_[A-Z]{3}\d{2}$/.test(item.GISCO_ID ?? '') || !item.LAU_NAME)
        throw new Error('Invalid Bulgarian LAU identity');
      const id = item.GISCO_ID!.slice(3);
      if (ids.has(id)) throw new Error('Duplicate Bulgarian LAU: ' + id);
      ids.add(id);
      const pop = Math.trunc(number(item['POP_' + release], 'population')),
        areaKm2 = pythonRound(number(item.AREA_KM2, 'area'), 3);
      if (!Number.isSafeInteger(pop) || pop <= 0 || areaKm2 <= 0)
        throw new Error('Invalid GISCO population/area');
      return [{ id, name: item.LAU_NAME, pop, areaKm2 }];
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const count = options.expectedCount ?? 265;
  if (!Number.isSafeInteger(count) || count <= 0 || rows.length !== count)
    throw new Error('Unexpected Bulgarian LAU count: ' + rows.length);
  const doc: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(geojson));
  if (!record(doc) || doc.type !== 'FeatureCollection' || !Array.isArray(doc.features))
    throw new Error('Expected GISCO FeatureCollection');
  type Point = [number, number];
  const geometries = new Map<string, Point[][][]>();
  for (const feature of doc.features) {
    if (!record(feature) || !record(feature.properties)) throw new Error('Invalid GISCO feature');
    const pr = feature.properties;
    if (pr.CNTR_CODE !== 'BG') continue;
    if (typeof pr.GISCO_ID !== 'string' || !/^BG_[A-Z]{3}\d{2}$/.test(pr.GISCO_ID))
      throw new Error('Invalid GISCO feature identity');
    const id = pr.GISCO_ID.slice(3);
    if (!ids.has(id)) continue;
    if (geometries.has(id)) throw new Error('Duplicate GISCO geometry: ' + id);
    const geom = feature.geometry;
    if (
      !record(geom) ||
      !['Polygon', 'MultiPolygon'].includes(String(geom.type)) ||
      !Array.isArray(geom.coordinates)
    )
      throw new Error('Expected Polygon/MultiPolygon');
    const polygons = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    if (!polygons.length) throw new Error('Empty GISCO geometry');
    const rings = polygons.map((polygon: unknown) => {
      if (!Array.isArray(polygon) || !polygon.length) throw new Error('Empty GISCO polygon');
      return polygon.map((ring: unknown) => {
        if (!Array.isArray(ring) || ring.length < 4) throw new Error('Invalid GISCO ring');
        const points = ring.map((p: unknown): Point => {
          if (
            !Array.isArray(p) ||
            p.length !== 2 ||
            !p.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
            Math.abs(p[0]) > 180 ||
            Math.abs(p[1]) > 90
          )
            throw new Error('Invalid GISCO WGS84 coordinate');
          return [pythonRound(p[0], 5), pythonRound(p[1], 5)];
        });
        if (points[0]![0] !== points.at(-1)![0] || points[0]![1] !== points.at(-1)![1])
          throw new Error('Unclosed GISCO ring');
        return points;
      });
    });
    geometries.set(id, rings);
  }
  const items = rows.map((row) => {
    const rings = geometries.get(row.id);
    if (!rings) throw new Error('Missing GISCO geometry: ' + row.id);
    return { ...row, rings };
  });
  return {
    source: `Eurostat GISCO, LAU ${release} (LAU_RG_01M_${release}_4326), Bulgaria`,
    urlCsv: options.csvUrl ?? GISCO_CSV,
    urlGeojson: options.geojsonUrl ?? GISCO_GEOJSON,
    release,
    populationDate: release + '-01-01',
    populationSum: items.reduce((s, r) => s + r.pop, 0),
    items,
  };
}
export function reduceOblast(bytes: Buffer, url = OBLAST_URL) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const js = parseJsonStat(text);
  if (
    !Array.isArray(js.id) ||
    !Array.isArray(js.size) ||
    js.id.length !== js.size.length ||
    !js.id.includes('geo') ||
    !js.id.includes('time')
  )
    throw new Error('Invalid oblast JSON-stat dimensions');
  for (const id of NUTS3_BG) {
    const series = jsonstatSeries(js, 'time', { geo: id, sex: 'T', age: 'TOTAL', unit: 'NR' });
    if (
      !Object.keys(series).length ||
      !Object.values(series).every(([v]) => Number.isSafeInteger(v) && v >= 0)
    )
      throw new Error('Missing or invalid oblast population: ' + id);
  }
  const jsonstat = JSON.parse(text) as Record<string, unknown>;
  return { url, updated: jsonstat.updated ?? null, jsonstat };
}
