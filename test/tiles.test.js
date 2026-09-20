import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lngToX, latToY, tileBounds, tilesForBox, countTilesForBox } from '../js/tiles.js';

test('tile maths round-trips Paris at zoom 14', () => {
  const x = lngToX(2.3522, 14);
  const y = latToY(48.8566, 14);
  assert.equal(x, 8299);
  assert.equal(y, 5636);
  const b = tileBounds(x, y, 14);
  assert.ok(b.west <= 2.3522 && 2.3522 < b.east);
  assert.ok(b.south <= 48.8566 && 48.8566 < b.north);
  assert.ok(b.north > b.south && b.east > b.west);
});

test('tilesForBox covers a box completely and only once', () => {
  const box = { south: 48.85, west: 2.34, north: 48.87, east: 2.37 };
  const tiles = tilesForBox(box, 14);
  assert.ok(tiles.length >= 2 && tiles.length <= 6, `got ${tiles.length}`);
  const keys = new Set(tiles.map((t) => t.key));
  assert.equal(keys.size, tiles.length);
  const west = Math.min(...tiles.map((t) => t.bounds.west));
  const east = Math.max(...tiles.map((t) => t.bounds.east));
  const south = Math.min(...tiles.map((t) => t.bounds.south));
  const north = Math.max(...tiles.map((t) => t.bounds.north));
  assert.ok(west <= box.west && east >= box.east && south <= box.south && north >= box.north);
});

test('countTilesForBox matches the enumeration and survives a world view', () => {
  const box = { south: 48.85, west: 2.34, north: 48.87, east: 2.37 };
  assert.equal(countTilesForBox(box, 14), tilesForBox(box, 14).length);
  const world = { south: -89, west: -200, north: 89, east: 200 }; // Leaflet can report beyond the map edge
  assert.equal(countTilesForBox(world, 13), 8192 * 8192);
  assert.equal(countTilesForBox(world, 0), 1);
  assert.equal(latToY(90, 5), 0);
  assert.equal(latToY(-90, 5), 31);
});
