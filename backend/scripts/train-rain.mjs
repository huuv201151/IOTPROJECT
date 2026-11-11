import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { solve } from './train-weather.mjs';
import { availableAt, MINUTE, rainGapMs, rainPressure, rainWindow } from '../src/services/rain-observations.ts';
import { classifyRainEvents } from '../src/services/rain-ledger.ts';

const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const STORM_GAP = 6 * HOUR;
const windows = [15, 60, 180, 1440];
const stamp = (row) => Date.parse(row.timestamp);

function orderedUnique(rows, field) {
  return Array.from(new Map(rows.map((row) => [row[field], row])).values()).sort((a, b) => stamp(a) - stamp(b));
}

function subset(rows, from, to) {
  const index = (target) => {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (stamp(rows[mid]) < target) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return rows.slice(index(from), index(to + 1));
}

export function makeRainExamples(payload) {
  if (payload.source !== 'postgresql' || payload.demo !== false || payload.historyTruncated !== false) {
    throw new Error('Cần lịch sử PostgreSQL đầy đủ và dữ liệu thực để huấn luyện.');
  }
  const deviceId = payload.deviceId;
  const tests = payload.tests;
  if (!deviceId || ![payload.measurements, payload.events, tests].every(Array.isArray)) {
    throw new Error('Thiếu trạm, chuỗi quan trắc, sự kiện mưa hoặc nhãn thử.');
  }
  const all = [...payload.measurements, ...payload.events, ...tests];
  if (all.some((row) => row.deviceId !== deviceId)) throw new Error('Dữ liệu huấn luyện phải thuộc cùng một trạm.');
  const measurements = orderedUnique(payload.measurements.filter((row) => Number.isFinite(stamp(row)) && Number.isFinite(Date.parse(row.createdAt))), 'messageId');
  const events = classifyRainEvents(orderedUnique(payload.events, 'eventId'), tests);
  const maxGapMs = rainGapMs(payload.mqttInterval);
  if (!measurements.length) return { examples: [], storms: [], candidates: 0 };
  const storms = [];
  for (const event of events) {
    if (event.dataKind === 'test' || event.timingQuality === 'legacy' || event.rainfallMm <= 0) continue;
    const at = stamp(event);
    const last = storms.at(-1);
    if (last && at - last.end <= STORM_GAP) last.end = at;
    else storms.push({ start: at, end: at });
  }
  const examples = [];
  let candidates = 0;
  for (let at = Math.ceil((stamp(measurements[0]) + DAY) / (5 * MINUTE)) * 5 * MINUTE; at + HOUR <= stamp(measurements.at(-1)); at += 5 * MINUTE) {
    candidates++;
    const from = at - DAY - maxGapMs;
    const known = {
      deviceId, maxGapMs, tests,
      measurements: subset(measurements, from, at).filter((row) => availableAt(row, at)),
      events: subset(events, from, at).filter((row) => availableAt(row, at))
    };
    const rain = windows.map((minutes) => rainWindow(known, minutes, at).rainfallMm);
    if (rain.some((value) => value === null)) continue;
    const future = {
      deviceId, maxGapMs, tests,
      measurements: subset(measurements, at - maxGapMs, at + HOUR),
      events: subset(events, at, at + HOUR + maxGapMs)
    };
    const target = rainWindow(future, 60, at + HOUR).rainfallMm;
    if (target === null) continue;
    const pressure = rainPressure(known, at);
    examples.push({
      at, targetAt: at + HOUR, rain, pressure: [pressure.hpa, pressure.delta3hHpa],
      baseline: rain[0] * 4, target
    });
  }
  return { examples, storms, candidates };
}

function fit(rows, withPressure) {
  const vector = (row) => withPressure ? [...row.rain, ...row.pressure] : row.rain;
  const size = withPressure ? 6 : 4;
  const mean = Array.from({ length: size }, (_, i) => rows.reduce((s, row) => s + vector(row)[i], 0) / rows.length);
  const scale = mean.map((m, i) => Math.sqrt(rows.reduce((s, row) => s + (vector(row)[i] - m) ** 2, 0) / rows.length) || 1);
  const transform = (row) => [1, ...vector(row).map((x, i) => (x - mean[i]) / scale[i])];
  const matrix = Array.from({ length: size + 1 }, () => Array(size + 1).fill(0));
  const y = Array(size + 1).fill(0);
  for (const row of rows) {
    const x = transform(row);
    for (let i = 0; i <= size; i++) {
      y[i] += x[i] * row.target;
      for (let j = 0; j <= size; j++) matrix[i][j] += x[i] * x[j];
    }
  }
  for (let i = 1; i <= size; i++) matrix[i][i] += 1;
  const weights = solve(matrix, y);
  return { mean, scale, weights, predict: (row) => Math.max(0, transform(row).reduce((s, value, i) => s + value * weights[i], 0)) };
}

function evaluate(rows, predict, storms) {
  const wet = rows.filter((row) => row.target > 0);
  const mae = (set) => set.reduce((s, row) => s + Math.abs(row.target - predict(row)), 0) / set.length;
  return {
    count: rows.length, wetCount: wet.length,
    storms: storms.filter((storm) => wet.some((row) => storm.start < row.targetAt && storm.end >= row.at)).length,
    maeMm: mae(rows), wetMaeMm: wet.length ? mae(wet) : null
  };
}

const improves = (a, b) => a.wetMaeMm !== null && b.wetMaeMm !== null && a.maeMm < b.maeMm && a.wetMaeMm < b.wetMaeMm;

export function trainRainModel(payload) {
  const { examples, storms, candidates } = makeRainExamples(payload);
  const paired = examples.filter((row) => row.pressure.every((value) => value !== null));
  const coverage = { candidates, usable: examples.length, withPressure: paired.length, storms: storms.length };
  if (paired.length < 90 || storms.length < 3) return { evaluated: false, coverage, reason: 'Cần thêm dữ liệu có khí áp và ít nhất ba đợt mưa quan trắc.' };
  const boundary = (at) => storms.find((storm) => storm.start < at && storm.end >= at)?.end ?? at;
  const validationAt = boundary(paired[Math.floor(paired.length * 0.65)].at);
  const testAt = boundary(paired[Math.floor(paired.length * 0.82)].at);
  // Keep feature and target windows on their side of the split, including the 24-hour lookback.
  const train = paired.filter((row) => row.targetAt <= validationAt);
  const validation = paired.filter((row) => row.at - DAY >= validationAt && row.targetAt <= testAt);
  const test = paired.filter((row) => row.at - DAY >= testAt);
  const baseline = (set) => evaluate(set, (row) => row.baseline, storms);
  if ([train, validation, test].some((set) => set.length < 30 || baseline(set).storms === 0 || !set.some((row) => row.target === 0))) {
    return { evaluated: false, coverage, reason: 'Cần các giai đoạn mưa và khô độc lập trong từng tập sau khi chừa khoảng cách 24 giờ.' };
  }
  const rain = fit(train, false);
  const rainPressureModel = fit(train, true);
  const score = (set) => ({ baseline: baseline(set), rain: evaluate(set, rain.predict, storms), rainPressure: evaluate(set, rainPressureModel.predict, storms) });
  const metrics = { validation: score(validation), test: score(test) };
  const usePressure = improves(metrics.validation.rainPressure, metrics.validation.rain);
  const selection = usePressure ? 'rainPressure' : 'rain';
  const chosen = usePressure ? rainPressureModel : rain;
  const evaluated = improves(metrics.validation[selection], metrics.validation.baseline)
    && improves(metrics.test[selection], metrics.test.baseline)
    && (!usePressure || improves(metrics.test.rainPressure, metrics.test.rain));
  if (!evaluated) return { evaluated, coverage, metrics, reason: 'Mô hình đã chọn chưa cải thiện MAE tổng và MAE khi có mưa trên tập giữ lại.' };
  return {
    kind: 'rainsense-rain-ridge', evaluated, coverage, metrics, horizonMinutes: 60,
    deviceId: payload.deviceId, modelVersion: `rain-ridge-${new Date().toISOString()}`,
    trainedFrom: new Date(train[0].at).toISOString(), trainedTo: new Date(train.at(-1).targetAt).toISOString(),
    features: usePressure ? 'rain_pressure' : 'rain', mean: chosen.mean, scale: chosen.scale, weights: chosen.weights
  };
}

async function exportRain(base, deviceId, start, end) {
  const from = Date.parse(start);
  const to = Date.parse(end);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to > Date.now() || to - from > 31 * DAY) throw new Error('Chọn khoảng UTC đã qua, tối đa 31 ngày cho một lần xuất.');
  const get = async (path) => {
    const response = await fetch(new URL(path, base), { signal: AbortSignal.timeout(45000) });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error('Không đọc được dữ liệu trạm qua API.');
    return result.data;
  };
  const measurements = [];
  const events = [];
  const tests = new Map();
  const id = encodeURIComponent(deviceId);
  const config = await get(`/api/devices/${id}/config`);
  for (let at = from; at < to; at += DAY) {
    const query = new URLSearchParams({ from: new Date(at).toISOString(), to: new Date(Math.min(to, at + DAY)).toISOString() });
    const [series, audit] = await Promise.all([
      get(`/api/ai/series?deviceId=${id}&${query}`), get(`/api/devices/${id}/rain-audit?${query}`)
    ]);
    if (series.demo || series.historyTruncated || audit.truncated || series.source !== 'postgresql' || audit.source !== 'postgresql') {
      throw new Error('Khoảng xuất có dữ liệu mô phỏng, nguồn dự phòng hoặc bị cắt giới hạn.');
    }
    for (const row of series.records) measurements.push(row);
    for (const row of audit.events) events.push(row);
    for (const row of audit.periods) tests.set(row.id, row);
  }
  return { deviceId, source: 'postgresql', demo: false, historyTruncated: false, mqttInterval: config.mqttInterval, measurements, events, tests: Array.from(tests.values()) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [input, output, station, from, to, file] = process.argv.slice(2);
    if (input === '--export') {
      if (!file) throw new Error('Dùng --export URL mã-trạm from-UTC to-UTC observations.json');
      const dataset = await exportRain(output, station, from, to);
      writeFileSync(file, JSON.stringify(dataset), { encoding: 'utf8', flag: 'wx' });
      console.log(JSON.stringify({ file, measurements: dataset.measurements.length, events: dataset.events.length }));
    } else {
      if (!input || !output) throw new Error('Dùng observations.json report-or-model.json');
      const model = trainRainModel(JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, '')));
      writeFileSync(output, JSON.stringify(model, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
      console.log(JSON.stringify({ output, evaluated: model.evaluated, coverage: model.coverage, metrics: model.metrics, reason: model.reason }));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
