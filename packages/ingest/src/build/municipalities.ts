import type { Json } from '@sigma-budget/dataset-schema';
import { jsonstatSeries, type JsonStat } from '../io/data.js';
import { formatNumber, pythonRound as rnd } from '../common/format.js';
import { metadata } from '../common/metadata.js';
import { REGIONS, COLS, KINDS } from './municipality-definitions.js';

type Point = [number, number];
type Ring = Point[];
type Polygon = Ring[];
export interface MunicipalityGeo {
  id: string;
  name: string;
  pop: number;
  areaKm2: number;
  rings: Polygon[];
}
interface LawRow {
  region: string;
  name: string;
  values: (number | null)[];
}
interface ProtoRow {
  region: string | null;
  name: string;
  total: number | null;
  delegated: number | null;
  equalizing: number | null;
  winter_roads: number | null;
  capital: number | null;
  other_targeted: number | null;
}
export interface MunicipalityInput {
  art: { cols: string[]; law: { rows: LawRow[]; total: number[] } };
  proto: { municipalities: ProtoRow[]; sums: Record<string, number> };
  gis: { items: MunicipalityGeo[]; populationSum: number };
  oblast: { updated: string; jsonstat: JsonStat };
  population: { years: string[]; persons: number[] };
}
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const norm = (s: string) =>
  s
    .replace(/[„“”"«»]/gu, '')
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/[\s\-–—]+/gu, ' ')
    .trim();
const nullable = (n: number | null) => {
  if (n === null) return 0;
  if (!Number.isFinite(n)) throw new Error('Invalid municipal value');
  return n;
};
function dp(points: Ring, eps: number): Ring {
  if (points.length < 3) return [...points];
  const keep = points.map(() => false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!,
      [ax, ay] = points[a]!,
      [bx, by] = points[b]!,
      dx = bx - ax,
      dy = by - ay,
      l2 = dx * dx + dy * dy;
    let best = -1,
      bi = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i]!;
      const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2));
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > eps) {
      keep[bi] = true;
      stack.push([a, bi], [bi, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}
function ring(source: Ring): Ring {
  let pts: Ring = [];
  for (const [x, y] of source) {
    const p: Point = [rnd(x, 3), rnd(y, 3)];
    const last = pts.at(-1);
    if (!last || last[0] !== p[0] || last[1] !== p[1]) pts.push(p);
  }
  if (!pts.length) throw new Error('Empty geometry ring');
  if (pts[0]![0] !== pts.at(-1)![0] || pts[0]![1] !== pts.at(-1)![1]) pts.push(pts[0]!);
  if (pts.length > 5) {
    let far = 0,
      max = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const d = (pts[i]![0] - pts[0]![0]) ** 2 + (pts[i]![1] - pts[0]![1]) ** 2;
      if (d > max) {
        max = d;
        far = i;
      }
    }
    pts = [...dp(pts.slice(0, far + 1), 0.0005).slice(0, -1), ...dp(pts.slice(far), 0.0005)];
  }
  return pts.length >= 4 ? pts : [];
}
function area(rings: Polygon): number {
  const one = (r: Ring) =>
    0.5 * sum(r.slice(0, -1).map((p, i) => p[0] * r[i + 1]![1] - r[i + 1]![0] * p[1]));
  return Math.abs(one(rings[0]!)) - sum(rings.slice(1).map((r) => Math.abs(one(r))));
}
export function municipalityGeometry(items: MunicipalityGeo[]) {
  let worst = 0,
    npts = 0;
  const features = items.map((it) => {
    const polys: Polygon[] = [];
    let before = 0,
      after = 0;
    for (const poly of it.rings) {
      before += area(poly);
      const rs = poly.map(ring);
      if (!rs[0]?.length) continue;
      const kept = rs.filter((r) => r.length > 0);
      polys.push(kept);
      after += area(kept);
      npts += sum(kept.map((r) => r.length));
    }
    if (!polys.length || !Number.isFinite(before) || before <= 0)
      throw new Error(`Collapsed geometry ${it.id}`);
    const dev = Math.abs(after - before) / before;
    worst = Math.max(worst, dev);
    if (dev > 0.02) throw new Error(`Geometry area changed: ${it.id}`);
    return {
      type: 'Feature',
      properties: { id: it.id, name: it.name },
      geometry:
        polys.length === 1
          ? { type: 'Polygon', coordinates: polys[0] }
          : { type: 'MultiPolygon', coordinates: polys },
    };
  });
  return { features, worst, npts };
}
const pk = [
  'total',
  'delegated',
  'equalizing',
  'winter_roads',
  'capital',
  'other_targeted',
] as const;
export function buildMunicipalities(
  input: MunicipalityInput,
  buildDate: string,
): { municipalities: Record<string, Json>; geo: Record<string, Json> } {
  const { art, proto, oblast, population } = input,
    gis = structuredClone(input.gis.items).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (JSON.stringify(art.cols) !== JSON.stringify(COLS))
    throw new Error('Municipality columns changed');
  const law = art.law.rows;
  if (law.length !== 265 || gis.length !== 265 || proto.municipalities.length !== 265)
    throw new Error('Expected 265 municipalities');
  if (new Set(gis.map((x) => x.id)).size !== 265) throw new Error('Duplicate municipality ids');
  const byId = new Map(gis.map((i) => [i.id, i])),
    rural = byId.get('DOB15'),
    city = byId.get('DOB28');
  if (!rural || !city || rural.areaKm2 < 5 * city.areaKm2) throw new Error('Dobrich areas changed');
  let popFix: {
    ids: string[];
    gisco: Record<string, number>;
    used: Record<string, number>;
    areaKm2: Record<string, number>;
    note?: string;
  } | null = null;
  if (rural.pop >= city.pop) {
    const old = { DOB15: rural.pop, DOB28: city.pop };
    [rural.pop, city.pop] = [city.pop, rural.pop];
    popFix = {
      ids: ['DOB15', 'DOB28'],
      gisco: old,
      used: { DOB15: rural.pop, DOB28: city.pop },
      areaKm2: { DOB15: rural.areaKm2, DOB28: city.areaKm2 },
    };
  }
  for (let i = 0; i < law.length; i++) {
    const r = law[i]!,
      p = proto.municipalities[i]!;
    if (
      (p.region !== null && r.region !== p.region) ||
      norm(r.name) !== norm(p.name) ||
      r.values.length !== 6 ||
      r.values.some((v, j) => nullable(v) !== nullable(p[pk[j]!]))
    )
      throw new Error(`Municipal law copy differs: ${r.name}`);
  }
  const sums = COLS.map((_, i) => rnd(sum(law.map((r) => nullable(r.values[i]!))), 1));
  if (sums.some((v, i) => v !== rnd(art.law.total[i]!, 1) || v !== rnd(proto.sums[pk[i]!]!, 1)))
    throw new Error('Municipal column sums differ');
  const worst = Math.max(
    ...law.map((r) => Math.abs(nullable(r.values[0]!) - sum(r.values.slice(1, 5).map(nullable)))),
  );
  if (worst > 0.05) throw new Error('Municipal row does not add up');
  const nat = new Map(population.years.map((y, i) => [String(y), population.persons[i]!]));
  const popSum = sum(gis.map((i) => i.pop));
  if (popSum !== input.gis.populationSum || popSum !== nat.get('2024'))
    throw new Error('National population differs');
  const codes = REGIONS.map((r) => r[0]);
  if (
    new Set(gis.map((i) => i.id.slice(0, 3))).size !== 28 ||
    codes.some((c) => !gis.some((i) => i.id.startsWith(c)))
  )
    throw new Error('Municipal regions differ');
  const pop25: Record<string, number> = {};
  for (const [code, , , nuts] of REGIONS) {
    const series = jsonstatSeries(oblast.jsonstat, 'time', { geo: nuts });
    if (sum(gis.filter((i) => i.id.startsWith(code)).map((i) => i.pop)) !== series['2024']?.[0])
      throw new Error(`Oblast population differs: ${code}`);
    if (!series['2025']) throw new Error('Missing oblast population');
    pop25[code] = series['2025'][0];
  }
  if (sum(Object.values(pop25)) !== nat.get('2025'))
    throw new Error('National 2025 population differs');
  if (
    new Set(law.map((r) => r.region)).size !== 28 ||
    REGIONS.some((r) => !law.some((l) => l.region === r[1]))
  )
    throw new Error('Law oblasts differ');
  const used = new Set<string>(),
    manual: string[] = [];
  const items = law
    .map((r) => {
      const reg = REGIONS.find((x) => x[1] === r.region)!;
      let id: string | undefined,
        how = 'exact';
      const key = `${r.region}|${r.name}`;
      const special: Record<string, string> = {
        'ОБЛАСТ ДОБРИЧ|Добричка': 'DOB15',
        'ОБЛАСТ КЮСТЕНДИЛ|Бобовдол': 'KNL04',
        'ОБЛАСТ СОФИЯ (СТОЛИЦА)|СТОЛИЧНА ОБЩИНА': 'SOF46',
      };
      if (special[key]) {
        id = special[key];
        how = 'manual';
      } else {
        const matches = gis.filter((i) => i.id.startsWith(reg[0]) && norm(i.name) === norm(r.name));
        if (matches.length !== 1) throw new Error(`Municipality name mismatch: ${r.name}`);
        id = matches[0]!.id;
      }
      if (!id || used.has(id) || !id.startsWith(reg[0]))
        throw new Error('Municipality identity mismatch');
      used.add(id);
      const g = byId.get(id);
      if (!g || !g.pop) throw new Error('Municipality population missing');
      const v = r.values.map(nullable),
        transfers: Record<string, number> = {};
      COLS.forEach((c, i) => (transfers[c] = rnd(v[i]!, 1)));
      transfers.all = rnd(v[0]! + v[5]!, 1);
      const perCapita: Record<string, number> = {};
      COLS.forEach((c) => (perCapita[c] = rnd((transfers[c]! * 1000) / g.pop, 2)));
      if (
        (id === 'DOB15' || id === 'DOB28') &&
        !((transfers.all! * 1000) / g.pop >= 300 && (transfers.all! * 1000) / g.pop <= 2000)
      )
        throw new Error('Dobrich transfers per capita implausible');
      if (how === 'manual') manual.push(`${r.name} = ${g.name}`);
      return {
        id,
        name: g.name,
        ...(how === 'manual' || norm(r.name) !== norm(g.name) ? { lawName: r.name } : {}),
        region: reg[2],
        regionId: reg[0],
        population: g.pop,
        transfers,
        perCapita,
        match: how,
      };
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (used.size !== 265) throw new Error('Municipal ids not exhausted');
  const regions = [...REGIONS]
    .sort((a, b) => (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0))
    .map(([code, , name, nuts3]) => {
      const mine = items.filter((i) => i.regionId === code);
      return {
        id: code,
        nuts3,
        name,
        municipalities: mine.length,
        population2025: pop25[code]!,
        transfersKhil: rnd(sum(mine.map((i) => i.transfers.total!)), 1),
        otherTargetedKhil: rnd(sum(mine.map((i) => i.transfers.otherTargeted!)), 1),
      };
    });
  const totals = {
    count: 265,
    transfersKhil: sums[0]!,
    otherTargetedKhil: sums[5]!,
    allKhil: rnd(sums[0]! + sums[5]!, 1),
    populationSum: popSum,
    population2025Sum: sum(Object.values(pop25)),
  };
  if (Math.abs(sum(regions.map((r) => r.transfersKhil)) - totals.transfersKhil) > 0.05)
    throw new Error('Oblast transfers differ');
  if (popFix) {
    const natPc = (totals.allKhil * 1000) / popSum,
      tr = Object.fromEntries(items.map((i) => [i.id, i.transfers.all!])),
      wrCity = (tr.DOB28! * 1000) / popFix.gisco.DOB28!,
      wrRural = (tr.DOB15! * 1000) / popFix.gisco.DOB15!;
    popFix.note = `В таблицата на Eurostat GISCO населението на Добрич и на Добрич-селска е записано разменено: на селската община (${formatNumber(popFix.areaKm2.DOB15, 1)} км²) са записани ${formatNumber(popFix.gisco.DOB15)} души, а на градската (${formatNumber(popFix.areaKm2.DOB28, 1)} км²) — ${formatNumber(popFix.gisco.DOB28)}. Тук числата са върнати на мястото им; общото население на страната и на областта не се променя. Основания: градската община (град Добрич) е най-големият населен пункт в областта, а с разменените числа тя би получавала ${formatNumber(wrCity)} € трансфер на жител — ${formatNumber(wrCity / natPc, 1)} пъти повече от средното за страната (${formatNumber(natPc)} €), докато селската — само ${formatNumber(wrRural)} €.`;
  }
  const municipalities = {
    meta: metadata('D19+D20+D21', 'Трансфери към общините, население и области', buildDate, {
      source: ['zdb', 'gisco', 'eurostat'],
      sourceNote: `ЗДБ 2026, чл. 51 (ДВ бр. 69 от 31.07.2026 г.); население по общини: Eurostat GISCO LAU 2024 (към 01.01.2024); население по области: Eurostat demo_r_pjanaggr3 (към 01.01.2025, обновено ${oblast.updated.slice(0, 10)})`,
      asOf: '2026-07-31',
      unit: 'хил. €',
    }),
    year: 2026,
    populationYear: 2024,
    columns: [...COLS],
    kinds: KINDS,
    note: 'Трансферите са по чл. 51 от Закона за държавния бюджет за 2026 г. (ДВ бр. 69 от 31.07.2026 г.). „Общо“ са основните бюджетни взаимоотношения (т. 1): делегирани дейности, изравнителна субсидия, зимно поддържане и капиталови разходи. Трансферите за други целеви разходи (т. 2) са отделно и не са в „Общо“; „Общо с други целеви“ е сборът на двете. Празна клетка в закона е нула.',
    perCapitaNote:
      'На жител е трансферът, разделен на населението на общината към 1 януари 2024 г. (Eurostat GISCO, LAU 2024): последното население, което се публикува по общини. За областите е показано и населението към 1 януари 2025 г. (Eurostat).',
    nameNote:
      'Имената са по официалния списък на НСИ (чрез Eurostat GISCO). В закона три общини са изписани различно: „Добричка“ (Добрич-селска), „Столична община“ (Столична) и „Бобовдол“ (Бобов дол); старото изписване е в полето lawName.',
    ...(popFix ? { popFix } : {}),
    items,
    regions,
    totals,
    unmatched: [],
    check: {
      rowSumMaxDev: rnd(worst, 3),
      columnSums: sums,
      manualMatches: manual,
      populationSumEqualsNational2024: true,
      oblastPopulation2024EqualsEurostat: true,
      populationFixApplied: !!popFix,
    },
  };
  const geo = buildMunicipalGeo(gis, buildDate);
  return { municipalities: municipalities as unknown as Record<string, Json>, geo };
}
export function buildMunicipalGeo(gis: MunicipalityGeo[], buildDate: string): Record<string, Json> {
  if (gis.length !== 265 || new Set(gis.map((item) => item.id)).size !== 265)
    throw new Error('Expected 265 unique municipality geometries');
  const ordered = [...gis].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const geometry = municipalityGeometry(ordered);
  return {
    type: 'FeatureCollection',
    meta: metadata('D20', 'Граници на общините (GeoJSON, WGS84)', buildDate, {
      source: ['gisco'],
      sourceNote:
        'Eurostat GISCO, LAU 2024 (LAU_RG_01M_2024_4326), България; координатите са закръглени до 3 знака и опростени (допуск около 50 метра)',
      asOf: '2024-01-01',
    }),
    idProperty: 'id',
    features: geometry.features,
  } as unknown as Record<string, Json>;
}
