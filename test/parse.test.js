import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLatLng, detectFormat, parseDocument, parseDocuments, WEIGHTS } from '../js/parse.js';

test('parseLatLng handles every encoding Google uses', () => {
  assert.deepEqual(parseLatLng('48.8566°, 2.3522°'), { lat: 48.8566, lng: 2.3522 });
  assert.deepEqual(parseLatLng('geo:48.8566,2.3522'), { lat: 48.8566, lng: 2.3522 });
  assert.deepEqual(parseLatLng({ latLng: '-33.8688°, 151.2093°' }), { lat: -33.8688, lng: 151.2093 });
  assert.deepEqual(parseLatLng({ LatLng: '51.5°, -0.12°' }), { lat: 51.5, lng: -0.12 });
  assert.deepEqual(parseLatLng({ latitudeE7: 488566000, longitudeE7: 23522000 }), { lat: 48.8566, lng: 2.3522 });
  assert.deepEqual(parseLatLng({ latE7: 488566000, lngE7: 23522000 }), { lat: 48.8566, lng: 2.3522 });
  assert.equal(parseLatLng('0°, 0°'), null);
  assert.equal(parseLatLng('not a coordinate'), null);
  assert.equal(parseLatLng(null), null);
});

test('detects the on-device Android format and weights visits by duration', () => {
  const doc = {
    semanticSegments: [
      {
        startTime: '2025-03-01T09:00:00.000+01:00',
        endTime: '2025-03-01T12:00:00.000+01:00',
        visit: { topCandidate: { placeLocation: { latLng: '48.85°, 2.35°' }, semanticType: 'WORK', placeId: 'abc' } },
      },
      {
        startTime: '2025-03-01T12:00:00.000+01:00',
        endTime: '2025-03-01T12:30:00.000+01:00',
        activity: { start: { latLng: '48.85°, 2.35°' }, end: { latLng: '48.86°, 2.36°' }, topCandidate: { type: 'WALKING' } },
      },
      {
        startTime: '2025-03-01T12:00:00.000+01:00',
        endTime: '2025-03-01T12:30:00.000+01:00',
        timelinePath: [
          { point: '48.851°, 2.351°', time: '2025-03-01T12:05:00.000+01:00' },
          { point: '48.855°, 2.355°', time: '2025-03-01T12:15:00.000+01:00' },
        ],
      },
    ],
    rawSignals: [
      { position: { LatLng: '48.852°, 2.352°', accuracyMeters: 12, timestamp: '2025-03-01T12:07:00.000+01:00' } },
      { position: { LatLng: '48.852°, 2.352°', accuracyMeters: 900, timestamp: '2025-03-01T12:08:00.000+01:00' } },
      { activityRecord: {} },
    ],
  };
  assert.equal(detectFormat(doc), 'ondevice-android');
  const r = parseDocument(doc);
  assert.equal(r.visits.length, 1);
  assert.equal(r.visits[0].hours, 3);
  assert.equal(r.visits[0].label, 'WORK');
  const visitPt = r.points.find((p) => p.kind === 'visit');
  assert.equal(visitPt.w, 3 * WEIGHTS.visitPerHour);
  assert.equal(r.points.filter((p) => p.kind === 'path').length, 4);
  assert.equal(r.points.filter((p) => p.kind === 'raw').length, 1, 'coarse raw fix is dropped');
});

test('parses the on-device iOS array format with geo: strings and minute offsets', () => {
  const doc = [
    {
      startTime: '2025-01-05T10:00:00Z',
      endTime: '2025-01-05T10:10:00Z',
      visit: { topCandidate: { placeLocation: 'geo:40.7128,-74.0060', semanticType: 'UNKNOWN' } },
    },
    {
      startTime: '2025-01-05T10:10:00Z',
      endTime: '2025-01-05T10:40:00Z',
      timelinePath: [{ point: 'geo:40.713,-74.007', durationMinutesOffsetFromStartTime: '5' }],
    },
  ];
  assert.equal(detectFormat(doc), 'ondevice-ios');
  const r = parseDocument(doc);
  assert.equal(r.visits.length, 1);
  assert.equal(r.visits[0].label, null);
  assert.equal(r.visits[0].hours, 10 / 60);
  const path = r.points.find((p) => p.kind === 'path');
  assert.equal(path.t, Date.parse('2025-01-05T10:15:00Z'));
  const visit = r.points.find((p) => p.kind === 'visit');
  assert.equal(visit.w, WEIGHTS.visitMinHours, 'short visits are floored');
});

test('parses legacy Takeout Records.json and Semantic Location History', () => {
  const records = {
    locations: [
      { latitudeE7: 488566000, longitudeE7: 23522000, timestamp: '2019-06-01T08:00:00Z', accuracy: 20 },
      { latitudeE7: 488566000, longitudeE7: 23522000, timestampMs: '1559376000000', accuracy: 1500 },
    ],
  };
  assert.equal(detectFormat(records), 'takeout-records');
  assert.equal(parseDocument(records).points.length, 1);

  const semantic = {
    timelineObjects: [
      {
        placeVisit: {
          location: { latitudeE7: 488566000, longitudeE7: 23522000, name: 'Louvre', placeId: 'x' },
          duration: { startTimestamp: '2019-06-01T10:00:00Z', endTimestamp: '2019-06-01T22:00:00Z' },
        },
      },
      {
        activitySegment: {
          startLocation: { latitudeE7: 488566000, longitudeE7: 23522000 },
          endLocation: { latitudeE7: 488600000, longitudeE7: 23600000 },
          duration: { startTimestamp: '2019-06-01T22:00:00Z', endTimestamp: '2019-06-01T22:30:00Z' },
          waypointPath: { waypoints: [{ latE7: 488580000, lngE7: 23550000 }] },
          simplifiedRawPath: { points: [{ latE7: 488590000, lngE7: 23580000, timestampMs: '1559428500000' }] },
        },
      },
    ],
  };
  assert.equal(detectFormat(semantic), 'takeout-semantic');
  const r = parseDocument(semantic);
  assert.equal(r.visits[0].label, 'Louvre');
  assert.equal(r.points.find((p) => p.kind === 'visit').w, WEIGHTS.visitMaxHours, 'long visits are capped');
  assert.equal(r.points.filter((p) => p.kind === 'path').length, 4);
});

test('parseDocuments merges files and reports metadata', () => {
  const a = { locations: [{ latitudeE7: 10000000, longitudeE7: 10000000, timestamp: '2020-01-01T00:00:00Z' }] };
  const b = { locations: [{ latitudeE7: 10000000, longitudeE7: 10000000, timestamp: '2021-01-01T00:00:00Z' }] };
  const r = parseDocuments([a, b, { junk: true }]);
  assert.equal(r.meta.total, 2);
  assert.equal(r.meta.formats['takeout-records'], 2);
  assert.equal(r.meta.formats.unknown, 1);
  assert.equal(r.meta.firstTime, Date.parse('2020-01-01T00:00:00Z'));
  assert.equal(r.meta.lastTime, Date.parse('2021-01-01T00:00:00Z'));
});
