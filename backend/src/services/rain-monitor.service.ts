import { env } from '../config/env';
import { isDbConnected } from '../db/prisma';
import { withReadDiagnostics } from '../db/read-diagnostics';
import { dataStore } from '../db/store';
import { emitNewAlert } from '../socket/io';
import { logger } from '../utils/logger';
import { RAIN_RULE_VERSION, rainQualityLabels, rainWindowMinutes } from '../shared/rain-monitor';
import type { RainAlertEvidence, RainMonitorSnapshot, RainThresholdCheck } from '../shared/rain-monitor';
import type { AlertRuleRecord } from '../shared/types/alert';
import type { MeasurementRecord } from '../shared/types/telemetry';
import { normalizeStationTimezone } from '../shared/rainsense-ai';
import { classifyRainEvents } from './rain-ledger';
import { availableAt, MINUTE, rainGapMs, rainPressure, rainWindow, roundRain } from './rain-observations';
import type { RainObservations } from './rain-observations';
import { predictRain } from './rain-model';

const levels = { INFO: 1, WARNING: 2, CRITICAL: 3 };
const rainRules = (rules: AlertRuleRecord[]) => rules.filter((rule) => rule.enabled && rule.comparison === 'GREATER_THAN'
  && Number.isFinite(rule.threshold) && rule.threshold > 0
  && (rule.alertType === 'RAIN_ACCUMULATION' || rule.alertType === 'HEAVY_RAIN'));

export function buildRainMonitor(
  input: RainObservations, rules: AlertRuleRecord[], now: Date, timezone: string, demo = false
): RainMonitorSnapshot {
  const at = now.getTime();
  const generatedAt = now.toISOString();
  const windows = rainWindowMinutes.map((minutes) => rainWindow(input, minutes, at));
  const pressure = rainPressure(input, at);
  const byMinutes = (minutes: number) => windows.find((window) => window.minutes === minutes)!;
  const configured = rainRules(rules);
  const matched: RainAlertEvidence[] = [];
  const thresholds: RainThresholdCheck[] = [];
  for (const rule of configured) {
    const windowMinutes = rule.alertType === 'RAIN_ACCUMULATION' ? 60 : 5;
    const window = byMinutes(windowMinutes);
    const unit = rule.alertType === 'RAIN_ACCUMULATION' ? 'mm' : 'mm/h';
    const value = unit === 'mm' ? window.rainfallMm : window.averageMmH;
    thresholds.push({ ruleId: rule.id, windowMinutes, unit, threshold: rule.threshold, value, quality: window.quality });
    if (value === null || value <= rule.threshold) continue;
    matched.push({
      source: demo ? 'simulation' : 'observed', ruleVersion: RAIN_RULE_VERSION, ruleId: rule.id,
      severity: rule.severity, value, threshold: rule.threshold, unit, windowMinutes: window.minutes,
      from: window.from, to: window.to
    });
  }
  const alert = matched.sort((a, b) => levels[b.severity] - levels[a.severity] || b.windowMinutes - a.windowMinutes
    || b.threshold - a.threshold || a.ruleId.localeCompare(b.ruleId))[0] ?? null;
  const recent = byMinutes(15);
  const hour = byMinutes(60);
  const missingRuleWindow = thresholds.some(({ quality }) => quality !== 'complete');
  const status = alert ? 'heavy' : recent.rainfallMm === null || missingRuleWindow ? 'insufficient' : recent.rainfallMm > 0 || (hour.rainfallMm ?? 0) > 0 ? 'rain' : 'dry';
  const bounds = { validFrom: generatedAt, validTo: new Date(at + 60 * MINUTE).toISOString() };
  const forecast: RainMonitorSnapshot['forecast'] = {
    ...bounds, method: 'persistence', estimatedRainMm: null, status: 'insufficient',
    reason: rainQualityLabels[recent.quality]
  };
  if (recent.rainfallMm === 0) {
    forecast.status = 'dry_baseline';
    forecast.reason = 'Chưa đủ căn cứ ước tính mưa mới hình thành';
  } else if (recent.rainfallMm !== null) {
    forecast.estimatedRainMm = roundRain(recent.rainfallMm * 4);
    forecast.status = 'experimental';
    forecast.reason = 'Ngoại suy thử nghiệm nếu cường độ trung bình 15 phút qua duy trì';
  }
  const evaluated = !demo && recent.rainfallMm !== null ? predictRain(input.deviceId, windows, pressure) : null;
  const observedAt = input.measurements.reduce<string | null>((latest, row) => {
    if (row.messageId.startsWith('sim-') || row.messageId.endsWith('-def')) return latest;
    return latest === null || row.timestamp > latest ? row.timestamp : latest;
  }, null);
  return {
    deviceId: input.deviceId, timezone, generatedAt, observedAt, demo, windows, pressure,
    observation: { status, alert, rulesConfigured: thresholds.length > 0, thresholds },
    forecast: evaluated ? { ...bounds, ...evaluated, method: 'ridge', status: 'evaluated', reason: null } : forecast
  };
}

export function demoRainMonitor(deviceId: string, timezone = 'Asia/Ho_Chi_Minh'): RainMonitorSnapshot {
  const now = new Date('2026-11-09T07:00:00.000Z');
  const stamp = (minutes: number) => new Date(now.getTime() - minutes * MINUTE).toISOString();
  const measurements: MeasurementRecord[] = Array.from({ length: 1441 }, (_, minutes) => ({
    id: `m${minutes}`, deviceId, messageId: `fixture-${minutes}`, timestamp: stamp(minutes), createdAt: stamp(minutes),
    temperature: 26, humidity: 90, pressure: roundRain(1009.6 + Math.min(minutes, 180) * 0.01), wifiRssi: -50, uptime: 10
  }));
  const events = [{ minutes: 45, tips: 20 }, { minutes: 6, tips: 5 }].map(({ minutes, tips }) => ({
    id: `e${minutes}`, eventId: `fixture-rain-${minutes}`, deviceId, timestamp: stamp(minutes),
    createdAt: stamp(minutes), tipCount: tips, rainfallMm: tips * 0.64, calibrationFactor: 0.64,
    timingQuality: 'device_tip' as const
  }));
  const rule: AlertRuleRecord = {
    id: 'demo-60m', deviceId, alertType: 'RAIN_ACCUMULATION', threshold: 15,
    comparison: 'GREATER_THAN', severity: 'WARNING', enabled: true, createdAt: stamp(0), updatedAt: stamp(0)
  };
  return buildRainMonitor({ deviceId, measurements, events, tests: [], maxGapMs: 2 * MINUTE }, [rule], now, timezone, true);
}

export class RainMonitorService {
  async getSnapshot(deviceId: string, now = new Date(), demo = env.DEMO_MODE): Promise<RainMonitorSnapshot | null> {
    const device = await dataStore.getDevice(deviceId);
    if (!device) return null;
    const timezone = normalizeStationTimezone(device.timezone);
    if (demo) return demoRainMonitor(deviceId, timezone);
    const cutoff = now.getTime();
    const config = await dataStore.getConfig(deviceId);
    const maxGapMs = rainGapMs(config?.mqttInterval);
    const from = new Date(cutoff - 1440 * MINUTE - maxGapMs).toISOString();
    const to = now.toISOString();
    const { value, source } = await withReadDiagnostics(() => Promise.all([
      dataStore.getMeasurements(deviceId, { from, to, limit: 20000 }),
      dataStore.getRainEvents(deviceId, from, to),
      dataStore.getRainTestPeriods(deviceId),
      dataStore.getAlertRules(deviceId)
    ]));
    const [measurements, events, tests, rules] = value;
    if (isDbConnected() && source !== 'postgresql') throw new Error('Rain observations are only partially available');
    return buildRainMonitor({
      deviceId, maxGapMs, tests,
      measurements: measurements.filter((row) => availableAt(row, cutoff)),
      events: classifyRainEvents(events.filter((row) => availableAt(row, cutoff)), tests)
    }, rules, now, timezone);
  }

  private running = false;

  async evaluateStations() {
    if (this.running || env.DEMO_MODE || (env.NODE_ENV === 'production' && !isDbConnected())) return;
    this.running = true;
    try {
      for (const device of await dataStore.getAllDevices()) {
        try {
          const snapshot = await this.getSnapshot(device.deviceId);
          if (!snapshot || snapshot.demo || snapshot.observation.status === 'insufficient') continue;
          const evidence = snapshot.observation.alert;
          const hour = snapshot.windows.find((window) => window.minutes === 60);
          // A full dry hour rearms the alert. Missing data and transient dips preserve the peak.
          const dry = hour?.rainfallMm === 0 && snapshot.observation.status === 'dry';
          const level = evidence ? levels[evidence.severity] : dry ? 0 : null;
          const saved = await dataStore.recordRainAlert(device.deviceId, level, snapshot.generatedAt, evidence);
          if (saved) emitNewAlert(saved);
        } catch (err) {
          logger.warn({ deviceId: device.deviceId, error: err instanceof Error ? err.message : 'Unknown error' }, 'Rain monitoring cycle failed for station');
        }
      }
    } finally {
      this.running = false;
    }
  }
}

export const rainMonitorService = new RainMonitorService();
