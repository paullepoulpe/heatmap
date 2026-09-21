import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampLat, wrapLng, coordPair, formatCoords, detectPlatform, navigationLinks } from '../js/navigate.js';

test('coordinates are clamped, wrapped and fixed-width', () => {
  assert.equal(clampLat(95), 90);
  assert.equal(clampLat(-95), -90);
  assert.equal(wrapLng(190), -170);
  assert.equal(wrapLng(-190), 170);
  assert.equal(wrapLng(2.3522), 2.3522);
  assert.equal(coordPair(48.8566, 2.3522), '48.856600,2.352200');
  assert.equal(coordPair(-33.8688, 151.2093), '-33.868800,151.209300');
  assert.equal(coordPair(48.8566, 542.3522), '48.856600,-177.647800', 'a lng past the date line wraps');
  assert.doesNotMatch(coordPair(0.0000001, 0.0000001), /e/, 'never scientific notation');
  assert.equal(formatCoords(48.856612, 2.352243), '48.85661°, 2.35224°');
});

test('platform detection picks the right native map app', () => {
  assert.equal(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', 5), 'ios');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 5), 'ios', 'iPadOS claims to be a Mac but has touch');
  assert.equal(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0), 'mac');
  assert.equal(detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'Linux armv8l', 5), 'android');
  assert.equal(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 0), 'other');
});

test('navigationLinks always offers Google Maps and adds the native app per platform', () => {
  const other = navigationLinks(48.8566, 2.3522, 'other');
  assert.deepEqual(other.map((l) => l.id), ['walk', 'gmaps']);
  assert.equal(other[0].href, 'https://www.google.com/maps/dir/?api=1&destination=48.856600,2.352200&travelmode=walking');
  assert.equal(other[1].href, 'https://www.google.com/maps/search/?api=1&query=48.856600,2.352200');
  assert.ok(other.every((l) => l.external));

  const ios = navigationLinks(48.8566, 2.3522, 'ios');
  assert.deepEqual(ios.map((l) => l.id), ['walk', 'gmaps', 'apple']);
  assert.match(ios[2].href, /^https:\/\/maps\.apple\.com\/\?ll=48\.856600,2\.352200/);

  const android = navigationLinks(48.8566, 2.3522, 'android');
  assert.deepEqual(android.map((l) => l.id), ['walk', 'gmaps', 'geo']);
  assert.equal(android[2].href, 'geo:48.856600,2.352200?q=48.856600,2.352200');
  assert.equal(android[2].external, false, 'custom schemes must not open in a new tab');

  assert.deepEqual(navigationLinks(0, 0, 'mac').map((l) => l.id), ['walk', 'gmaps', 'apple']);
});
