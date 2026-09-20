import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CoverageGrid, sampleLine, splitRuns, pointInRing, areaVisited, computeCoverage, pointsForMode } from '../js/coverage.js';
import { buildAreaQuery, parseAreaElements } from '../js/places.js';
import { tagRunBySpeed, modeFromActivityType, parseDocument } from '../js/parse.js';

const M_LAT = 1 / 111320;
const mLng = (lat) => 1 / (111320 * Math.cos((lat * Math.PI) / 180));

test('CoverageGrid marks cells within reach of a point and nothing further', () => {
  const g = new CoverageGrid([{ lat: 48.85, lng: 2.35 }], { cellMeters: 20, reach: 30 });
  assert.ok(g.has(48.85, 2.35));
  assert.ok(g.has(48.85 + 20 * M_LAT, 2.35));
  assert.ok(!g.has(48.85 + 80 * M_LAT, 2.35));
  assert.ok(!g.has(48.85, 2.35 + 80 * mLng(48.85)));
});

test('sampleLine emits a point every step plus every vertex', () => {
  const coords = [{ lat: 48.85, lng: 2.35 }, { lat: 48.85 + 100 * M_LAT, lng: 2.35 }];
  const s = sampleLine(coords, 10);
  assert.ok(s.length >= 10 && s.length <= 12, `got ${s.length}`);
  assert.equal(s[0].vertex, 0);
  assert.equal(s[s.length - 1].vertex, 1);
});

test('splitRuns divides a street into walked and unwalked stretches with lengths', () => {
  // 400 m street heading north; the walker only covered the middle 100 m
  const coords = [{ lat: 48.85, lng: 2.35 }, { lat: 48.85 + 400 * M_LAT, lng: 2.35 }];
  const pts = [];
  for (let m = 150; m <= 250; m += 10) pts.push({ lat: 48.85 + m * M_LAT, lng: 2.35 });
  const g = new CoverageGrid(pts);
  const runs = splitRuns(coords, g);
  assert.deepEqual(runs.map((r) => r.covered), [false, true, false]);
  const walked = runs.filter((r) => r.covered).reduce((s, r) => s + r.length, 0);
  assert.ok(walked > 120 && walked < 200, `walked ${walked}`);
  const total = runs.reduce((s, r) => s + r.length, 0);
  assert.ok(Math.abs(total - 400) < 2, `total ${total}`);
});

test('pointInRing and areaVisited', () => {
  const ring = [
    { lat: 48.85, lng: 2.35 },
    { lat: 48.85 + 200 * M_LAT, lng: 2.35 },
    { lat: 48.85 + 200 * M_LAT, lng: 2.35 + 200 * mLng(48.85) },
    { lat: 48.85, lng: 2.35 + 200 * mLng(48.85) },
  ];
  assert.ok(pointInRing(48.85 + 100 * M_LAT, 2.35 + 100 * mLng(48.85), ring));
  assert.ok(!pointInRing(48.85 - 10 * M_LAT, 2.35, ring));
  const inside = new CoverageGrid([{ lat: 48.85 + 100 * M_LAT, lng: 2.35 + 100 * mLng(48.85) }]);
  const outside = new CoverageGrid([{ lat: 48.85 + 400 * M_LAT, lng: 2.35 }]);
  assert.equal(areaVisited([ring], inside), true);
  assert.equal(areaVisited([ring], outside), false);
});

test('computeCoverage totals walked metres and visited parks', () => {
  const ways = [
    { id: 'a', name: 'A', coords: [{ lat: 48.85, lng: 2.35 }, { lat: 48.85 + 100 * M_LAT, lng: 2.35 }] },
    { id: 'b', name: 'B', coords: [{ lat: 48.86, lng: 2.36 }, { lat: 48.86 + 100 * M_LAT, lng: 2.36 }] },
  ];
  const pts = [];
  for (let m = 0; m <= 100; m += 10) pts.push({ lat: 48.85 + m * M_LAT, lng: 2.35 });
  const g = new CoverageGrid(pts);
  const c = computeCoverage(ways, [], g);
  assert.ok(Math.abs(c.stats.totalMeters - 200) < 2);
  assert.ok(Math.abs(c.stats.walkedMeters - 100) < 2, `walked ${c.stats.walkedMeters}`);
  assert.equal(c.stats.parks, 0);
});

test('pointsForMode filters by travel setting', () => {
  const pts = [{ mode: 'foot' }, { mode: 'bike' }, { mode: 'vehicle' }, { mode: 'stay' }, { mode: 'unknown' }, {}];
  assert.equal(pointsForMode(pts, 'foot').length, 4);
  assert.equal(pointsForMode(pts, 'bike').length, 5);
  assert.equal(pointsForMode(pts, 'any').length, 6);
});

test('modes come from activity types, else from speed', () => {
  assert.equal(modeFromActivityType('WALKING'), 'foot');
  assert.equal(modeFromActivityType('CYCLING'), 'bike');
  assert.equal(modeFromActivityType('IN_PASSENGER_VEHICLE'), 'vehicle');
  assert.equal(modeFromActivityType(undefined), 'unknown');
  const run = [
    { lat: 48.85, lng: 2.35, t: 0 },
    { lat: 48.85 + 60 * M_LAT, lng: 2.35, t: 60_000 }, // 1 m/s
    { lat: 48.85 + 960 * M_LAT, lng: 2.35, t: 120_000 }, // 15 m/s
  ];
  tagRunBySpeed(run);
  assert.equal(run[0].mode, 'foot');
  assert.equal(run[1].mode, 'vehicle', 'the faster adjacent leg wins');
  assert.equal(run[2].mode, 'vehicle');
});

test('timelinePath points inherit the mode of the activity covering their time', () => {
  const doc = {
    semanticSegments: [
      {
        startTime: '2025-03-01T12:00:00Z',
        endTime: '2025-03-01T12:30:00Z',
        activity: { start: { latLng: '48.85°, 2.35°' }, end: { latLng: '48.86°, 2.36°' }, topCandidate: { type: 'IN_PASSENGER_VEHICLE' } },
      },
      {
        startTime: '2025-03-01T12:00:00Z',
        endTime: '2025-03-01T12:30:00Z',
        timelinePath: [
          { point: '48.851°, 2.351°', time: '2025-03-01T12:05:00Z' },
          { point: '48.852°, 2.352°', time: '2025-03-01T12:06:00Z' },
        ],
      },
      {
        startTime: '2025-03-01T13:00:00Z',
        endTime: '2025-03-01T13:30:00Z',
        timelinePath: [
          { point: '48.860°, 2.360°', time: '2025-03-01T13:00:00Z' },
          { point: '48.8605°, 2.360°', time: '2025-03-01T13:01:00Z' },
        ],
      },
    ],
  };
  const r = parseDocument(doc);
  const path = r.points.filter((p) => p.kind === 'path');
  assert.deepEqual(path.slice(0, 4).map((p) => p.mode), ['vehicle', 'vehicle', 'vehicle', 'vehicle']);
  assert.deepEqual(path.slice(4).map((p) => p.mode), ['foot', 'foot'], 'no activity: ~1 m/s is on foot');
});

test('buildAreaQuery and parseAreaElements', () => {
  const q = buildAreaQuery({ south: 48.85, west: 2.35, north: 48.86, east: 2.36 });
  assert.match(q, /way\["highway"~.*\(48\.850000,2\.350000,48\.860000,2\.360000\);/);
  assert.match(q, /out geom;$/);
  const { ways, areas } = parseAreaElements([
    { type: 'way', id: 1, tags: { highway: 'residential', name: 'Rue A' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1.001, lon: 2 }] },
    { type: 'way', id: 2, tags: { leisure: 'park', name: 'P' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1.001, lon: 2 }, { lat: 1, lon: 2.001 }, { lat: 1, lon: 2 }] },
    { type: 'relation', id: 3, tags: { leisure: 'park', type: 'multipolygon' }, members: [
      { type: 'way', role: 'outer', geometry: [{ lat: 1, lon: 2 }, { lat: 1.001, lon: 2 }, { lat: 1, lon: 2.001 }] },
      { type: 'way', role: 'inner', geometry: [{ lat: 1, lon: 2 }] },
    ] },
    { type: 'node', id: 4, lat: 1, lon: 2, tags: {} },
  ]);
  assert.equal(ways.length, 1);
  assert.equal(ways[0].coords[1].lng, 2);
  assert.equal(areas.length, 2);
  assert.equal(areas[1].rings.length, 1, 'inner rings are ignored');
});
