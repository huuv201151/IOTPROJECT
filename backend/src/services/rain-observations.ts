import { summarizeRainWindow } from './ai-rain-history';
import type { MonitoredRainWindow, RainQuality, RainWindowMinutes } from '../shared/rain-monitor';
import type { RainEventRecord, RainTestPeriod } from '../shared/types/rain';
import type { MeasurementRecord } from '../shared/types/telemetry';

export const MINUTE = 60000;
export const roundRain = (value: number) => Math.round(value * 100) / 100;
export const rainGapMs = (mqttInterval = 30) => Math.min(5 * MINUTE, Math.max(2 * MINUTE, mqttInterval * 3000));

export interface RainObservations {
  deviceId: string;
  measurements: MeasurementRecord[];
  events: RainEventRecord[];
  tests: RainTestPeriod[];
  maxGapMs: number;
}

export function availableAt(row: { timestamp: string; createdAt: string }, cutoff: number): boolean {
  return Date.parse(row.timestamp) <= cutoff && Date.parse(row.createdAt) <= cutoff;
}

const isMirror = (row: MeasurementRecord) => row.messageId.endsWith('-def');
const isSimulated = (row: MeasurementRecord) => row.messageId.startsWith('sim-');

export function rainWindow(input: RainObservations, minutes: RainWindowMinutes, end: number): MonitoredRainWindow {
  const start = end - minutes * MINUTE;
  const bounds = { minutes, from: new Date(start).toISOString(), to: new Date(end).toISOString() };
  const unavailable = (quality: RainQuality): MonitoredRainWindow => ({ ...bounds, rainfallMm: null, averageMmH: null, quality });
  const events = input.events.filter((event) => {
    const at = Date.parse(event.timestamp);
    return event.deviceId === input.deviceId && at >= start && (at < end || Date.parse(event.intervalFrom ?? '') < end);
  });
  if (input.tests.some((test) => test.deviceId === input.deviceId && Date.parse(test.from) < end && Date.parse(test.to) > start)
    || events.some((event) => event.dataKind === 'test')) return unavailable('test_water');

  const rows = input.measurements.filter((row) => {
    const at = Date.parse(row.timestamp);
    return row.deviceId === input.deviceId && at >= start - input.maxGapMs && at <= end;
  });
  const inWindow = rows.filter((row) => Date.parse(row.timestamp) >= start);
  if (inWindow.some(isSimulated)) return unavailable('simulation');
  if (inWindow.some(isMirror)) return unavailable('mixed_station');
  const native = rows.filter((row) => !isSimulated(row) && !isMirror(row));
  const nativeMessages = new Set(native.map((row) => row.messageId));
  // Older ingestion mirrored counter batches to other device IDs. A generated counter event
  // must have its matching native measurement before it can drive a station alert.
  const prefix = `rain-${input.deviceId}-`;
  if (events.some((event) => event.timingQuality === 'telemetry_interval' && event.eventId.startsWith(prefix)
    && !nativeMessages.has(event.eventId.slice(prefix.length).replace(/-\d+$/, '')))) return unavailable('mixed_station');
  if (events.some((event) => event.timingQuality === 'telemetry_interval' && Date.parse(event.timestamp) >= end)) return unavailable('uncertain_tips');
  const times = Array.from(new Set(native.map((row) => row.timestamp)));
  const summary = summarizeRainWindow(events, times, new Date(start), new Date(end), '', input.maxGapMs);
  if (times.length < 2 || !summary.coverageComplete) return unavailable('missing_telemetry');
  if (summary.uncertainTimingEvents) return unavailable('uncertain_tips');
  return { ...bounds, rainfallMm: summary.rainfallMm, averageMmH: roundRain(summary.rainfallMm * 60 / minutes), quality: 'complete' };
}

export function rainPressure(input: RainObservations, end: number) {
  const rows = input.measurements.filter((row) => row.deviceId === input.deviceId && !isMirror(row) && !isSimulated(row)
    && Number.isFinite(row.pressure) && row.pressure >= 300 && row.pressure <= 1100 && Date.parse(row.timestamp) <= end);
  const nearest = (at: number) => rows.reduce<MeasurementRecord | null>((best, row) => {
    const gap = Math.abs(Date.parse(row.timestamp) - at);
    return gap <= input.maxGapMs && (!best || gap < Math.abs(Date.parse(best.timestamp) - at)) ? row : best;
  }, null);
  const current = nearest(end);
  const past = nearest(end - 180 * MINUTE);
  return {
    hpa: current?.pressure ?? null,
    delta3hHpa: current && past ? roundRain(current.pressure - past.pressure) : null,
    reason: !current ? 'Thiếu khí áp gần thời điểm chốt' : !past ? 'Thiếu khí áp gần mốc 3 giờ trước' : null
  };
}
