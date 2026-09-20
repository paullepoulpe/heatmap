import { parseDocuments } from './parse.js';
import { SpatialIndex, LEVELS, scorePlaces, aggregateForHeat, haversine } from './score.js';
import { CATEGORIES, fetchPlaces, elementToPlace, dedupePlaces } from './places.js';
import { makeDemoTimeline, makeDemoPlaces } from './demo.js';

const $ = (id) => document.getElementById(id);
const els = {
  drop: $('drop'),
  file: $('file-input'),
  demo: $('demo-btn'),
  status: $('status'),
  stats: $('stats'),
  explore: $('explore-card'),
  locate: $('locate-btn'),
  radius: $('radius'),
  radiusOut: $('radius-out'),
  categories: $('categories'),
  find: $('find-btn'),
  placesStatus: $('places-status'),
  resultsCard: $('results-card'),
  results: $('results'),
  summary: $('results-summary'),
  levels: $('levels'),
  sort: $('sort'),
  legend: $('legend'),
};

const state = {
  data: null,
  index: null,
  center: null,
  radius: 2000,
  categories: new Set(['food', 'culture', 'nature']),
  levels: new Set(['unexplored', 'passed']),
  sort: 'distance',
  places: [],
  demo: false,
  activeId: null,
};

const LEVEL_COLORS = { unexplored: '#38bdf8', passed: '#8b97a8', familiar: '#f59e0b' };

// ---------- Map ----------
const map = L.map('map', { zoomControl: true, worldCopyJump: true }).setView([20, 0], 2);
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20,
}).addTo(map);

const heat = L.heatLayer([], {
  radius: 18,
  blur: 22,
  minOpacity: 0.25,
  maxZoom: 15,
  gradient: { 0.15: '#78350f', 0.45: '#d97706', 0.75: '#fbbf24', 1: '#fff7d6' },
}).addTo(map);

const placesLayer = L.layerGroup().addTo(map);
let pin = null;
let circle = null;

function setCenter(latlng, { pan = false } = {}) {
  state.center = { lat: latlng.lat, lng: latlng.lng };
  if (!pin) {
    pin = L.marker(latlng, { draggable: true, title: 'Explore around here' }).addTo(map);
    pin.on('dragend', () => setCenter(pin.getLatLng()));
    circle = L.circle(latlng, { radius: state.radius, color: '#38bdf8', weight: 1.5, dashArray: '6 6', fillOpacity: 0.05, interactive: false }).addTo(map);
  } else {
    pin.setLatLng(latlng);
    circle.setLatLng(latlng);
  }
  if (pan) map.flyTo(latlng, Math.max(map.getZoom(), 13));
  if (state.places.length) renderResults();
}

map.on('click', (e) => {
  if (state.data) setCenter(e.latlng);
});

// ---------- Import ----------
function setStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.classList.toggle('is-error', isError);
}

async function readFiles(files) {
  const docs = [];
  for (const f of files) {
    setStatus(els.status, `Reading ${f.name}…`);
    const text = await f.text();
    try {
      docs.push(JSON.parse(text));
    } catch {
      setStatus(els.status, `${f.name} is not valid JSON, skipped.`, true);
    }
  }
  return docs;
}

function loadDocuments(docs, { demo = false } = {}) {
  state.demo = demo;
  const data = parseDocuments(docs);
  if (!data.points.length) {
    setStatus(els.status, 'No location points found. Is this a Google Timeline export?', true);
    return;
  }
  state.data = data;
  state.index = new SpatialIndex(data.points);
  const heatPoints = aggregateForHeat(data.points);
  const maxW = heatPoints.reduce((m, p) => Math.max(m, p.w), 0) || 1;
  heat.setOptions({ max: Math.max(1, maxW * 0.15) });
  heat.setLatLngs(heatPoints.map((p) => [p.lat, p.lng, p.w]));
  els.legend.hidden = false;

  const hot = state.index.hotspot();
  const bounds = L.latLngBounds(data.points.slice(0, 20000).map((p) => [p.lat, p.lng]));
  map.fitBounds(bounds.pad(0.05));
  setCenter(L.latLng(hot.lat, hot.lng));
  map.setView([hot.lat, hot.lng], 13);

  renderStats(data);
  els.explore.hidden = false;
  els.resultsCard.hidden = true;
  state.places = [];
  placesLayer.clearLayers();
  setStatus(els.status, demo ? 'Demo data loaded. Now find places around the pin.' : 'Loaded. Drag the pin to where you are, then find places.');
}

function renderStats(data) {
  const fmtDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '–');
  const rows = [
    ['Points', data.meta.total.toLocaleString()],
    ['Visits', data.visits.length.toLocaleString()],
    ['From', fmtDate(data.meta.firstTime)],
    ['To', fmtDate(data.meta.lastTime)],
  ];
  els.stats.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  els.stats.hidden = false;
}

els.file.addEventListener('change', async () => {
  if (!els.file.files.length) return;
  const docs = await readFiles(els.file.files);
  loadDocuments(docs);
  els.file.value = '';
});

for (const evt of ['dragenter', 'dragover']) {
  els.drop.addEventListener(evt, (e) => {
    e.preventDefault();
    els.drop.classList.add('is-over');
  });
}
for (const evt of ['dragleave', 'drop']) {
  els.drop.addEventListener(evt, (e) => {
    e.preventDefault();
    els.drop.classList.remove('is-over');
  });
}
els.drop.addEventListener('drop', async (e) => {
  const files = [...e.dataTransfer.files].filter((f) => /\.json$/i.test(f.name));
  if (!files.length) return setStatus(els.status, 'Drop .json files (unzip a Takeout archive first).', true);
  loadDocuments(await readFiles(files));
});

els.demo.addEventListener('click', () => {
  setStatus(els.status, 'Generating a year of pretend wandering…');
  setTimeout(() => loadDocuments([makeDemoTimeline()], { demo: true }), 20);
});

// ---------- Explore controls ----------
els.radius.addEventListener('input', () => {
  state.radius = Number(els.radius.value);
  els.radiusOut.value = `${(state.radius / 1000).toFixed(1)} km`;
  if (circle) circle.setRadius(state.radius);
});

els.categories.innerHTML = CATEGORIES.map(
  (c) => `<label class="chip"><input type="checkbox" value="${c.id}" ${state.categories.has(c.id) ? 'checked' : ''}/>${c.label}</label>`,
).join('');
els.categories.addEventListener('change', (e) => {
  const v = e.target.value;
  if (e.target.checked) state.categories.add(v);
  else state.categories.delete(v);
});

els.levels.innerHTML = LEVELS.map(
  (l) => `<label class="chip" style="color:${LEVEL_COLORS[l.id]}"><input type="checkbox" value="${l.id}" ${state.levels.has(l.id) ? 'checked' : ''}/><span class="dot"></span>${l.label}</label>`,
).join('');
els.levels.addEventListener('change', (e) => {
  const v = e.target.value;
  if (e.target.checked) state.levels.add(v);
  else state.levels.delete(v);
  renderResults();
});

els.sort.addEventListener('change', () => {
  state.sort = els.sort.value;
  renderResults();
});

els.locate.addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus(els.placesStatus, 'Geolocation is not available in this browser.', true);
  setStatus(els.placesStatus, 'Locating…');
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      setCenter(L.latLng(pos.coords.latitude, pos.coords.longitude), { pan: true });
      setStatus(els.placesStatus, '');
    },
    (err) => setStatus(els.placesStatus, `Could not get your location (${err.message}).`, true),
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

els.find.addEventListener('click', async () => {
  if (!state.center) return;
  if (!state.categories.size) return setStatus(els.placesStatus, 'Pick at least one category.', true);
  els.find.disabled = true;
  setStatus(els.placesStatus, 'Asking OpenStreetMap for places nearby…');
  const params = { lat: state.center.lat, lng: state.center.lng, radius: state.radius, categories: [...state.categories] };
  try {
    let places;
    if (state.demo) {
      places = dedupePlaces(makeDemoPlaces(params).elements.map(elementToPlace).filter(Boolean));
    } else {
      places = await fetchPlaces(params);
    }
    state.places = places;
    setStatus(els.placesStatus, places.length ? `${places.length} named places found.` : 'Nothing found here. Try a bigger radius or more categories.');
    els.resultsCard.hidden = false;
    renderResults();
  } catch (err) {
    setStatus(els.placesStatus, `Overpass failed: ${err.message}. Try again in a minute.`, true);
  } finally {
    els.find.disabled = false;
  }
});

// ---------- Results ----------
function fmtDist(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

function renderResults() {
  const scored = scorePlaces(state.places, state.index, state.center);
  const shown = scored
    .filter((p) => state.levels.has(p.level) && p.distance <= state.radius * 1.15)
    .sort((a, b) => (state.sort === 'distance' ? a.distance - b.distance : a.familiarity - b.familiarity || a.distance - b.distance));

  const counts = { unexplored: 0, passed: 0, familiar: 0 };
  for (const p of scored) counts[p.level] += 1;
  els.summary.textContent = `${counts.unexplored} unexplored · ${counts.passed} passed by · ${counts.familiar} familiar`;

  els.results.innerHTML = shown
    .slice(0, 200)
    .map(
      (p) => `<li class="result ${p.id === state.activeId ? 'is-active' : ''}" data-id="${p.id}">
        <div class="result__name"><span class="badge badge--${p.level}">${LEVELS.find((l) => l.id === p.level).label}</span>${escapeHtml(p.name)}</div>
        <div class="result__meta">${escapeHtml(p.kind)}</div>
        <div class="result__dist">${fmtDist(p.distance)}</div>
      </li>`,
    )
    .join('');

  placesLayer.clearLayers();
  const byId = new Map();
  for (const p of shown) {
    const m = L.circleMarker([p.lat, p.lng], {
      radius: p.level === 'unexplored' ? 7 : 5,
      color: '#0b0e12',
      weight: 1.5,
      fillColor: LEVEL_COLORS[p.level],
      fillOpacity: 0.95,
      className: 'place-marker',
    })
      .bindPopup(popupHtml(p))
      .on('click', () => setActive(p.id, false));
    m.addTo(placesLayer);
    byId.set(p.id, m);
  }
  placesLayer._byId = byId;
}

function popupHtml(p) {
  const g = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  return `<strong>${escapeHtml(p.name)}</strong><span class="muted small">${escapeHtml(p.kind)} · ${fmtDist(p.distance)} · ${LEVELS.find((l) => l.id === p.level).label.toLowerCase()}</span>
    <span class="small"><a href="${p.osmUrl}" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="${g}" target="_blank" rel="noopener">Google Maps</a></span>`;
}

function setActive(id, fly = true) {
  state.activeId = id;
  for (const li of els.results.children) li.classList.toggle('is-active', li.dataset.id === id);
  const m = placesLayer._byId && placesLayer._byId.get(id);
  if (m) {
    if (fly) map.flyTo(m.getLatLng(), Math.max(map.getZoom(), 16));
    m.openPopup();
  }
}

els.results.addEventListener('click', (e) => {
  const li = e.target.closest('.result');
  if (li) {
    setActive(li.dataset.id);
    li.scrollIntoView({ block: 'nearest' });
  }
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Expose a little for debugging and tests.
window.__unexplored = { state, map, loadDocuments, haversine };
