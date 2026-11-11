import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { dataStore } from '../db/store';
import { env } from '../config/env';
import { AiService } from '../services/ai.service';
import { buildRainMonitor, demoRainMonitor, RainMonitorService } from '../services/rain-monitor.service';
import { availableAt, MINUTE, rainWindow } from '../services/rain-observations';
import type { RainObservations } from '../services/rain-observations';
import type { RainAlertEvidence } from '../shared/rain-monitor';
import type { RainEventRecord } from '../shared/types/rain';
import { rainMonitorQuestion, rainMonitorReply } from '../shared/rain-monitor-chat';

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
  it('reproduces the documented demo with separate measured and estimated values', () => {
    const demo = demoRainMonitor(deviceId);
    assert.equal(demo.demo, true);
    assert.equal(demo.observation.alert?.source, 'simulation');
    assert.equal(demo.observation.alert?.value, 16);
    assert.equal(demo.observation.alert?.threshold, 15);
    assert.equal(demo.observation.alert?.unit, 'mm');
    assert.equal(demo.pressure.delta3hHpa, -1.8);
    assert.equal(demo.forecast.estimatedRainMm, 12.8);
    assert.equal(demo.forecast.status, 'experimental');
    assert.equal(Date.parse(demo.forecast.validTo) - Date.parse(demo.forecast.validFrom), 60 * MINUTE);
    assert.match(rainMonitorReply(demo, 'alert'), /^Kịch bản mô phỏng.*16 mm.*15 mm/);
    assert.match(rainMonitorReply(demo, 'estimate'), /Nếu cường độ mưa hiện tại duy trì, ước tính 12.8 mm/);
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

  it('keeps external forecasts and arithmetic on their existing routes', () => {
    assert.equal(rainMonitorQuestion('Dự báo lượng mưa 1 tiếng tới'), 'estimate');
    assert.equal(rainMonitorQuestion('Có cảnh báo mưa trong 60 phút tới không?'), 'estimate');
    assert.equal(rainMonitorQuestion('Ước tính lượng mưa trong 60 phút vừa qua'), null);
    assert.equal(rainMonitorQuestion('Trạm có cảnh báo mưa không?'), 'alert');
    assert.equal(rainMonitorQuestion('Công thức cảnh báo mưa là gì?'), null);
    assert.equal(rainMonitorQuestion('Dự báo mưa Open-Meteo 1 tiếng tới'), null);
    assert.equal(rainMonitorQuestion('Dự báo mưa ngày mai'), null);
    assert.equal(rainMonitorQuestion('Nếu mưa 20 mm trong 1 tiếng tới thì nguy cơ thế nào?'), null);
  });

  it('uses one station result for the chatbot and never persists a demo alert', async () => {
    await dataStore.upsertDevice({ deviceId, name: deviceId });
    const previous = env.DEMO_MODE;
    try {
      env.DEMO_MODE = false;
      const preview = await new AiService().chat('Ước tính lượng mưa 60 phút tới', [], deviceId, true);
      assert.equal(preview.reply, rainMonitorReply(demoRainMonitor(deviceId), 'estimate'));
      env.DEMO_MODE = true;
      const service = new RainMonitorService();
      const snapshot = await service.getSnapshot(deviceId);
      const chat = await new AiService().chat('Ước tính lượng mưa 60 phút tới', [], deviceId);
      assert.deepEqual(chat.context.rainMonitor, snapshot);
      assert.equal(chat.reply, rainMonitorReply(snapshot!, 'estimate'));
      await service.evaluateStations();
      assert.deepEqual(await dataStore.getAlerts({ deviceId }), []);
    } finally {
      env.DEMO_MODE = previous;
    }
  });
});
