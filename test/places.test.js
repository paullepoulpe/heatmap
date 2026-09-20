import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, elementToPlace, dedupePlaces, fetchPlaces, categoryFor } from '../js/places.js';

test('buildQuery emits one around() clause per rule of each selected category', () => {
  const q = buildQuery({ lat: 48.8566, lng: 2.3522, radius: 1500.4, categories: ['food', 'nature'] });
  assert.match(q, /^\[out:json\]\[timeout:30\];/);
  assert.match(q, /nwr\["amenity"~"\^\(cafe\|restaurant.*\)\$"\]\["name"\]\(around:1500,48\.856600,2\.352200\);/);
  assert.match(q, /nwr\["leisure"~/);
  assert.doesNotMatch(q, /"shop"/);
  assert.match(q, /out center tags;$/);
});

test('elementToPlace uses node coords or way centre and classifies tags', () => {
  const node = elementToPlace({ type: 'node', id: 1, lat: 1, lon: 2, tags: { amenity: 'cafe', name: 'A' } });
  assert.equal(node.category, 'food');
  assert.equal(node.kind, 'cafe');
  assert.equal(node.osmUrl, 'https://www.openstreetmap.org/node/1');
  const way = elementToPlace({ type: 'way', id: 2, center: { lat: 3, lon: 4 }, tags: { leisure: 'park', name: 'B' } });
  assert.equal(way.lat, 3);
  assert.equal(way.category, 'nature');
  assert.equal(elementToPlace({ type: 'relation', id: 3, tags: { name: 'no geometry' } }), null);
  assert.equal(categoryFor({ historic: 'castle' }), 'culture');
  assert.equal(categoryFor({ office: 'company' }), 'other');
});

test('dedupePlaces drops same-name copies within a few metres only', () => {
  const places = [
    { id: 'n/1', name: 'Louvre', lat: 48.861, lng: 2.336 },
    { id: 'w/2', name: 'Louvre', lat: 48.8611, lng: 2.3361 },
    { id: 'n/3', name: 'Louvre', lat: 48.9, lng: 2.4 },
    { id: 'n/4', name: 'Other', lat: 48.861, lng: 2.336 },
  ];
  assert.deepEqual(dedupePlaces(places).map((p) => p.id), ['n/1', 'n/3', 'n/4']);
});

test('fetchPlaces falls back to the next endpoint on failure', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push(url);
    assert.equal(opts.method, 'POST');
    if (calls.length === 1) return { ok: false, status: 504 };
    return { ok: true, json: async () => ({ elements: [{ type: 'node', id: 9, lat: 1, lon: 1, tags: { amenity: 'bar', name: 'Z' } }] }) };
  };
  const places = await fetchPlaces(
    { lat: 1, lng: 1, radius: 500, categories: ['food'] },
    { fetchImpl, endpoints: ['https://a/', 'https://b/'] },
  );
  assert.deepEqual(calls, ['https://a/', 'https://b/']);
  assert.equal(places.length, 1);
  assert.equal(places[0].name, 'Z');
});

test('fetchPlaces surfaces the last error when every endpoint fails', async () => {
  const fetchImpl = async () => {
    throw new Error('offline');
  };
  await assert.rejects(
    fetchPlaces({ lat: 1, lng: 1, radius: 500, categories: ['food'] }, { fetchImpl, endpoints: ['https://a/'] }),
    /offline/,
  );
});
