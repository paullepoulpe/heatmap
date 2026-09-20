import { test } from 'node:test';
import assert from 'node:assert/strict';
import { haversine, SpatialIndex, classify, scorePlaces, aggregateForHeat } from '../js/score.js';

test('haversine is accurate for a known pair', () => {
  // Paris -> London, about 343.5 km
  const d = haversine(48.8566, 2.3522, 51.5074, -0.1278);
  assert.ok(Math.abs(d - 343_500) < 1500, `got ${d}`);
  assert.equal(haversine(1, 1, 1, 1), 0);
});

test('SpatialIndex.within finds points across cell borders and respects radius', () => {
  const pts = [];
  for (let i = 0; i < 50; i++) pts.push({ lat: 48.85 + i * 0.001, lng: 2.35, w: 1 });
  const idx = new SpatialIndex(pts);
  const near = idx.within(48.85 + 0.0105, 2.35, 300);
  // 0.001 deg lat is ~111 m, so 300 m either side covers offsets 8..13 (6 points).
  assert.equal(near.length, 6);
  for (const { d } of near) assert.ok(d <= 300);
  assert.equal(idx.within(0, 0, 1000).length, 0);
});

test('familiarity is high where you spent time and near-zero elsewhere', () => {
  const idx = new SpatialIndex([
    { lat: 48.85, lng: 2.35, w: 4 }, // four hours here
    { lat: 48.86, lng: 2.36, w: 0.05 }, // one breadcrumb ~1.3 km away
  ]);
  const here = idx.familiarity(48.85, 2.35);
  assert.ok(Math.abs(here - 4) < 1e-9);
  const twoHundredMetres = idx.familiarity(48.85 + 200 / 111320, 2.35);
  assert.ok(twoHundredMetres > 0.5 && twoHundredMetres < 4);
  assert.equal(idx.familiarity(48.87, 2.30), 0);
  assert.equal(classify(here), 'familiar');
  assert.equal(classify(0), 'unexplored');
  assert.equal(classify(0.3), 'passed');
});

test('hotspot picks the heaviest cell and coverage counts touched cells', () => {
  const pts = [
    { lat: 48.85, lng: 2.35, w: 1 },
    { lat: 48.85, lng: 2.35, w: 1 },
    { lat: 48.9, lng: 2.4, w: 1.5 },
  ];
  const idx = new SpatialIndex(pts);
  const hot = idx.hotspot();
  assert.ok(Math.abs(hot.lat - 48.85) < 1e-9 && Math.abs(hot.lng - 2.35) < 1e-9);
  assert.equal(hot.weight, 2);
  const cov = idx.coverage(48.85, 2.35, 1000);
  assert.ok(cov > 0 && cov < 0.1, `coverage ${cov}`);
});

test('scorePlaces attaches distance, familiarity and level', () => {
  const idx = new SpatialIndex([{ lat: 48.85, lng: 2.35, w: 2 }]);
  const center = { lat: 48.85, lng: 2.35 };
  const [a, b] = scorePlaces(
    [
      { id: 'a', name: 'Home cafe', lat: 48.8501, lng: 2.3501 },
      { id: 'b', name: 'Far park', lat: 48.87, lng: 2.38 },
    ],
    idx,
    center,
  );
  assert.equal(a.level, 'familiar');
  assert.equal(b.level, 'unexplored');
  assert.ok(a.distance < b.distance);
});

test('aggregateForHeat merges nearby points and keeps total weight', () => {
  const pts = [];
  for (let i = 0; i < 100; i++) pts.push({ lat: 48.85 + (i % 2) * 0.00001, lng: 2.35, w: 0.5 });
  const agg = aggregateForHeat(pts);
  assert.ok(agg.length <= 2);
  const total = agg.reduce((s, p) => s + p.w, 0);
  assert.ok(Math.abs(total - 50) < 1e-9);
});
