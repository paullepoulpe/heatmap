// Fixed web-mercator tiles used to fetch and cache streets from Overpass.
// Pure functions, shared with the tests.

const DEG = Math.PI / 180;

export function lngToX(lng, z) {
  return Math.floor(((lng + 180) / 360) * 2 ** z);
}

export function latToY(lat, z) {
  const r = lat * DEG;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
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

/** Every tile at zoom z that touches a lat/lng box. */
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
