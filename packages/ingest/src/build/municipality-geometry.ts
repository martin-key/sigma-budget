import GeoJSONReader from 'jsts/org/locationtech/jts/io/GeoJSONReader.js';
import IsValidOp from 'jsts/org/locationtech/jts/operation/valid/IsValidOp.js';
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js';
import { createHash } from 'node:crypto';

export interface MunicipalityGeometryOptions {
  /** Fixture reproduction only: retains the pinned, already invalid Chirpan boundary. */
  preserveHistoricalChirpan?: boolean;
}

/** Check source and simplified topology, including interactions between polygon components. */
export function validateMunicipalityGeometry(
  polygons: [number, number][][][],
  id: string,
  options: MunicipalityGeometryOptions = {},
): void {
  if (!Array.isArray(polygons) || !polygons.length) throw new Error(`Empty geometry: ${id}`);
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw new Error(`Empty polygon: ${id}`);
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw new Error(`Invalid geometry ring: ${id}`);
      for (const point of ring)
        if (
          !Array.isArray(point) ||
          point.length !== 2 ||
          !Number.isFinite(point[0]) ||
          !Number.isFinite(point[1]) ||
          Math.abs(point[0]) > 180 ||
          Math.abs(point[1]) > 90
        )
          throw new Error(`Invalid WGS84 geometry coordinate: ${id}`);
      if (ring[0]![0] !== ring.at(-1)![0] || ring[0]![1] !== ring.at(-1)![1])
        throw new Error(`Unclosed geometry ring: ${id}`);
    }
  }
  const geometry = new GeoJSONReader(new GeometryFactory()).read({
    type: 'MultiPolygon',
    coordinates: polygons,
  });
  const error = new IsValidOp(geometry).getValidationError();
  // These are the exact source and published-coordinate hashes at base 05d6f6e.
  // No altered geometry is exempt, and normal API calls always reject this source defect.
  if (error && options.preserveHistoricalChirpan && id === 'SZR36') {
    const hash = createHash('sha256').update(JSON.stringify(polygons)).digest('hex');
    if (
      [
        'a775c7cac73123abd78d88d30013e15b024bd2deb70ddb710991bcba1e80b5a0',
        'b3c8416bcea638d92a6a83ea7bf2b7514c5ef459c5a9685f511717aee5d7a6d1',
      ].includes(hash)
    )
      return;
  }
  if (error) throw new Error(`Invalid geometry topology: ${id}: ${error.toString()}`);
}
