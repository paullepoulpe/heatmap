// Parsers for the various Google Timeline / Location History export formats.
// Pure functions, no DOM: this module is shared by the browser app and the Node tests.
//
// Supported inputs (auto-detected):
//   1. On-device export from the Google Maps app on Android ("Timeline.json"):
//      { semanticSegments: [...], rawSignals: [...], userLocationProfile: {...} }
//   2. On-device export from the Google Maps app on iOS: a top-level array of
//      segments using "geo:lat,lng" strings.
//   3. Legacy Google Takeout "Records.json": { locations: [{ latitudeE7, longitudeE7, timestamp }] }
//   4. Legacy Google Takeout "Semantic Location History/<year>/<year>_<MONTH>.json":
//      { timelineObjects: [{ placeVisit: {...} } | { activitySegment: {...} }] }
//
// Output is a normalised { points, visits, meta } bundle, see normaliseResult().

export const WEIGHTS = {
  visitPerHour: 1, // a one-hour stay at a spot counts as 1
  visitMinHours: 0.25,
  visitMaxHours: 8,
  path: 0.05, // one breadcrumb on a route
  raw: 0.02, // one raw position signal
};

const DEG_RE = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)\s*°?\s*$/;
const GEO_RE = /^\s*geo:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i;

/** Parse any of the coordinate encodings Google uses into { lat, lng } or null. */
export function parseLatLng(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    const m = value.match(GEO_RE) || value.match(DEG_RE);
    if (!m) return null;
    return checkCoord(Number(m[1]), Number(m[2]));
  }
  if (typeof value === 'object') {
    if (typeof value.latLng === 'string') return parseLatLng(value.latLng);
    if (typeof value.LatLng === 'string') return parseLatLng(value.LatLng);
    if (typeof value.point === 'string') return parseLatLng(value.point);
    if (value.placeLocation != null) return parseLatLng(value.placeLocation);
    if (value.latitudeE7 != null && value.longitudeE7 != null) {
      return checkCoord(value.latitudeE7 / 1e7, value.longitudeE7 / 1e7);
    }
    if (value.latE7 != null && value.lngE7 != null) {
      return checkCoord(value.latE7 / 1e7, value.lngE7 / 1e7);
    }
    if (value.lat != null && (value.lng != null || value.lon != null)) {
      return checkCoord(Number(value.lat), Number(value.lng ?? value.lon));
    }
    if (value.latitude != null && value.longitude != null) {
      return checkCoord(Number(value.latitude), Number(value.longitude));
    }
  }
  return null;
}

function checkCoord(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null; // Google emits 0,0 for unknown
  return { lat, lng };
}

function toMs(value) {
  if (value == null) return NaN;
  if (typeof value === 'number') return value;
  if (/^\d+$/.test(value)) return Number(value); // timestampMs strings
  const t = Date.parse(value);
  return Number.isNaN(t) ? NaN : t;
}

function hoursBetween(start, end) {
  const a = toMs(start);
  const b = toMs(end);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return WEIGHTS.visitMinHours;
  return (b - a) / 36e5;
}

function visitWeight(hours) {
  const h = Math.min(WEIGHTS.visitMaxHours, Math.max(WEIGHTS.visitMinHours, hours));
  return h * WEIGHTS.visitPerHour;
}

/** Detect which export format a parsed JSON document is. */
export function detectFormat(doc) {
  if (Array.isArray(doc)) {
    if (doc.length === 0) return 'empty';
    const s = doc[0];
    if (s && (s.visit || s.activity || s.timelinePath)) return 'ondevice-ios';
    return 'unknown';
  }
  if (!doc || typeof doc !== 'object') return 'unknown';
  if (Array.isArray(doc.semanticSegments) || Array.isArray(doc.rawSignals)) return 'ondevice-android';
  if (Array.isArray(doc.timelineObjects)) return 'takeout-semantic';
  if (Array.isArray(doc.locations)) return 'takeout-records';
  return 'unknown';
}

/**
 * Parse one JSON document. Returns { points, visits, format }.
 * points: [{ lat, lng, w, t, kind }]   kind: 'visit' | 'path' | 'raw'
 * visits: [{ lat, lng, start, end, hours, label }]
 */
export function parseDocument(doc) {
  const format = detectFormat(doc);
  const out = { points: [], visits: [], format };
  switch (format) {
    case 'ondevice-android':
      parseSegments(doc.semanticSegments || [], out);
      parseRawSignals(doc.rawSignals || [], out);
      break;
    case 'ondevice-ios':
      parseSegments(doc, out);
      break;
    case 'takeout-semantic':
      parseTimelineObjects(doc.timelineObjects, out);
      break;
    case 'takeout-records':
      parseRecords(doc.locations, out);
      break;
    default:
      break;
  }
  return out;
}

function parseSegments(segments, out) {
  for (const seg of segments) {
    if (!seg || typeof seg !== 'object') continue;
    const start = seg.startTime;
    const end = seg.endTime;
    if (seg.visit) {
      const cand = seg.visit.topCandidate || {};
      const ll = parseLatLng(cand.placeLocation) || parseLatLng(cand);
      if (ll) {
        const hours = hoursBetween(start, end);
        out.visits.push({
          ...ll,
          start: toMs(start),
          end: toMs(end),
          hours,
          label: cand.semanticType && cand.semanticType !== 'UNKNOWN' ? cand.semanticType : null,
          placeId: cand.placeId || null,
        });
        out.points.push({ ...ll, w: visitWeight(hours), t: toMs(start), kind: 'visit' });
      }
    }
    if (seg.activity) {
      const a = parseLatLng(seg.activity.start);
      const b = parseLatLng(seg.activity.end);
      if (a) out.points.push({ ...a, w: WEIGHTS.path, t: toMs(start), kind: 'path' });
      if (b) out.points.push({ ...b, w: WEIGHTS.path, t: toMs(end), kind: 'path' });
    }
    if (Array.isArray(seg.timelinePath)) {
      const startMs = toMs(start);
      for (const p of seg.timelinePath) {
        const ll = parseLatLng(p);
        if (!ll) continue;
        let t = toMs(p.time);
        if (!Number.isFinite(t) && p.durationMinutesOffsetFromStartTime != null && Number.isFinite(startMs)) {
          t = startMs + Number(p.durationMinutesOffsetFromStartTime) * 60000;
        }
        out.points.push({ ...ll, w: WEIGHTS.path, t, kind: 'path' });
      }
    }
  }
}

function parseRawSignals(signals, out) {
  for (const s of signals) {
    const pos = s && s.position;
    if (!pos) continue;
    const ll = parseLatLng(pos);
    if (!ll) continue;
    const acc = Number(pos.accuracyMeters);
    if (Number.isFinite(acc) && acc > 200) continue; // ignore coarse cell fixes
    out.points.push({ ...ll, w: WEIGHTS.raw, t: toMs(pos.timestamp), kind: 'raw' });
  }
}

function parseTimelineObjects(objects, out) {
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    if (o.placeVisit) {
      const v = o.placeVisit;
      const ll = parseLatLng(v.location) || parseLatLng(v.centerLatE7 != null ? { latE7: v.centerLatE7, lngE7: v.centerLngE7 } : null);
      if (ll) {
        const d = v.duration || {};
        const hours = hoursBetween(d.startTimestamp ?? d.startTimestampMs, d.endTimestamp ?? d.endTimestampMs);
        out.visits.push({
          ...ll,
          start: toMs(d.startTimestamp ?? d.startTimestampMs),
          end: toMs(d.endTimestamp ?? d.endTimestampMs),
          hours,
          label: (v.location && v.location.name) || null,
          placeId: (v.location && v.location.placeId) || null,
        });
        out.points.push({ ...ll, w: visitWeight(hours), t: toMs(d.startTimestamp ?? d.startTimestampMs), kind: 'visit' });
      }
    }
    if (o.activitySegment) {
      const a = o.activitySegment;
      const d = a.duration || {};
      const t0 = toMs(d.startTimestamp ?? d.startTimestampMs);
      const t1 = toMs(d.endTimestamp ?? d.endTimestampMs);
      const s = parseLatLng(a.startLocation);
      const e = parseLatLng(a.endLocation);
      if (s) out.points.push({ ...s, w: WEIGHTS.path, t: t0, kind: 'path' });
      if (e) out.points.push({ ...e, w: WEIGHTS.path, t: t1, kind: 'path' });
      const wp = (a.waypointPath && a.waypointPath.waypoints) || [];
      for (const p of wp) {
        const ll = parseLatLng(p);
        if (ll) out.points.push({ ...ll, w: WEIGHTS.path, t: t0, kind: 'path' });
      }
      const raw = (a.simplifiedRawPath && a.simplifiedRawPath.points) || [];
      for (const p of raw) {
        const ll = parseLatLng(p);
        if (ll) out.points.push({ ...ll, w: WEIGHTS.path, t: toMs(p.timestampMs ?? p.timestamp) || t0, kind: 'path' });
      }
    }
  }
}

function parseRecords(locations, out) {
  for (const r of locations) {
    const ll = parseLatLng(r);
    if (!ll) continue;
    const acc = Number(r.accuracy);
    if (Number.isFinite(acc) && acc > 200) continue;
    out.points.push({ ...ll, w: WEIGHTS.raw, t: toMs(r.timestamp ?? r.timestampMs), kind: 'raw' });
  }
}

/**
 * Parse several documents (for example a folder of monthly Takeout files) and
 * merge them into one bundle with summary metadata.
 */
export function parseDocuments(docs) {
  const points = [];
  const visits = [];
  const formats = {};
  for (const doc of docs) {
    const r = parseDocument(doc);
    formats[r.format] = (formats[r.format] || 0) + 1;
    for (const p of r.points) points.push(p);
    for (const v of r.visits) visits.push(v);
  }
  return normaliseResult(points, visits, formats);
}

export function normaliseResult(points, visits, formats = {}) {
  let tMin = Infinity;
  let tMax = -Infinity;
  const counts = { visit: 0, path: 0, raw: 0 };
  for (const p of points) {
    counts[p.kind] = (counts[p.kind] || 0) + 1;
    if (Number.isFinite(p.t)) {
      if (p.t < tMin) tMin = p.t;
      if (p.t > tMax) tMax = p.t;
    }
  }
  return {
    points,
    visits,
    meta: {
      formats,
      counts,
      total: points.length,
      firstTime: Number.isFinite(tMin) ? tMin : null,
      lastTime: Number.isFinite(tMax) ? tMax : null,
    },
  };
}
