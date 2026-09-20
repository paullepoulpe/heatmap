// Synthetic Timeline data so the app can be tried without a real export.
// Produces a document in the on-device Android format around a chosen city.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gauss(rand) {
  const u = 1 - rand();
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const fmt = (lat, lng) => `${lat.toFixed(6)}°, ${lng.toFixed(6)}°`;

export function makeDemoTimeline({ lat = 48.8566, lng = 2.3522, days = 365, seed = 42 } = {}) {
  const rand = rng(seed);
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  const home = { lat: lat + 900 * mLat, lng: lng - 1200 * mLng };
  const work = { lat: lat - 1500 * mLat, lng: lng + 2200 * mLng };
  const haunts = [];
  for (let i = 0; i < 12; i++) {
    haunts.push({
      lat: home.lat + gauss(rand) * 700 * mLat,
      lng: home.lng + gauss(rand) * 700 * mLng,
      weight: rand(),
    });
  }
  const segments = [];
  const t0 = Date.now() - days * 864e5;
  for (let d = 0; d < days; d++) {
    const day = t0 + d * 864e5;
    const weekday = new Date(day).getUTCDay() % 6 !== 0;
    const push = (start, end, seg) =>
      segments.push({ startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), ...seg });
    const visit = (p, start, end, type) =>
      push(start, end, { visit: { topCandidate: { placeLocation: { latLng: fmt(p.lat, p.lng) }, semanticType: type } } });
    const path = (a, b, start, end) => {
      const n = 12;
      const timelinePath = [];
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        const wobble = Math.sin(f * Math.PI) * 120;
        timelinePath.push({
          point: fmt(a.lat + (b.lat - a.lat) * f + gauss(rand) * 15 * mLat + wobble * mLat, a.lng + (b.lng - a.lng) * f + gauss(rand) * 15 * mLng),
          time: new Date(start + (end - start) * f).toISOString(),
        });
      }
      push(start, end, { timelinePath });
    };
    let t = day + 8 * 36e5;
    visit(home, day, t, 'HOME');
    if (weekday) {
      path(home, work, t, t + 40 * 6e4);
      t += 40 * 6e4;
      visit(work, t, t + 8.5 * 36e5, 'WORK');
      t += 8.5 * 36e5;
      path(work, home, t, t + 40 * 6e4);
      t += 40 * 6e4;
    }
    const outings = weekday ? (rand() < 0.35 ? 1 : 0) : 1 + Math.floor(rand() * 2);
    for (let k = 0; k < outings; k++) {
      let pick = null;
      let r = rand() * haunts.reduce((s, h) => s + h.weight, 0);
      for (const h of haunts) {
        r -= h.weight;
        if (r <= 0) {
          pick = h;
          break;
        }
      }
      pick = pick || haunts[0];
      path(home, pick, t, t + 20 * 6e4);
      t += 20 * 6e4;
      visit(pick, t, t + (0.5 + rand() * 2) * 36e5, 'UNKNOWN');
      t += (0.5 + rand() * 2) * 36e5;
      path(pick, home, t, t + 20 * 6e4);
      t += 20 * 6e4;
    }
    visit(home, t, day + 864e5, 'HOME');
  }
  return { semanticSegments: segments, rawSignals: [], userLocationProfile: { frequentPlaces: [] } };
}

/** Fake Overpass elements so "Find places" works offline in the demo. */
export function makeDemoPlaces({ lat, lng, radius, seed = 7 }) {
  const rand = rng(seed);
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((lat * Math.PI) / 180));
  const kinds = [
    ['amenity', 'cafe', ['Café Lumière', 'Le Petit Moka', 'Brew & Co', 'Café des Amis', 'The Daily Grind']],
    ['amenity', 'restaurant', ['Chez Marcel', 'Trattoria Nonna', 'Sakura', 'Bistro du Coin', 'Le Jardin Secret']],
    ['amenity', 'bar', ['Le Comptoir', 'The Hidden Door', 'Bar Bleu']],
    ['tourism', 'museum', ['Musée des Arts Oubliés', 'Maison de la Photographie']],
    ['leisure', 'park', ['Parc des Buttes', 'Square Vert', 'Jardin Municipal']],
    ['tourism', 'viewpoint', ['Belvédère', 'Point de Vue']],
    ['historic', 'monument', ['Fontaine Ancienne', 'Vieux Pont']],
    ['shop', 'books', ['Librairie du Passage', 'Second Chapter']],
  ];
  const elements = [];
  let id = 1;
  for (const [key, value, names] of kinds) {
    for (const name of names) {
      const ang = rand() * 2 * Math.PI;
      const dist = Math.sqrt(rand()) * radius;
      elements.push({
        type: 'node',
        id: id++,
        lat: lat + Math.cos(ang) * dist * mLat,
        lon: lng + Math.sin(ang) * dist * mLng,
        tags: { [key]: value, name },
      });
    }
  }
  return { elements };
}

/** A fake street grid and a few parks for the area in view, shaped like Overpass `out geom`. */
export function makeDemoArea(bbox, seed = 3) {
  const rand = rng(seed);
  const midLat = (bbox.south + bbox.north) / 2;
  const mLat = 1 / 111320;
  const mLng = 1 / (111320 * Math.cos((midLat * Math.PI) / 180));
  const spacing = 140;
  const elements = [];
  let id = 1;
  const snap = (v, step) => Math.floor(v / step) * step;
  const latStart = snap(bbox.south, spacing * mLat);
  const lngStart = snap(bbox.west, spacing * mLng);
  const names = ['Rue des Lilas', 'Avenue Verte', 'Rue du Marché', 'Boulevard Nord', 'Impasse Bleue', 'Rue Haute'];
  for (let lat = latStart; lat <= bbox.north; lat += spacing * mLat) {
    const wobble = (rand() - 0.5) * 30 * mLat;
    const geometry = [];
    for (let lng = lngStart; lng <= bbox.east + spacing * mLng; lng += spacing * mLng) {
      geometry.push({ lat: lat + wobble + Math.sin(lng * 4000) * 8 * mLat, lon: lng });
    }
    elements.push({ type: 'way', id: id++, tags: { highway: rand() < 0.3 ? 'footway' : 'residential', name: names[id % names.length] }, geometry });
  }
  for (let lng = lngStart; lng <= bbox.east; lng += spacing * mLng) {
    const geometry = [];
    for (let lat = latStart; lat <= bbox.north + spacing * mLat; lat += spacing * mLat) {
      geometry.push({ lat, lon: lng + (rand() - 0.5) * 10 * mLng });
    }
    elements.push({ type: 'way', id: id++, tags: { highway: 'residential', name: names[id % names.length] }, geometry });
  }
  for (let k = 0; k < 6; k++) {
    const cLat = bbox.south + rand() * (bbox.north - bbox.south);
    const cLng = bbox.west + rand() * (bbox.east - bbox.west);
    const r = 60 + rand() * 120;
    const geometry = [];
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * 2 * Math.PI;
      geometry.push({ lat: cLat + Math.cos(ang) * r * mLat * (0.8 + rand() * 0.4), lon: cLng + Math.sin(ang) * r * mLng * (0.8 + rand() * 0.4) });
    }
    geometry.push(geometry[0]);
    elements.push({ type: 'way', id: id++, tags: { leisure: 'park', name: `Parc ${k + 1}` }, geometry });
  }
  return { elements };
}
