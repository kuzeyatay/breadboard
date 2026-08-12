// Encoded-polyline decoding.
//
// Valhalla returns route shape as a Google-style encoded polyline at precision
// 6. The decoded coordinates are the route geometry MapLibre draws, so this is
// a transport decoding step and nothing more: no smoothing, no simplification,
// no resampling. What the router said the road is, is what appears on screen.

/**
 * Decode an encoded polyline into [lon, lat] pairs, in GeoJSON order.
 *
 * @param precision decimal places the encoder used; Valhalla uses 6, Google 5.
 */
export function decodePolyline(
  encoded: string,
  precision = 6,
): [number, number][] {
  const factor = 10 ** precision;
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (Number.isNaN(byte)) return coordinates;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      if (Number.isNaN(byte)) return coordinates;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lon += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push([lon / factor, lat / factor]);
  }
  return coordinates;
}

export function boundsForCoordinates(
  coordinates: readonly [number, number][],
): { north: number; south: number; east: number; west: number } | null {
  if (!coordinates.length) return null;
  let north = -Infinity;
  let south = Infinity;
  let east = -Infinity;
  let west = Infinity;
  for (const [lon, lat] of coordinates) {
    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lon > east) east = lon;
    if (lon < west) west = lon;
  }
  return { north, south, east, west };
}
