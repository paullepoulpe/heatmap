import { parseDocuments } from './parse.js';
import { SpatialIndex, LEVELS, scorePlaces, aggregateForHeat, haversine } from './score.js';
import { CATEGORIES, fetchPlaces, elementToPlace, dedupePlaces, fetchArea, parseAreaElements } from './places.js';
import { CoverageGrid, computeCoverage, pointsForMode } from './coverage.js';
import { createCanvasLayer, metersPerPixel } from './canvas-layer.js';
import { saveHistory, loadHistory, clearHistory, loadSettings, saveSettings } from './storage.js';
import { makeDemoTimeline, makeDemoPlaces, makeDemoArea } from './demo.js';
import { tilesForBox, countTilesForBox } from './tiles.js';

const $ = (id) => document.getElementById(id);
const els = {
  drop: $('drop'),
  file: $('file-input'),
  demo: $('demo-btn'),
  status: $('status'),
  stats: $('stats'),
  savedRow: $('saved-row'),
  savedNote: $('saved-note'),
  forget: $('forget-btn'),
  noDataLayers: $('no-data-layers'),
  layersControls: $('layers-controls'),
  travel: $('travel'),
  reveal: $('reveal'),
  revealOut: $('reveal-out'),
  layerFog: $('layer-fog'),
  layerStreets: $('layer-streets'),
  layerParks: $('layer-parks'),
  layerHeat: $('layer-heat'),
  coverageStatus: $('coverage-status'),
  coverageStats: $('coverage-stats'),
  coveragePill: $('coverage-pill'),
  noDataExplore: $('no-data-explore'),
  exploreControls: $('explore-controls'),
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
  legendHeat: $('legend-heat'),
};

const settings = loadSettings();

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
  travel: settings.travel || 'foot',
  reveal: settings.reveal || 40,
  layers: { fog: true, streets: true, parks: true, heat: false, ...(settings.layers || {}) },
  walked: null, // { agg, byZoom: Map, grid: CoverageGrid }
  area: newAreaCache(),
  coverage: null,
};

const CANVAS_PAD = 0.25; // overlay canvases extend this fraction of the viewport beyond each edge
const TILE_Z = 13; // ~3.2 km square at mid latitudes: a few thousand ways per tile in a dense city
const MAX_TILES = 12; // beyond this many tiles under the canvas we ask to zoom in
const MAX_INFLIGHT = 2; // public Overpass servers allow few parallel requests per client

function newAreaCache() {
  return { ways: new Map(), areas: new Map(), tiles: new Map(), runs: new Map(), inflight: 0, queue: [] };
}
const LEVEL_COLORS = { unexplored: '#38bdf8', passed: '#8b97a8', familiar: '#f59e0b' };

// ---------- Panels ----------
const panels = {
  import: $('panel-import'),
  layers: $('panel-layers'),
  explore: $('panel-explore'),
};

function openPanel(name) {
  for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
  for (const btn of document.querySelectorAll('.fab[data-panel]')) btn.classList.toggle('is-active', btn.dataset.panel === name);
  document.body.classList.toggle('has-panel', Boolean(name));
}

function togglePanel(name) {
  openPanel(panels[name].hidden ? name : null);
}

for (const btn of document.querySelectorAll('[data-panel]')) {
  btn.addEventListener('click', () => (btn.classList.contains('fab') ? togglePanel(btn.dataset.panel) : openPanel(btn.dataset.panel)));
}
for (const btn of document.querySelectorAll('[data-close]')) btn.addEventListener('click', () => openPanel(null));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') openPanel(null);
});
// iOS Safari ignores user-scalable=no; these stop it zooming the page when a pinch starts on the chrome.
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
document.addEventListener('touchmove', (e) => {
  if (e.touches.length > 1 && !e.target.closest('.leaflet-container')) e.preventDefault();
}, { passive: false });

// ---------- Map ----------
const map = L.map('map', { zoomControl: false, worldCopyJump: true });
L.control.zoom({ position: 'bottomright' }).addTo(map);
if (settings.view) map.setView([settings.view.lat, settings.view.lng], settings.view.zoom);
else map.setView([20, 0], 2);

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
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
});

const fogLayer = createCanvasLayer((ctx, v) => {
  if (!state.walked) return;
  ctx.fillStyle = 'rgba(15, 18, 22, 0.55)';
  ctx.fillRect(0, 0, v.width, v.height);
  const b = v.bounds;
  const mpp = metersPerPixel(map.getCenter().lat, v.zoom);
  const pts = walkedPointsForZoom(v.zoom, mpp).filter(
    (p) => p.lat >= b.getSouth() && p.lat <= b.getNorth() && p.lng >= b.getWest() && p.lng <= b.getEast(),
  );
  const r = Math.max(2, state.reveal / mpp);
  ctx.globalCompositeOperation = 'destination-out';
  if (r >= 3) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.beginPath();
    for (const p of pts) {
      const q = v.project(p.lat, p.lng);
      ctx.moveTo(q.x + r * 1.7, q.y);
      ctx.arc(q.x, q.y, r * 1.7, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 1)';
  ctx.beginPath();
  for (const p of pts) {
    const q = v.project(p.lat, p.lng);
    ctx.moveTo(q.x + r, q.y);
    ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}, { className: 'fog-canvas' });

/**
 * Walked points thinned to the current zoom: one point per ~2.5 screen pixels,
 * so the fog never draws more circles than the screen has room for.
 */
function walkedPointsForZoom(zoom, mpp) {
  const cell = Math.max(20, Math.round(mpp * 2.5));
  let list = state.walked.byZoom.get(cell);
  if (!list) {
    list = cell === 20 ? state.walked.agg : aggregateForHeat(state.walked.agg, cell);
    state.walked.byZoom.set(cell, list);
  }
  return list;
}

const coverageLayer = createCanvasLayer((ctx, v) => {
  const cov = state.coverage;
  if (!cov) return;
  const lw = v.zoom >= 17 ? 4 : v.zoom >= 15 ? 3 : 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (state.layers.parks) {
    for (const park of cov.parks) {
      ctx.beginPath();
      for (const ring of park.rings) {
        ring.forEach((c, i) => {
          const q = v.project(c.lat, c.lng);
          if (i === 0) ctx.moveTo(q.x, q.y);
          else ctx.lineTo(q.x, q.y);
        });
        ctx.closePath();
      }
      ctx.fillStyle = park.visited ? 'rgba(245, 158, 11, 0.22)' : 'rgba(56, 189, 248, 0.22)';
      ctx.strokeStyle = park.visited ? 'rgba(245, 158, 11, 0.9)' : 'rgba(56, 189, 248, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
    }
  }
  if (state.layers.streets) {
    for (const pass of [false, true]) {
      ctx.strokeStyle = pass ? '#f59e0b' : '#38bdf8';
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (const st of cov.streets) {
        for (const run of st.runs) {
          if (run.covered !== pass) continue;
          run.coords.forEach((c, i) => {
            const q = v.project(c.lat, c.lng);
            if (i === 0) ctx.moveTo(q.x, q.y);
            else ctx.lineTo(q.x, q.y);
          });
        }
      }
      ctx.stroke();
    }
  }
}, { className: 'coverage-canvas' });

const placesLayer = L.layerGroup().addTo(map);
let pin = null;
let circle = null;

function applyLayerVisibility() {
  const want = (on, layer) => {
    if (on && !map.hasLayer(layer)) layer.addTo(map);
    if (!on && map.hasLayer(layer)) map.removeLayer(layer);
  };
  const loaded = Boolean(state.data);
  want(loaded && state.layers.fog, fogLayer);
  want(loaded && (state.layers.streets || state.layers.parks), coverageLayer);
  want(loaded && state.layers.heat, heat);
  els.legendHeat.hidden = !state.layers.heat;
  if (map.hasLayer(placesLayer)) {
    map.removeLayer(placesLayer);
    placesLayer.addTo(map);
  }
}

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
  if (!state.data) return;
  if (!panels.explore.hidden || window.innerWidth > 640) setCenter(e.latlng);
  if (window.innerWidth <= 640) openPanel(null);
});

let viewTimer = null;
map.on('moveend', () => {
  clearTimeout(viewTimer);
  viewTimer = setTimeout(() => {
    const c = map.getCenter();
    saveSettings({ view: { lat: c.lat, lng: c.lng, zoom: map.getZoom() } });
  }, 400);
  scheduleCoverage();
});

// ---------- Import & persistence ----------
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
  const data = parseDocuments(docs);
  if (!data.points.length) {
    setStatus(els.status, 'No location points found. Is this a Google Timeline export?', true);
    return;
  }
  applyData(data, { demo, fit: true });
  setStatus(els.status, demo ? 'Demo data loaded. Saving on this device…' : 'Loaded. Saving on this device…');
  saveHistory(data, { demo })
    .then(() => {
      setStatus(els.status, demo ? 'Demo data loaded and saved on this device.' : 'Loaded and saved on this device.');
      showSaved(Date.now());
    })
    .catch((err) => setStatus(els.status, `Loaded, but could not save on this device (${err.message}).`, true));
}

/** Put a parsed bundle on the map (fresh import or restored from storage). */
function applyData(data, { demo = false, fit = false } = {}) {
  state.demo = demo;
  state.data = data;
  state.index = new SpatialIndex(data.points);
  const heatPoints = aggregateForHeat(data.points);
  const maxW = heatPoints.reduce((m, p) => Math.max(m, p.w), 0) || 1;
  heat.setOptions({ max: Math.max(1, maxW * 0.15) });
  heat.setLatLngs(heatPoints.map((p) => [p.lat, p.lng, p.w]));
  els.legend.hidden = false;

  const hot = state.index.hotspot();
  setCenter(L.latLng(hot.lat, hot.lng));
  if (fit || !settings.view) map.setView([hot.lat, hot.lng], 15);

  state.area = newAreaCache();
  state.coverage = null;
  state.places = [];
  placesLayer.clearLayers();
  els.resultsCard.hidden = true;
  rebuildWalked();
  applyLayerVisibility();
  renderStats(data);
  els.noDataLayers.hidden = true;
  els.layersControls.hidden = false;
  els.noDataExplore.hidden = true;
  els.exploreControls.hidden = false;
}

function showSaved(savedAt) {
  els.savedRow.hidden = false;
  els.savedNote.textContent = `Saved on this device ${new Date(savedAt).toLocaleString()}`;
}

function renderStats(data) {
  const fmtDate = (t) => (t ? new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short' }) : '–');
  const modes = { foot: 0, bike: 0, vehicle: 0 };
  for (const p of data.points) if (p.kind !== 'visit' && modes[p.mode] != null) modes[p.mode] += 1;
  const rows = [
    ['Points', data.meta.total.toLocaleString()],
    ['Visits', data.visits.length.toLocaleString()],
    ['From', fmtDate(data.meta.firstTime)],
    ['To', fmtDate(data.meta.lastTime)],
    ['On foot', modes.foot.toLocaleString()],
    ['Bike / vehicle', `${modes.bike.toLocaleString()} / ${modes.vehicle.toLocaleString()}`],
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

els.forget.addEventListener('click', async () => {
  try {
    await clearHistory();
    els.savedRow.hidden = true;
    setStatus(els.status, 'Saved history removed from this device. The map keeps what is loaded until you reload the page.');
  } catch (err) {
    setStatus(els.status, `Could not remove saved history (${err.message}).`, true);
  }
});

async function restoreSaved() {
  const saved = await loadHistory();
  if (!saved) {
    openPanel('import');
    return;
  }
  applyData({ points: saved.points, visits: saved.visits, meta: saved.meta }, { demo: saved.demo, fit: !settings.view });
  showSaved(saved.savedAt);
  setStatus(els.status, saved.demo ? 'Demo data restored from this device.' : 'History restored from this device.');
}

// ---------- Coverage (fog, streets, parks) ----------
function rebuildWalked() {
  if (!state.data) return;
  const pts = pointsForMode(state.data.points, state.travel);
  const agg = aggregateForHeat(pts, 20);
  state.walked = { agg, byZoom: new Map(), grid: new CoverageGrid(agg, { cellMeters: 20, reach: Math.max(25, state.reveal) }) };
  state.area.runs.clear();
  fogLayer.redraw();
  refreshCoverage();
}

function viewBox(pad = 0) {
  const b = map.getBounds().pad(pad);
  return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
}

const intersects = (a, b) => !(a.east < b.west || a.west > b.east || a.north < b.south || a.south > b.north);

function boxOfCoords(coords) {
  let s = Infinity;
  let n = -Infinity;
  let w = Infinity;
  let e = -Infinity;
  for (const c of coords) {
    if (c.lat < s) s = c.lat;
    if (c.lat > n) n = c.lat;
    if (c.lng < w) w = c.lng;
    if (c.lng > e) e = c.lng;
  }
  return { south: s, west: w, north: n, east: e };
}

let coverageTimer = null;
function scheduleCoverage() {
  clearTimeout(coverageTimer);
  coverageTimer = setTimeout(refreshCoverage, 300);
}

function setPill(text, html = false) {
  els.coveragePill.hidden = false;
  if (html) els.coveragePill.innerHTML = text;
  else els.coveragePill.textContent = text;
}

/** Make sure every tile under the padded canvas is loaded, then draw. */
function refreshCoverage() {
  if (!state.data || !state.walked) return;
  if (!state.layers.streets && !state.layers.parks) {
    els.coverageStatus.textContent = '';
    els.coverageStats.hidden = true;
    els.coveragePill.hidden = true;
    return;
  }
  const drawBox = viewBox(CANVAS_PAD); // matches the canvas padding
  if (countTilesForBox(drawBox, TILE_Z) > MAX_TILES) {
    state.coverage = null;
    coverageLayer.redraw();
    setStatus(els.coverageStatus, 'Zoom in to see which streets and parks you have covered.');
    els.coverageStats.hidden = true;
    setPill('Zoom in for streets');
    return;
  }
  const tiles = tilesForBox(drawBox, TILE_Z);
  const missing = tiles.filter((t) => {
    const st = state.area.tiles.get(t.key);
    return !st || (st.status === 'error' && Date.now() - st.at > 15000);
  });
  for (const t of missing) {
    state.area.tiles.set(t.key, { status: 'queued', at: Date.now() });
    state.area.queue.push(t);
  }
  pumpTileQueue();
  drawCoverageForView();
}

function pumpTileQueue() {
  const area = state.area;
  while (area.inflight < MAX_INFLIGHT && area.queue.length) {
    const t = area.queue.shift();
    area.inflight += 1;
    area.tiles.set(t.key, { status: 'loading', at: Date.now() });
    loadTile(t, area).finally(() => {
      area.inflight -= 1;
      if (state.area === area) {
        drawCoverageForView();
        pumpTileQueue();
      }
    });
  }
}

async function loadTile(t, area) {
  try {
    const { ways, areas } = state.demo
      ? parseAreaElements(makeDemoArea(t.bounds, t.x * 31 + t.y).elements)
      : await fetchArea(t.bounds);
    if (state.area !== area) return; // history was replaced meanwhile
    for (const w of ways) if (!area.ways.has(w.id)) area.ways.set(w.id, { ...w, box: boxOfCoords(w.coords) });
    for (const a of areas) if (!area.areas.has(a.id)) area.areas.set(a.id, { ...a, box: boxOfCoords(a.rings.flat()) });
    area.tiles.set(t.key, { status: 'done', at: Date.now() });
  } catch (err) {
    area.tiles.set(t.key, { status: 'error', at: Date.now(), message: err.message });
  }
}

function runsFor(way) {
  let runs = state.area.runs.get(way.id);
  if (!runs) {
    runs = computeCoverage([way], [], state.walked.grid).streets[0].runs;
    state.area.runs.set(way.id, runs);
  }
  return runs;
}

/** Draw everything under the padded canvas; report stats for what is actually visible. */
function drawCoverageForView() {
  if (!state.walked) return;
  const drawBox = viewBox(CANVAS_PAD);
  const view = viewBox();
  if (countTilesForBox(drawBox, TILE_Z) > MAX_TILES) return; // zoomed out meanwhile: nothing to draw
  const streets = [];
  const parks = [];
  let walked = 0;
  let total = 0;
  let parksInView = 0;
  let visitedInView = 0;
  for (const w of state.area.ways.values()) {
    if (!intersects(w.box, drawBox)) continue;
    const runs = runsFor(w);
    streets.push({ ...w, runs });
    if (intersects(w.box, view)) {
      for (const r of runs) {
        total += r.length;
        if (r.covered) walked += r.length;
      }
    }
  }
  for (const a of state.area.areas.values()) {
    if (!intersects(a.box, drawBox)) continue;
    let entry = state.area.runs.get(a.id);
    if (!entry) {
      entry = computeCoverage([], [a], state.walked.grid).parks[0];
      state.area.runs.set(a.id, entry);
    }
    parks.push(entry);
    if (intersects(a.box, view)) {
      parksInView += 1;
      if (entry.visited) visitedInView += 1;
    }
  }
  state.coverage = { streets, parks };
  coverageLayer.redraw();

  const tiles = tilesForBox(view, TILE_Z).map((t) => state.area.tiles.get(t.key));
  const pending = tiles.filter((st) => !st || st.status === 'queued' || st.status === 'loading').length;
  const failed = tiles.filter((st) => st && st.status === 'error');
  const pct = total ? Math.round((100 * walked) / total) : 0;
  const km = (m) => (m / 1000).toFixed(1);
  const rows = [];
  const pill = [];
  if (state.layers.streets) {
    rows.push(['Streets walked', `${pct}%`], ['Distance', `${km(walked)} of ${km(total)} km`]);
    pill.push(`<b>${pct}%</b> of streets walked`);
  }
  if (state.layers.parks) {
    rows.push(['Parks visited', `${visitedInView} of ${parksInView}`]);
    pill.push(`<b>${visitedInView}</b>/${parksInView} parks`);
  }
  els.coverageStats.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
  els.coverageStats.hidden = false;
  if (pending) {
    setPill(`Loading streets… ${pill.join('<span class="sep">·</span>')}`, true);
    setStatus(els.coverageStatus, `Loading streets and parks from OpenStreetMap (${pending} tile${pending > 1 ? 's' : ''} left)…`);
  } else if (failed.length) {
    setPill(pill.join('<span class="sep">·</span>'), true);
    setStatus(els.coverageStatus, `Some streets failed to load (${failed[0].message}). They retry as you pan.`, true);
  } else {
    setPill(pill.join('<span class="sep">·</span>'), true);
    setStatus(els.coverageStatus, streets.length || parks.length ? 'In the current view:' : 'No mapped streets or parks in view.');
  }
}

// ---------- Layer controls ----------
els.travel.value = state.travel;
els.travel.addEventListener('change', () => {
  state.travel = els.travel.value;
  saveSettings({ travel: state.travel });
  rebuildWalked();
});

els.reveal.value = state.reveal;
els.revealOut.value = `${state.reveal} m`;
let revealTimer = null;
els.reveal.addEventListener('input', () => {
  state.reveal = Number(els.reveal.value);
  els.revealOut.value = `${state.reveal} m`;
  fogLayer.redraw();
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => {
    saveSettings({ reveal: state.reveal });
    rebuildWalked();
  }, 300);
});

for (const [key, el] of [['fog', els.layerFog], ['streets', els.layerStreets], ['parks', els.layerParks], ['heat', els.layerHeat]]) {
  el.checked = state.layers[key];
  el.addEventListener('change', () => {
    state.layers[key] = el.checked;
    saveSettings({ layers: state.layers });
    applyLayerVisibility();
    if (key === 'streets' || key === 'parks') refreshCoverage();
  });
}

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
    const places = state.demo
      ? dedupePlaces(makeDemoPlaces(params).elements.map(elementToPlace).filter(Boolean))
      : await fetchPlaces(params);
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
    if (window.innerWidth <= 640) openPanel(null);
    else li.scrollIntoView({ block: 'nearest' });
  }
});

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- Boot ----------
restoreSaved();

window.__unexplored = { state, map, loadDocuments, haversine, refreshCoverage, openPanel, fogLayer, coverageLayer };
