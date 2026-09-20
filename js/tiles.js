// Fixed web-mercator tiles used to fetch and cache streets from Overpass.
// Pure functions, shared with the tests.

const DEG = Math.PI / 180;

const MAX_LAT = 85.0511; // web mercator's edge

const clampIndex = (i, z) => Math.min(2 ** z - 1, Math.max(0, i));

export function lngToX(lng, z) {
  return clampIndex(Math.floor(((lng + 180) / 360) * 2 ** z), z);
}

export function latToY(lat, z) {
  const r = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * DEG;
  return clampIndex(Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z), z);
}

function xToLng(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function yToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
}

export function tileKey(x, y, z) {
  return `${z}/${x}/${y}`;
}

/** { south, west, north, east } of a tile. */
export function tileBounds(x, y, z) {
  return { west: xToLng(x, z), east: xToLng(x + 1, z), north: yToLat(y, z), south: yToLat(y + 1, z) };
}

/** How many tiles at zoom z touch a box, without building them: zoomed out that is millions. */
export function countTilesForBox(box, z) {
  const w = lngToX(box.east, z) - lngToX(box.west, z) + 1;
  const h = latToY(box.south, z) - latToY(box.north, z) + 1;
  return w * h;
}

/** Every tile at zoom z that touches a lat/lng box. Check countTilesForBox first. */
export function tilesForBox(box, z) {
  const x0 = lngToX(box.west, z);
  const x1 = lngToX(box.east, z);
  const y0 = latToY(box.north, z);
  const y1 = latToY(box.south, z);
  const out = [];
  for (let x = x0; x <= x1; x++) {
    for (let y = y0; y <= y1; y++) out.push({ x, y, z, key: tileKey(x, y, z), bounds: tileBounds(x, y, z) });
  }
  return out;
}
