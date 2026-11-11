import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateWeatherFeatures, describePressureTrend } from '../services/ai-weather-features';
import { classifyPressureTrend } from '../shared/utils/weather-calc';
import { recordReadSource, withReadDiagnostics } from '../db/read-diagnostics';
import { dataStore } from '../db/store';
import { summarizeRainWindow } from '../services/ai-rain-history';
import type { MeasurementRecord } from '../shared/types/telemetry';

const now = new Date('2026-11-02T05:15:00Z');
const from = new Date(now.getTime() - 3 * 3600000);
const measurement = (timestamp: string, pressure: number): MeasurementRecord => ({ id: timestamp, deviceId: 'TEST', messageId: timestamp,
  timestamp, temperature: 29, humidity: 80, pressure, wifiRssi: -50, uptime: 5, createdAt: timestamp });
const continuous = Array.from({ length: 181 }, (_, i) => measurement(new Date(from.getTime() + i * 60000).toISOString(), 1010 - i / 60));
describe('Environmental evidence and provenance', () => {
  it('includes an event exactly at the live cutoff without double-counting historical clock boundaries', () => {
    const e = { id: 'boundary', deviceId: 'TEST', eventId: 'boundary', timestamp: now.toISOString(), tipCount: 1, calibrationFactor: 0.64, rainfallMm: 0.64, createdAt: now.toISOString() };
    assert.equal(summarizeRainWindow([e], [], from, now, 'clock').tips, 0);
    assert.equal(summarizeRainWindow([e], [], from, now, 'rolling', 120000, true).tips, 1);
  });
  it('uses a full three-hour chain and refuses to infer a trend across an outage', () => {
    const f = calculateWeatherFeatures(continuous, from, now, 120000);
    assert.equal(f.pressureDelta3hHpa, -3);
    assert.equal(f.coverageComplete, true);
    assert.match(describePressureTrend(f), /Giảm nhanh/);
    assert.doesNotMatch(describePressureTrend(f), /Bão/);
    const partial = calculateWeatherFeatures([continuous[0], continuous.at(-1)!], from, now, 120000);
    assert.equal(partial.pressureDelta3hHpa, null);
    assert.equal(partial.coverageComplete, false);
    assert.match(describePressureTrend(partial), /Chưa đủ/);
    assert.equal(classifyPressureTrend(1010).category, 'UNKNOWN');
  });
  it('rejects invalid sensor readings and excludes future values', () => {
    const f = calculateWeatherFeatures([...continuous, { ...continuous[0], humidity: 150 }, measurement(new Date(now.getTime() + 60000).toISOString(), 900)], from, now, 120000);
    assert.equal(f.invalidSampleCount, 1);
    assert.equal(f.sampleCount, continuous.length);
    assert.equal(f.pressure?.min, 1007);
  });
  it('keeps concurrent source diagnostics isolated', async () => {
    const [a, b] = await Promise.all([
      withReadDiagnostics(async () => { recordReadSource('postgresql'); await Promise.resolve(); recordReadSource('memory'); return 1; }),
      withReadDiagnostics(async () => { await Promise.resolve(); recordReadSource('postgresql'); return 2; })
    ]);
    assert.equal(a.source, 'mixed');
    assert.equal(b.source, 'postgresql');
  });
  it('uses measurement time when messages arrive out of order and labels RAM history', async () => {
    const id = 'AI-ORDERED-SAMPLES';
    const latest = new Date(Date.now() - 30000).toISOString();
    const older = new Date(Date.now() - 3600000).toISOString();
    await dataStore.upsertDevice({ deviceId: id, name: 'Order test', rainMmPerTip: 0.64 });
    for (const [timestamp, temperature] of [[latest, 31], [older, 20]] as const) {
      await dataStore.saveMeasurement({ deviceId: id, messageId: `${id}-${timestamp}`, timestamp, temperature, humidity: 75, pressure: 1008, wifiRssi: -50, uptime: 1 });
    }
    const result = await dataStore.getLatestMeasurement(id);
    assert.equal(result?.timestamp, latest);
    assert.equal(result?.temperature, 31);
  });
});
