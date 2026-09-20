// Street and park coverage: which bits of the map your tracks actually touched.
// Pure functions, shared with the Node tests.

import { haversine } from './score.js';

const EARTH_R = 6371000;
const DEG = Math.PI / 180;

/**
 * A fine grid of cells marked "been here". Every point marks the cells within
 * `reach` metres of it, so a street sample is covered when its cell is marked.
 */
export class CoverageGrid {
  constructor(points, { cellMeters = 20, reach = 30 } = {}) {
    this.cell = cellMeters;
    this.reach = reach;
    this.cellLat = (cellMeters / EARTH_R) / DEG;
    this.cells = new Set();
    this.count = 0;
    for (const p of points) this.add(p.lat, p.lng);
  }

  cellLng(lat) {
    return this.cellLat / Math.max(0.05, Math.cos(lat * DEG));
  }

  key(i, j) {
    // i, j fit comfortably in 2^26 each; the product stays an exact integer
    return (i + 4_000_000) * 67_108_864 + (j + 30_000_000);
  }

  add(lat, lng) {
    const cLng = this.cellLng(lat);
    const i0 = Math.floor(lat / this.cellLat);
    const j0 = Math.floor(lng / cLng);
    const n = Math.ceil(this.reach / this.cell);
    const r2 = (this.reach + this.cell * 0.71) ** 2;
    for (let di = -n; di <= n; di++) {
      for (let dj = -n; dj <= n; dj++) {
        const cLat = (i0 + di + 0.5) * this.cellLat;
        const cLon = (j0 + dj + 0.5) * cLng;
        const dy = (cLat - lat) * DEG * EARTH_R;
        const dx = (cLon - lng) * DEG * EARTH_R * Math.cos(lat * DEG);
        if (dx * dx + dy * dy <= r2) this.cells.add(this.key(i0 + di, j0 + dj));
      }
    }
    this.count += 1;
  }

  has(lat, lng) {
    return this.cells.has(this.key(Math.floor(lat / this.cellLat), Math.floor(lng / this.cellLng(lat))));
  }
}

/** Walk along a polyline and yield a sample every `step` metres (plus every vertex). */
export function sampleLine(coords, step = 10) {
  const out = [];
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i];
    out.push({ lat: a.lat, lng: a.lng, vertex: i });
    if (i === coords.length - 1) break;
    const b = coords[i + 1];
    const d = haversine(a.lat, a.lng, b.lat, b.lng);
    const n = Math.floor(d / step);
    for (let k = 1; k <= n; k++) {
      const f = (k * step) / d;
      if (f >= 1) break;
      out.push({ lat: a.lat + (b.lat - a.lat) * f, lng: a.lng + (b.lng - a.lng) * f, vertex: i + f });
    }
  }
  return out;
}

/**
 * Split a way into runs of consecutive covered / uncovered samples.
 * Returns [{ covered, coords: [{lat,lng}], length }].
 */
export function splitRuns(coords, grid, step = 10) {
  if (coords.length < 2) return [];
  const samples = sampleLine(coords, step);
  const runs = [];
  let cur = null;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const covered = grid.has(s.lat, s.lng);
    if (!cur || cur.covered !== covered) {
      const next = { covered, coords: [], length: 0 };
      if (cur) {
        // share the boundary point so the line stays continuous
        cur.coords.push({ lat: s.lat, lng: s.lng });
        next.coords.push({ lat: s.lat, lng: s.lng });
      } else {
        next.coords.push({ lat: s.lat, lng: s.lng });
      }
      runs.push(next);
      cur = next;
    } else {
      cur.coords.push({ lat: s.lat, lng: s.lng });
    }
  }
  for (const r of runs) {
    for (let i = 1; i < r.coords.length; i++) {
      r.length += haversine(r.coords[i - 1].lat, r.coords[i - 1].lng, r.coords[i].lat, r.coords[i].lng);
    }
  }
  return runs.filter((r) => r.coords.length > 1);
}

/** Ray-casting point in polygon. ring = [{lat,lng}] */
export function pointInRing(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].lat;
    const xi = ring[i].lng;
    const yj = ring[j].lat;
    const xj = ring[j].lng;
    const hit = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

/**
 * A park counts as visited when any covered cell lies inside it. We test a
 * lattice of points across its bounding box plus its outline.
 */
export function areaVisited(rings, grid, step = 25) {
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let s = Infinity;
    let n = -Infinity;
    let w = Infinity;
    let e = -Infinity;
    for (const p of ring) {
      if (p.lat < s) s = p.lat;
      if (p.lat > n) n = p.lat;
      if (p.lng < w) w = p.lng;
      if (p.lng > e) e = p.lng;
    }
    const dLat = (step / EARTH_R) / DEG;
    const dLng = dLat / Math.max(0.05, Math.cos(((s + n) / 2) * DEG));
    for (let lat = s; lat <= n; lat += dLat) {
      for (let lng = w; lng <= e; lng += dLng) {
        if (pointInRing(lat, lng, ring) && grid.has(lat, lng)) return true;
      }
    }
    for (const p of sampleLine([...ring, ring[0]], step)) if (grid.has(p.lat, p.lng)) return true;
  }
  return false;
}

/**
 * Compute coverage for Overpass ways/areas. `ways` and `areas` are
 * [{ id, name, coords }] and [{ id, name, rings }].
 */
export function computeCoverage(ways, areas, grid) {
  const streets = [];
  let walked = 0;
  let total = 0;
  for (const w of ways) {
    const runs = splitRuns(w.coords, grid);
    for (const r of runs) {
      total += r.length;
      if (r.covered) walked += r.length;
    }
    streets.push({ ...w, runs });
  }
  const parks = areas.map((a) => ({ ...a, visited: areaVisited(a.rings, grid) }));
  const visitedParks = parks.filter((p) => p.visited).length;
  return { streets, parks, stats: { walkedMeters: walked, totalMeters: total, parks: parks.length, visitedParks } };
}

/** Which points count as "walked" for a given travel setting. */
export function pointsForMode(points, setting) {
  const allow = setting === 'any' ? null : setting === 'bike' ? new Set(['foot', 'bike', 'stay', 'unknown']) : new Set(['foot', 'stay', 'unknown']);
  return allow ? points.filter((p) => allow.has(p.mode || 'unknown')) : points;
}
