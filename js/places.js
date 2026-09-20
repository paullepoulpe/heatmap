// Nearby points of interest from OpenStreetMap via the Overpass API.

export const CATEGORIES = [
  {
    id: 'food',
    label: 'Cafes, bars & restaurants',
    rules: [['amenity', '^(cafe|restaurant|bar|pub|biergarten|ice_cream|food_court)$']],
  },
  {
    id: 'culture',
    label: 'Culture & history',
    rules: [
      ['tourism', '^(museum|gallery|attraction|artwork)$'],
      ['amenity', '^(theatre|arts_centre|cinema|library)$'],
      ['historic', '.'],
    ],
  },
  {
    id: 'nature',
    label: 'Parks & nature',
    rules: [
      ['leisure', '^(park|garden|nature_reserve)$'],
      ['natural', '^(peak|beach|spring|waterfall|cave_entrance|wood)$'],
      ['tourism', '^(viewpoint|picnic_site)$'],
    ],
  },
  {
    id: 'shops',
    label: 'Interesting shops & markets',
    rules: [
      ['shop', '^(books|bakery|deli|coffee|tea|chocolate|wine|cheese|art|music|antiques|second_hand|craft)$'],
      ['amenity', '^(marketplace)$'],
    ],
  },
  {
    id: 'sport',
    label: 'Sport & leisure',
    rules: [['leisure', '^(swimming_pool|sports_centre|climbing|fitness_centre|bowling_alley|ice_rink|water_park)$']],
  },
  {
    id: 'landmarks',
    label: 'Landmarks',
    rules: [
      ['amenity', '^(place_of_worship)$'],
      ['man_made', '^(lighthouse|tower|windmill|observatory)$'],
    ],
  },
];

export const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export function buildQuery({ lat, lng, radius, categories }) {
  const selected = CATEGORIES.filter((c) => categories.includes(c.id));
  const around = `(around:${Math.round(radius)},${lat.toFixed(6)},${lng.toFixed(6)})`;
  const lines = [];
  for (const c of selected) {
    for (const [key, re] of c.rules) {
      lines.push(`  nwr["${key}"~"${re}"]["name"]${around};`);
    }
  }
  return `[out:json][timeout:30];\n(\n${lines.join('\n')}\n);\nout center tags;`;
}

/** Map an Overpass element onto our place shape, or null when it has no position. */
export function elementToPlace(el) {
  const lat = el.lat ?? (el.center && el.center.lat);
  const lng = el.lon ?? (el.center && el.center.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const tags = el.tags || {};
  const category = categoryFor(tags);
  return {
    id: `${el.type}/${el.id}`,
    name: tags.name,
    lat,
    lng,
    category,
    kind: kindFor(tags),
    tags,
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
  };
}

export function categoryFor(tags) {
  for (const c of CATEGORIES) {
    for (const [key, re] of c.rules) {
      if (tags[key] != null && new RegExp(re).test(tags[key])) return c.id;
    }
  }
  return 'other';
}

function kindFor(tags) {
  for (const key of ['amenity', 'tourism', 'leisure', 'natural', 'historic', 'shop', 'man_made']) {
    if (tags[key]) return tags[key].replace(/_/g, ' ');
  }
  return 'place';
}

/** Deduplicate places that share a name within a few metres (node + area copies). */
export function dedupePlaces(places) {
  const out = [];
  const byName = new Map();
  for (const p of places) {
    const key = (p.name || '').toLowerCase();
    const list = byName.get(key) || [];
    const dup = list.some((q) => Math.abs(q.lat - p.lat) < 0.0015 && Math.abs(q.lng - p.lng) < 0.0015);
    if (dup) continue;
    list.push(p);
    byName.set(key, list);
    out.push(p);
  }
  return out;
}

export async function fetchPlaces(params, { fetchImpl = globalThis.fetch, endpoints = ENDPOINTS } = {}) {
  const query = buildQuery(params);
  let lastError = null;
  for (const url of endpoints) {
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${url} answered ${res.status}`);
      const json = await res.json();
      const places = (json.elements || []).map(elementToPlace).filter(Boolean);
      return dedupePlaces(places);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('No Overpass endpoint reachable');
}
