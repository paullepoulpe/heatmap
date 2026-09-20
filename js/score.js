// Spatial index and "familiarity" scoring. Pure functions, shared with tests.

const EARTH_R = 6371000;

/** Great-circle distance in metres. */
export function haversine(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Grid-bucketed index over { lat, lng, w } points. Cells are ~cellMeters wide
 * in latitude; longitude cells are stretched so they stay roughly square.
 */
export class SpatialIndex {
  constructor(points, cellMeters = 250) {
    this.cellLat = (cellMeters / EARTH_R) * (180 / Math.PI);
    this.cells = new Map();
    this.size = 0;
    this.totalWeight = 0;
    for (const p of points) this.add(p);
  }

  key(lat, lng) {
    const cellLng = this.cellLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    return `${Math.floor(lat / this.cellLat)}:${Math.floor(lng / cellLng)}`;
  }

  add(p) {
    const k = this.key(p.lat, p.lng);
    let bucket = this.cells.get(k);
    if (!bucket) {
      bucket = [];
      this.cells.set(k, bucket);
    }
    bucket.push(p);
    this.size += 1;
    this.totalWeight += p.w;
  }

  /** Every point within `radius` metres of (lat, lng), with its distance. */
  within(lat, lng, radius) {
    const cellLng = this.cellLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const nLat = Math.ceil(radius / (this.cellLat * (Math.PI / 180) * EARTH_R));
    const i0 = Math.floor(lat / this.cellLat);
    const j0 = Math.floor(lng / cellLng);
    const res = [];
    for (let i = i0 - nLat; i <= i0 + nLat; i++) {
      for (let j = j0 - nLat; j <= j0 + nLat; j++) {
        const bucket = this.cells.get(`${i}:${j}`);
        if (!bucket) continue;
        for (const p of bucket) {
          const d = haversine(lat, lng, p.lat, p.lng);
          if (d <= radius) res.push({ p, d });
        }
      }
    }
    return res;
  }

  /**
   * Familiarity: weight-sum of nearby points with a Gaussian falloff of
   * `sigma` metres. 1.0 ~ one hour spent exactly here.
   */
  familiarity(lat, lng, sigma = 120) {
    let f = 0;
    for (const { p, d } of this.within(lat, lng, sigma * 2.5)) {
      f += p.w * Math.exp(-(d * d) / (2 * sigma * sigma));
    }
    return f;
  }

  /** The centre of the heaviest cell, a good default for "where you live". */
  hotspot() {
    let best = null;
    let bestW = -1;
    for (const bucket of this.cells.values()) {
      let w = 0;
      let lat = 0;
      let lng = 0;
      for (const p of bucket) {
        w += p.w;
        lat += p.lat * p.w;
        lng += p.lng * p.w;
      }
      if (w > bestW) {
        bestW = w;
        best = { lat: lat / w, lng: lng / w, weight: w };
      }
    }
    return best;
  }

  /** Share of cells within `radius` of a point that hold at least one point. */
  coverage(lat, lng, radius) {
    const cellLng = this.cellLat / Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    const n = Math.ceil(radius / (this.cellLat * (Math.PI / 180) * EARTH_R));
    const i0 = Math.floor(lat / this.cellLat);
    const j0 = Math.floor(lng / cellLng);
    let total = 0;
    let seen = 0;
    for (let i = i0 - n; i <= i0 + n; i++) {
      for (let j = j0 - n; j <= j0 + n; j++) {
        const cLat = (i + 0.5) * this.cellLat;
        const cLng = (j + 0.5) * cellLng;
        if (haversine(lat, lng, cLat, cLng) > radius) continue;
        total += 1;
        if (this.cells.has(`${i}:${j}`)) seen += 1;
      }
    }
    return total ? seen / total : 0;
  }
}

export const LEVELS = [
  { id: 'unexplored', label: 'Unexplored', max: 0.05 },
  { id: 'passed', label: 'Passed by', max: 1 },
  { id: 'familiar', label: 'Familiar', max: Infinity },
];

export function classify(familiarity) {
  for (const l of LEVELS) if (familiarity < l.max) return l.id;
  return 'familiar';
}

/** Attach distance, familiarity and level to each place. */
export function scorePlaces(places, index, center) {
  return places.map((pl) => {
    const familiarity = index ? index.familiarity(pl.lat, pl.lng) : 0;
    return {
      ...pl,
      distance: haversine(center.lat, center.lng, pl.lat, pl.lng),
      familiarity,
      level: classify(familiarity),
    };
  });
}

/** Thin a point cloud for the heat layer: merge points that share a fine cell. */
export function aggregateForHeat(points, cellMeters = 40) {
  const idx = new SpatialIndex([], cellMeters);
  const merged = new Map();
  for (const p of points) {
    const k = idx.key(p.lat, p.lng);
    const m = merged.get(k);
    if (m) {
      m.w += p.w;
      m.n += 1;
    } else {
      merged.set(k, { lat: p.lat, lng: p.lng, w: p.w, n: 1 });
    }
  }
  return [...merged.values()];
}
