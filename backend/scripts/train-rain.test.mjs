import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeRainExamples, trainRainModel } from './train-rain.mjs';

const minute = 60000;
const start = Date.parse('2026-11-01T00:00:00.000Z');
const at = (n) => new Date(start + n * minute).toISOString();
const deviceId = 'RAIN-OFFLINE-FIXTURE';
const event = (id, observed, received) => ({
  id, eventId: id, deviceId, timestamp: at(observed), createdAt: at(received),
  tipCount: 5, calibrationFactor: 0.64, rainfallMm: 3.2, timingQuality: 'device_tip'
});
const payload = {
  source: 'postgresql', demo: false, historyTruncated: false, deviceId, tests: [],
  measurements: Array.from({ length: 1501 }, (_, i) => ({
    id: String(i), messageId: String(i), deviceId, timestamp: at(i), createdAt: at(i), pressure: 1010
  })),
  events: [event('delayed', 1435, 1441), event('target', 1450, 1450)]
};

test('training features use only records available at decision time and reject test targets', () => {
  const { examples } = makeRainExamples(payload);
  assert.equal(examples.length, 1);
  assert.equal(examples[0].rain[0], 0);
  assert.equal(examples[0].baseline, 0);
  assert.equal(examples[0].target, 3.2);
  const tests = [{ id: 'test', deviceId, from: at(1455), to: at(1460) }];
  assert.equal(makeRainExamples({ ...payload, tests }).examples.length, 0);
});

test('short history does not produce an evaluated artifact', () => {
  const report = trainRainModel(payload);
  assert.equal(report.evaluated, false);
  assert.equal(report.coverage.usable, 1);
  assert.throws(() => makeRainExamples({ ...payload, demo: true }), /dữ liệu thực/);
});
