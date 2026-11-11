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
import type { RainEventRecord, RainTestPeriod } from '../shared/types/rain';
import { normalizeStationTimezone } from '../shared/utils/time';
import { getStationQueryAliases } from '../shared/utils/station-alias';
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
    if (row.messageId.startsWith('sim-')) return latest;
    return latest === null || row.timestamp > latest ? row.timestamp : latest;
  }, null);
  return {
    deviceId: input.deviceId, timezone, generatedAt, observedAt, demo, windows, pressure,
    observation: { status, alert, rulesConfigured: thresholds.length > 0, thresholds },
    forecast: evaluated ? { ...bounds, ...evaluated, method: 'ridge', status: 'evaluated', reason: null } : forecast
  };
}

export function demoRainMonitor(
  deviceId: string,
  timezone = 'Asia/Ho_Chi_Minh',
  scenario: string = 'high',
  referenceTime?: Date
): RainMonitorSnapshot {
  const now = referenceTime ?? new Date('2026-11-09T07:00:00.000Z');
  const stamp = (minutes: number) => new Date(now.getTime() - minutes * MINUTE).toISOString();

  let baseP = 1009.6;
  let pSlope = 0.01;
  let rawEvents: { minutes: number; tips: number }[] = [];
  let ruleSeverity: 'INFO' | 'WARNING' | 'CRITICAL' = 'WARNING';
  let forecastReasonOverride: string | null = null;

  switch (scenario) {
    case 'low': {
      // Demo 1: Thấp (An toàn) - Tạnh ráo, khí áp ổn định, không mưa
      baseP = 1013.8;
      pSlope = -0.0005; // +0.1 hPa / 180 min
      rawEvents = [];
      ruleSeverity = 'WARNING';
      forecastReasonOverride = 'Khí quyển ổn định (1.013,8 hPa, +0,1 hPa/3h). Không có tín hiệu mưa hình thành trong 60 phút tới.';
      break;
    }
    case 'moderate': {
      // Demo 2: Trung bình (Cần lưu ý) - Mưa rải rác nhẹ, chưa vượt ngưỡng cảnh báo 15 mm
      baseP = 1008.2;
      pSlope = 1.6 / 180; // -1.6 hPa / 180 min
      rawEvents = [
        { minutes: 360, tips: 4 }, // 2.56 mm (trong 24h)
        { minutes: 120, tips: 4 }, // 2.56 mm (trong 3h)
        { minutes: 40, tips: 6 },  // 3.84 mm (trong 1h)
        { minutes: 8, tips: 2 }    // 1.28 mm (trong 15m)
      ];
      // 15m: 1.28 mm (5.12 mm/h TB)
      // 60m: 5.12 mm (5.12 mm/h TB) -> dưới ngưỡng 15 mm
      // 3h: 7.68 mm, 24h: 10.24 mm
      ruleSeverity = 'WARNING';
      forecastReasonOverride = 'Áp suất khí quyển giảm nhẹ (-1,6 hPa/3h). Dự báo mưa rào ngắt quãng 5–6 mm trong 60 phút tới, chưa có nguy cơ ngập.';
      break;
    }
    case 'critical': {
      // Demo 4: Rất cao (Nguy hiểm) - Mưa xối xả cực lớn do áp thấp/bão, vượt mức khẩn cấp
      baseP = 998.2;
      pSlope = 5.8 / 180; // -5.8 hPa / 180 min
      rawEvents = [
        { minutes: 300, tips: 60 }, // 38.4 mm (trong 24h)
        { minutes: 120, tips: 45 }, // 28.8 mm (trong 3h)
        { minutes: 45, tips: 35 },  // 22.4 mm (trong 1h)
        { minutes: 20, tips: 25 },  // 16.0 mm (trong 1h)
        { minutes: 5, tips: 15 }    // 9.6 mm (trong 15m: 38.4 mm/h)
      ];
      // 15m: 9.6 mm (38.4 mm/h TB)
      // 60m: 48.0 mm (48.0 mm/h TB) -> vượt xa 15 mm!
      // 3h: 76.8 mm, 24h: 115.2 mm
      ruleSeverity = 'CRITICAL';
      forecastReasonOverride = 'Áp thấp khí quyển sâu (-5,8 hPa/3h). CẢNH BÁO KHẨN CẤP: Lượng mưa tích lũy đặc biệt lớn, nguy cơ ngập sâu diện rộng!';
      break;
    }
    case 'high':
    default: {
      // Demo 3: Cao (Cảnh báo ngập) - Mưa to vượt ngưỡng cảnh báo 15 mm (16 mm / 60 min, -1.8 hPa)
      // Khớp 100% với fixture mẫu gốc
      baseP = 1009.6;
      pSlope = 0.01;
      rawEvents = [
        { minutes: 300, tips: 20 },
        { minutes: 110, tips: 15 },
        { minutes: 45, tips: 20 },
        { minutes: 6, tips: 5 }
      ];
      ruleSeverity = 'WARNING';
      forecastReasonOverride = 'Khí áp giảm nhanh (-1,8 hPa/3h), mưa to duy trì. CẢNH BÁO: Nguy cơ ngập úng cục bộ tại các điểm trũng thấp trong 60 phút tới.';
      break;
    }
  }

  const measurements: MeasurementRecord[] = Array.from({ length: 1441 }, (_, minutes) => ({
    id: `m${minutes}`, deviceId, messageId: `fixture-${minutes}`, timestamp: stamp(minutes), createdAt: stamp(minutes),
    temperature: scenario === 'critical' ? 23.2 : scenario === 'moderate' ? 26.8 : scenario === 'low' ? 29.4 : 24.6,
    humidity: scenario === 'critical' ? 95 : scenario === 'moderate' ? 78 : scenario === 'low' ? 62 : 90,
    pressure: roundRain(baseP + Math.min(minutes, 180) * pSlope), wifiRssi: -50, uptime: 10
  }));

  const events = rawEvents.map(({ minutes, tips }) => ({
    id: `e${minutes}`, eventId: `fixture-rain-${minutes}`, deviceId, timestamp: stamp(minutes),
    createdAt: stamp(minutes), tipCount: tips, rainfallMm: tips * 0.64, calibrationFactor: 0.64,
    timingQuality: 'device_tip' as const
  }));

  const rule: AlertRuleRecord = {
    id: 'demo-60m', deviceId, alertType: 'RAIN_ACCUMULATION', threshold: 15,
    comparison: 'GREATER_THAN', severity: ruleSeverity, enabled: true, createdAt: stamp(0), updatedAt: stamp(0)
  };

  const snapshot = buildRainMonitor({ deviceId, measurements, events, tests: [], maxGapMs: 2 * MINUTE }, [rule], now, timezone, true);
  if (forecastReasonOverride && snapshot.forecast.status !== 'insufficient') {
    snapshot.forecast.reason = forecastReasonOverride;
  }
  return snapshot;
}

export class RainMonitorService {
  async getSnapshot(
    deviceId: string,
    now?: Date,
    demo = env.DEMO_MODE,
    scenario?: string
  ): Promise<RainMonitorSnapshot | null> {
    const device = await dataStore.getDevice(deviceId);
    if (!device) return null;
    const timezone = normalizeStationTimezone(device.timezone);
    if (demo) return demoRainMonitor(deviceId, timezone, scenario, now);
    const evaluationTime = now ?? new Date();
    const cutoff = evaluationTime.getTime();
    const config = await dataStore.getConfig(deviceId);
    const maxGapMs = rainGapMs(config?.mqttInterval);
    const from = new Date(cutoff - 1440 * MINUTE - maxGapMs).toISOString();
    const to = evaluationTime.toISOString();
    const aliases = getStationQueryAliases(deviceId);

    const { value, source } = await withReadDiagnostics(async () => {
      const [measurementsArr, eventsArr, testsArr, rules] = await Promise.all([
        Promise.all(aliases.map((id) => dataStore.getMeasurements(id, { from, to, limit: 20000 }))),
        Promise.all(aliases.map((id) => dataStore.getRainEvents(id, from, to))),
        Promise.all(aliases.map((id) => dataStore.getRainTestPeriods(id))),
        dataStore.getAlertRules(deviceId)
      ]);

      const seenMsg = new Set<string>();
      const measurements: MeasurementRecord[] = [];
      for (const list of measurementsArr) {
        for (const row of list) {
          if (!demo && row.messageId.startsWith('sim-')) continue;
          const canonicalId = row.messageId.replace(/-def$/, '');
          if (seenMsg.has(canonicalId)) continue;
          seenMsg.add(canonicalId);
          measurements.push({ ...row, deviceId, messageId: canonicalId });
        }
      }

      const seenEvents = new Set<string>();
      const events: RainEventRecord[] = [];
      for (const list of eventsArr) {
        for (const ev of list) {
          const key = `${ev.timestamp}-${ev.tipCount}`;
          if (seenEvents.has(key)) continue;
          seenEvents.add(key);
          events.push({ ...ev, deviceId });
        }
      }

      const seenTests = new Set<string>();
      const tests: RainTestPeriod[] = [];
      for (const list of testsArr) {
        for (const t of list) {
          if (seenTests.has(t.id)) continue;
          seenTests.add(t.id);
          tests.push({ ...t, deviceId });
        }
      }

      return [measurements, events, tests, rules] as const;
    });
    const [measurements, events, tests, rules] = value;
    if (isDbConnected() && source !== 'postgresql') throw new Error('Rain observations are only partially available');
    return buildRainMonitor({
      deviceId, maxGapMs, tests,
      measurements: measurements.filter((row) => availableAt(row, cutoff)),
      events: classifyRainEvents(events.filter((row) => availableAt(row, cutoff)), tests)
    }, rules, evaluationTime, timezone);
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
