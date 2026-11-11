import type { RainEventRecord } from '../shared/types/rain';

export interface RainWindow {
  /** Continuous telemetry spans; rainfall belongs to the same span, not the whole requested window. */
  observedSegments?: Array<{ from: string; to: string; rainfallMm: number; tips: number; uncertainTimingEvents: number }>;
  testRainfallMm?: number;
  testTips?: number;
  uncertainTimingEvents?: number;
  label: string;
  from: string;
  to: string;
  rainfallMm: number;
  tips: number;
  calibrationFactors: number[];
  coverageComplete: boolean;
}

const MINUTE = 60000;
const round = (n: number) => Math.round(n * 100) / 100;
// An interval batch wholly inside a window supports its mean, without inventing per-tip timestamps.
const uncertainWithin = (e: RainEventRecord, start: number, end: number) => e.timingQuality !== 'device_tip' &&
  !(e.timingQuality === 'telemetry_interval' && e.intervalFrom && Date.parse(e.intervalFrom) >= start && Date.parse(e.intervalFrom) <= Date.parse(e.timestamp) && Date.parse(e.timestamp) <= end);

export function summarizeRainWindow(
  events: RainEventRecord[], telemetryTimes: string[], from: Date, to: Date, label: string, maxGapMs = 120000, includeEnd = false
): RainWindow {
  const start = from.getTime();
  const end = to.getTime();
  const allSelected = events.filter((e) => Date.parse(e.timestamp) >= start && (includeEnd ? Date.parse(e.timestamp) <= end : Date.parse(e.timestamp) < end) &&
    Number.isFinite(e.rainfallMm) && e.rainfallMm >= 0 && Number.isSafeInteger(e.tipCount) && e.tipCount > 0);
  const selected = allSelected.filter((e) => e.dataKind !== 'test');
  const tests = allSelected.filter((e) => e.dataKind === 'test');
  const samples = telemetryTimes.map(Date.parse).filter(Number.isFinite).sort((a, b) => a - b);
  const before = samples.filter((t) => t <= start).pop();
  const after = samples.find((t) => t >= end);
  const inside = samples.filter((t) => t > start && t < end);
  const points = [before ?? inside[0], ...inside, after ?? inside.at(-1)].filter((t): t is number => t !== undefined);
  const coverageComplete = end > start && points.length > 0 && Math.abs(points[0] - start) <= maxGapMs &&
    Math.abs(end - points[points.length - 1]) <= maxGapMs && points.every((t, i) => i === 0 || t - points[i - 1] <= maxGapMs);
  const spans: number[][] = [];
  for (const stamp of [...new Set(samples.filter((t) => t >= start && t <= end))]) {
    const last = spans.at(-1);
    if (!last || stamp - last.at(-1)! > maxGapMs) spans.push([stamp]);
    else last.push(stamp);
  }
  const observedSegments = spans.filter((span) => span.at(-1)! > span[0]).map((span) => {
    const first = span[0], last = span.at(-1)!;
    const recorded = selected.filter((e) => Date.parse(e.timestamp) >= first && Date.parse(e.timestamp) <= last);
    return { from: new Date(first).toISOString(), to: new Date(last).toISOString(),
      rainfallMm: round(recorded.reduce((s, e) => s + e.rainfallMm, 0)), tips: recorded.reduce((s, e) => s + e.tipCount, 0),
      uncertainTimingEvents: recorded.filter((e) => uncertainWithin(e, first, last)).length };
  });
  return { label, from: from.toISOString(), to: to.toISOString(), coverageComplete,
    observedSegments,
    testRainfallMm: round(tests.reduce((s, e) => s + e.rainfallMm, 0)), testTips: tests.reduce((s, e) => s + e.tipCount, 0),
    uncertainTimingEvents: selected.filter((e) => uncertainWithin(e, start, end)).length,
    rainfallMm: round(selected.reduce((s, e) => s + e.rainfallMm, 0)),
    tips: selected.reduce((s, e) => s + e.tipCount, 0), calibrationFactors: [...new Set(selected.map((e) => e.calibrationFactor))] };
}
