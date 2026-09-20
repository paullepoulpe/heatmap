// Persistence: the parsed history goes to IndexedDB (localStorage tops out at
// ~5 MB, a few years of Timeline is far more), small settings go to localStorage.
// Points are packed into typed arrays so the store stays compact and fast.

const DB_NAME = 'unexplored';
const DB_VERSION = 1;
const STORE = 'history';
const KEY = 'current';

export const KINDS = ['visit', 'path', 'raw'];
export const MODES = ['foot', 'bike', 'vehicle', 'stay', 'unknown'];

/** Pack { points, visits, meta } into typed arrays plus small JSON. Pure. */
export function encodeHistory(data, extra = {}) {
  const n = data.points.length;
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  const w = new Float32Array(n);
  const t = new Float64Array(n);
  const kind = new Uint8Array(n);
  const mode = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = data.points[i];
    lat[i] = p.lat;
    lng[i] = p.lng;
    w[i] = p.w;
    t[i] = Number.isFinite(p.t) ? p.t : NaN;
    kind[i] = Math.max(0, KINDS.indexOf(p.kind));
    const m = MODES.indexOf(p.mode || 'unknown');
    mode[i] = m < 0 ? MODES.length - 1 : m;
  }
  return { version: 1, n, lat, lng, w, t, kind, mode, visits: data.visits, meta: data.meta, savedAt: Date.now(), ...extra };
}

/** Inverse of encodeHistory. Pure. */
export function decodeHistory(rec) {
  if (!rec || rec.version !== 1) return null;
  const points = new Array(rec.n);
  for (let i = 0; i < rec.n; i++) {
    points[i] = {
      lat: rec.lat[i],
      lng: rec.lng[i],
      w: rec.w[i],
      t: Number.isNaN(rec.t[i]) ? NaN : rec.t[i],
      kind: KINDS[rec.kind[i]],
      mode: MODES[rec.mode[i]],
    };
  }
  return { points, visits: rec.visits || [], meta: rec.meta, savedAt: rec.savedAt, demo: Boolean(rec.demo) };
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export async function saveHistory(data, extra) {
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (s) => s.put(encodeHistory(data, extra), KEY));
  } finally {
    db.close();
  }
}

export async function loadHistory() {
  let db;
  try {
    db = await openDb();
    const rec = await tx(db, 'readonly', (s) => s.get(KEY));
    return decodeHistory(rec);
  } catch {
    return null;
  } finally {
    if (db) db.close();
  }
}

export async function clearHistory() {
  const db = await openDb();
  try {
    await tx(db, 'readwrite', (s) => s.delete(KEY));
  } finally {
    db.close();
  }
}

// ---------- Small settings in localStorage ----------
const SETTINGS_KEY = 'unexplored.settings';

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export function saveSettings(patch) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...loadSettings(), ...patch }));
  } catch {
    /* private mode or quota: settings are a convenience only */
  }
}
