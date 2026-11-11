import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { dataStore } from '../db/store';
import { env } from '../config/env';
import { buildRainMonitor, demoRainMonitor, RainMonitorService } from '../services/rain-monitor.service';
import { availableAt, MINUTE, rainWindow } from '../services/rain-observations';
import type { RainObservations } from '../services/rain-observations';
import type { RainAlertEvidence } from '../shared/rain-monitor';
import type { RainEventRecord } from '../shared/types/rain';
import { apiRouter } from '../routes/api';
import { rainModelSchema } from '../services/rain-model';

const at = new Date('2026-11-09T07:00:00.000Z');
const iso = (minutes: number) => new Date(at.getTime() + minutes * MINUTE).toISOString();
const deviceId = 'RAIN-MONITOR-TEST';
const measurements = Array.from({ length: 181 }, (_, minutes) => ({
  id: `m${minutes}`, deviceId, messageId: `m${minutes}`, timestamp: iso(-minutes), createdAt: iso(-minutes),
  temperature: 25, humidity: 95, pressure: 1009.6 + minutes * 0.01, wifiRssi: -50, uptime: 0
}));
const input: RainObservations = { deviceId, measurements, events: [], tests: [], maxGapMs: 2 * MINUTE };
const event = (at: number, tips: number, calibrationFactor: number, id: string): RainEventRecord => ({
  id, deviceId, eventId: id, timestamp: iso(at), createdAt: iso(at), timingQuality: 'device_tip',
  tipCount: tips, calibrationFactor, rainfallMm: tips * calibrationFactor
});

describe('Rain monitoring and 60-minute estimate', () => {
  it('exposes rain monitoring and the training series through the API without chatbot routes', async (t) => {
    await dataStore.upsertDevice({ deviceId, name: deviceId });
    const app = express();
    app.use('/api', apiRouter);
    const server = app.listen(0, '127.0.0.1');
    t.after(() => { server.close(); });
    await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
    const from = new Date(Date.now() - MINUTE).toISOString();
    const [demo, series, chat, context] = await Promise.all([
      fetch(`${base}/devices/${deviceId}/rain-monitor?demo=1`),
      fetch(`${base}/ai/series?deviceId=${deviceId}&from=${encodeURIComponent(from)}`),
      fetch(`${base}/ai/chat`, { method: 'POST' }),
      fetch(`${base}/ai/context`)
    ]);
    assert.equal(demo.status, 200);
    assert.equal((await demo.json()).data.forecast.estimatedRainMm, 12.8);
    assert.equal(series.status, 200);
    assert.equal((await series.json()).data.deviceId, deviceId);
    assert.equal(chat.status, 404);
    assert.equal(context.status, 404);
    await Promise.all([chat.arrayBuffer(), context.arrayBuffer()]);
  });

  it('loads Ridge artifacts only when both holdout splits beat the persistence estimate', () => {
    const score = { count: 60, wetCount: 25, storms: 1, maeMm: 2, wetMaeMm: 4 };
    const split = { baseline: score, rain: { ...score, maeMm: 1, wetMaeMm: 2 }, rainPressure: score };
    const model = {
      kind: 'rainsense-rain-ridge', evaluated: true, horizonMinutes: 60, deviceId, modelVersion: 'test-v1',
      trainedFrom: iso(-60), trainedTo: iso(0), features: 'rain',
      mean: [0, 0, 0, 0], scale: [1, 1, 1, 1], weights: [0, 0, 0, 0, 0]
    };
    assert.equal(rainModelSchema.safeParse(model).success, false);
    assert.equal(rainModelSchema.safeParse({ ...model, metrics: { validation: split, test: split } }).success, true);
    assert.equal(rainModelSchema.safeParse({
      ...model, metrics: { validation: split, test: { ...split, rain: { ...score, maeMm: 1 } } }
    }).success, false);
  });

  it('reproduces the documented demo with separate measured and estimated values', () => {
    const demo = demoRainMonitor(deviceId);
    assert.equal(demo.demo, true);
    assert.equal(demo.observation.alert?.source, 'simulation');
    assert.equal(demo.observation.alert?.value, 16);
    assert.equal(demo.observation.alert?.threshold, 15);
    assert.equal(demo.observation.alert?.unit, 'mm');
    assert.deepEqual(demo.observation.thresholds, [{
      ruleId: 'demo-60m', windowMinutes: 60, unit: 'mm', threshold: 15, value: 16, quality: 'complete'
    }]);
    assert.equal(demo.pressure.delta3hHpa, -1.8);
    assert.equal(demo.forecast.estimatedRainMm, 12.8);
    assert.equal(demo.forecast.status, 'experimental');
    assert.equal(Date.parse(demo.forecast.validTo) - Date.parse(demo.forecast.validFrom), 60 * MINUTE);
  });

  it('adapts rain monitoring and alerts dynamically across low, moderate, and critical demo scenarios', () => {
    const low = demoRainMonitor(deviceId, 'Asia/Ho_Chi_Minh', 'low');
    assert.equal(low.observation.status, 'dry');
    assert.equal(low.observation.alert, null);
    assert.equal(low.windows.find((w) => w.minutes === 60)?.rainfallMm, 0);
    assert.equal(low.forecast.status, 'dry_baseline');

    const moderate = demoRainMonitor(deviceId, 'Asia/Ho_Chi_Minh', 'moderate');
    assert.equal(moderate.observation.status, 'rain');
    assert.equal(moderate.observation.alert, null);
    assert.equal(moderate.windows.find((w) => w.minutes === 60)?.rainfallMm, 5.12);
    assert.equal(moderate.forecast.estimatedRainMm, 5.12);

    const critical = demoRainMonitor(deviceId, 'Asia/Ho_Chi_Minh', 'critical');
    assert.equal(critical.observation.status, 'heavy');
    assert.equal(critical.observation.alert?.severity, 'CRITICAL');
    assert.equal(critical.observation.alert?.value, 48);
    assert.equal(critical.windows.find((w) => w.minutes === 60)?.rainfallMm, 48);
  });

  it('distinguishes dry observations, outages, water tests without tips and simulation', () => {
    const dry = buildRainMonitor(input, [], at, 'UTC');
    assert.equal(dry.observation.status, 'dry');
    assert.equal(dry.pressure.delta3hHpa, -1.8);
    assert.equal(dry.forecast.status, 'dry_baseline');
    assert.equal(dry.forecast.estimatedRainMm, null);
    assert.equal(dry.observation.alert, null);
    const missing = buildRainMonitor({ ...input, measurements: measurements.slice(0, 3) }, [], at, 'UTC');
    assert.equal(missing.windows.find((window) => window.minutes === 15)?.rainfallMm, null);
    assert.equal(missing.forecast.status, 'insufficient');
    const testing = { id: 'test', deviceId, from: iso(-8), to: iso(-3), note: '', createdBy: 'operator', createdAt: iso(-8) };
    assert.equal(rainWindow({ ...input, tests: [testing] }, 15, at.getTime()).quality, 'test_water');
    const simulated = [{ ...measurements[0], messageId: 'sim-tel-1' }, ...measurements.slice(1)];
    assert.equal(rainWindow({ ...input, measurements: simulated }, 15, at.getTime()).quality, 'simulation');
    const mirrored = [{ ...measurements[0], messageId: 'other-station-def' }, ...measurements.slice(1)];
    assert.equal(rainWindow({ ...input, measurements: mirrored }, 15, at.getTime()).quality, 'mixed_station');

    // Simulator events from previous demo runs do not contaminate live hardware rainfall with test_water
    const demoEvent: RainEventRecord = { ...event(-10, 5, 0.64, 'sim-demo'), dataKind: 'test', testNote: 'Dữ liệu giả lập' };
    const realEvent: RainEventRecord = event(-5, 10, 0.64, 'real-tip');
    const windowWithSim = rainWindow({ ...input, events: [demoEvent, realEvent] }, 15, at.getTime());
    assert.equal(windowWithSim.quality, 'complete');
    assert.equal(windowWithSim.rainfallMm, 6.4);
  });

  it('keeps half-open boundaries and calibration, including a counter batch at a boundary', () => {
    const events = [event(-60, 2, 0.64, 'first'), event(-1, 1, 0.25, 'second'), event(0, 3, 0.64, 'next')];
    const hour = rainWindow({ ...input, events }, 60, at.getTime());
    assert.equal(hour.rainfallMm, 1.53);
    const batch: RainEventRecord = { ...events[2], intervalFrom: iso(-2), timingQuality: 'telemetry_interval' };
    assert.equal(rainWindow({ ...input, events: [...events.slice(0, 2), batch] }, 60, at.getTime()).quality, 'uncertain_tips');
    assert.equal(rainWindow({ ...input, events: [{ ...batch, timestamp: iso(-1), intervalFrom: iso(-61) }] }, 60, at.getTime()).quality, 'uncertain_tips');
    assert.equal(availableAt({ ...events[0], createdAt: iso(1) }, at.getTime()), false);
  });

  it('preserves a measured warning and estimate when pressure is absent', () => {
    const { observation, forecast, pressure } = buildRainMonitor({
      ...input, measurements: measurements.map((row) => ({ ...row, pressure: -999 })),
      events: [event(-45, 20, 0.64, 'early'), event(-6, 5, 0.64, 'late')]
    }, [{
      id: 'rule', deviceId, alertType: 'RAIN_ACCUMULATION', comparison: 'GREATER_THAN',
      threshold: 15, enabled: true, severity: 'WARNING', createdAt: iso(-60), updatedAt: iso(-60)
    }], at, 'UTC');
    assert.equal(observation.status, 'heavy');
    assert.equal(pressure.hpa, null);
    assert.equal(pressure.delta3hHpa, null);
    assert.equal(forecast.estimatedRainMm, 12.8);
  });

  it('shows the enabled station thresholds with separate units and preserves unavailable readings', () => {
    const common = {
      deviceId, comparison: 'GREATER_THAN', severity: 'WARNING', enabled: true,
      createdAt: iso(-60), updatedAt: iso(-60)
    } as const;
    const { observation } = buildRainMonitor({
      ...input, measurements: measurements.slice(0, 20)
    }, [
      { ...common, id: 'rate', alertType: 'HEAVY_RAIN', threshold: 15 },
      { ...common, id: 'hour', alertType: 'RAIN_ACCUMULATION', threshold: 10 },
      { ...common, id: 'disabled', alertType: 'RAIN_ACCUMULATION', threshold: 30, enabled: false }
    ], at, 'UTC');
    assert.equal(observation.status, 'insufficient');
    assert.equal(observation.alert, null);
    assert.deepEqual(observation.thresholds, [
      { ruleId: 'rate', windowMinutes: 5, unit: 'mm/h', threshold: 15, value: 0, quality: 'complete' },
      { ruleId: 'hour', windowMinutes: 60, unit: 'mm', threshold: 10, value: null, quality: 'missing_telemetry' }
    ]);
  });

  it('persists one alert for a threshold crossing, raises severity once and rearms after dry data', async () => {
    const station = 'RAIN-STATE-TEST';
    const evidence: RainAlertEvidence = { ...demoRainMonitor(station).observation.alert!, source: 'observed' };
    const first = await Promise.all([
      dataStore.recordRainAlert(station, 2, iso(0), evidence),
      dataStore.recordRainAlert(station, 2, iso(0), evidence)
    ]);
    assert.equal(first.filter(Boolean).length, 1);
    assert.equal(await dataStore.recordRainAlert(station, null, iso(5), null), null);
    assert.equal(await dataStore.recordRainAlert(station, 2, iso(10), evidence), null);
    assert.ok(await dataStore.recordRainAlert(station, 3, iso(15), { ...evidence, severity: 'CRITICAL' }));
    assert.equal(await dataStore.recordRainAlert(station, 0, iso(12), null), null);
    assert.equal(await dataStore.recordRainAlert(station, 3, iso(20), evidence), null);
    await dataStore.recordRainAlert(station, 0, iso(60), null);
    assert.ok(await dataStore.recordRainAlert(station, 2, iso(65), evidence));
    const history = await dataStore.getAlerts({ deviceId: station });
    assert.equal(history.length, 3);
    assert.equal(history[0].rainEvidence?.ruleVersion, evidence.ruleVersion);
  });

  it('serves the demo fixture without persisting a demo alert', async () => {
    await dataStore.upsertDevice({ deviceId, name: deviceId });
    const previous = env.DEMO_MODE;
    try {
      env.DEMO_MODE = true;
      const service = new RainMonitorService();
      const snapshot = await service.getSnapshot(deviceId);
      assert.deepEqual(snapshot, demoRainMonitor(deviceId));
      await service.evaluateStations();
      assert.deepEqual(await dataStore.getAlerts({ deviceId }), []);
    } finally {
      env.DEMO_MODE = previous;
    }
  });
});
