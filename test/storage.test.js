import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeHistory, decodeHistory } from '../js/storage.js';

test('history round-trips through the packed form', () => {
  const data = {
    points: [
      { lat: 48.85, lng: 2.35, w: 1.5, t: 1700000000000, kind: 'visit', mode: 'stay' },
      { lat: 48.86, lng: 2.36, w: 0.05, t: NaN, kind: 'path', mode: 'bike' },
      { lat: -33.9, lng: 151.2, w: 0.02, t: 1700000060000, kind: 'raw' },
    ],
    visits: [{ lat: 48.85, lng: 2.35, hours: 1.5, label: 'HOME' }],
    meta: { total: 3, counts: { visit: 1, path: 1, raw: 1 }, firstTime: 1700000000000, lastTime: 1700000060000, formats: {} },
  };
  const rec = encodeHistory(data, { demo: true });
  assert.equal(rec.n, 3);
  assert.ok(rec.lat instanceof Float64Array);
  const back = decodeHistory(rec);
  assert.equal(back.points.length, 3);
  assert.deepEqual(back.points[0], data.points[0]);
  assert.equal(back.points[1].mode, 'bike');
  assert.ok(Number.isNaN(back.points[1].t));
  assert.equal(back.points[2].mode, 'unknown', 'missing mode decodes as unknown');
  assert.ok(Math.abs(back.points[2].w - 0.02) < 1e-6, 'weights survive as float32');
  assert.deepEqual(back.visits, data.visits);
  assert.deepEqual(back.meta, data.meta);
  assert.equal(back.demo, true);
  assert.equal(decodeHistory(null), null);
  assert.equal(decodeHistory({ version: 99 }), null);
});
