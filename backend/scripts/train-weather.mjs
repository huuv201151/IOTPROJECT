import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const HOUR = 3600000;
const GAP = 120000;
export const featureNames = ['temperatureC', 'humidityPercent', 'pressureHpa', 'temperatureDelta1hC', 'pressureDelta1hHpa', 'utcHourSin', 'utcHourCos'];

/** Experimental one-hour temperature model. No generated weather data is used by the CLI. */
export function makeExamples(payload) {
  const data = payload.data ?? payload;
  if (data.source !== 'postgresql' || data.demo === true || data.historyTruncated === true) throw new Error('Training requires non-demo, non-truncated PostgreSQL observations');
  if (!Array.isArray(data.records) || data.records.length > 100000) throw new Error('Expected at most 100000 measurement records (merge bounded daily API exports)');
  const rows = data.records.map((r) => ({ ...r, at: Date.parse(r.timestamp), knownAt: Math.max(Date.parse(r.timestamp), Date.parse(r.createdAt)) }))
    .filter((r) => Number.isFinite(r.at) && Number.isFinite(r.knownAt) && Number.isFinite(r.temperature) && r.temperature >= -40 && r.temperature <= 85 &&
      Number.isFinite(r.humidity) && r.humidity >= 0 && r.humidity <= 100 && Number.isFinite(r.pressure) && r.pressure >= 300 && r.pressure <= 1100)
    .sort((a, b) => a.at - b.at);
  if (!rows.length || rows.some((r) => r.deviceId !== data.deviceId)) throw new Error('Records must belong to one station and contain valid measurements');
  const nearest = (at, availableAt = Infinity) => {
    let best;
    for (const row of rows) {
      if (row.at > at + GAP) break;
      if (row.knownAt > availableAt || row.at > availableAt) continue;
      if (!best || Math.abs(row.at - at) < Math.abs(best.at - at)) best = row;
    }
    return best && Math.abs(best.at - at) <= GAP ? best : null;
  };
  const examples = [];
  for (let at = Math.ceil((rows[0].at + HOUR) / 300000) * 300000; at <= rows.at(-1).at - HOUR; at += 300000) {
    const current = nearest(at, at);
    const past = nearest(at - HOUR, at);
    const future = nearest(at + HOUR);
    if (!current || !past || !future) continue;
    const interval = rows.filter((r) => r.at >= at - HOUR && r.at <= at + HOUR);
    if (!interval.length || interval[0].at - (at - HOUR) > GAP || at + HOUR - interval.at(-1).at > GAP || interval.some((r, i) => i > 0 && r.at - interval[i - 1].at > GAP)) continue;
    const angle = (at % (24 * HOUR)) / (24 * HOUR) * 2 * Math.PI;
    examples.push({ at, targetAt: future.at, x: [current.temperature, current.humidity, current.pressure,
      current.temperature - past.temperature, current.pressure - past.pressure, Math.sin(angle), Math.cos(angle)], y: future.temperature });
  }
  return examples;
}

export function solve(matrix, vector) {
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < a.length; col++) {
    let pivot = col;
    for (let row = col + 1; row < a.length; row++) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    if (Math.abs(a[col][col]) < 1e-10) throw new Error('Insufficient variation to fit the model');
    const divisor = a[col][col];
    a[col] = a[col].map((n) => n / divisor);
    for (let row = 0; row < a.length; row++) {
      if (row === col) continue;
      const factor = a[row][col];
      a[row] = a[row].map((n, i) => n - factor * a[col][i]);
    }
  }
  return a.map((row) => row.at(-1));
}

export function trainTemperatureModel(payload) {
  const examples = makeExamples(payload);
  if (examples.length < 300 || examples.at(-1).at - examples[0].at < 48 * HOUR) throw new Error('Need at least 300 complete examples spanning at least 48 hours; collect substantially more data before considering deployment');
  const validationAt = examples[Math.floor(examples.length * 0.7)].at;
  const testAt = examples[Math.floor(examples.length * 0.85)].at;
  const train = examples.filter((r) => r.at < validationAt && r.targetAt < validationAt);
  const validation = examples.filter((r) => r.at >= validationAt && r.at < testAt && r.targetAt < testAt);
  const test = examples.filter((r) => r.at >= testAt);
  if ([train, validation, test].some((s) => s.length < 30)) throw new Error('Not enough independent-period examples after purging overlapping targets');
  const mean = featureNames.map((_, i) => train.reduce((sum, r) => sum + r.x[i], 0) / train.length);
  const scale = mean.map((m, i) => Math.sqrt(train.reduce((sum, r) => sum + (r.x[i] - m) ** 2, 0) / train.length) || 1);
  const transform = (x) => [1, ...x.map((v, i) => (v - mean[i]) / scale[i])];
  const size = featureNames.length + 1;
  const matrix = Array.from({ length: size }, () => Array(size).fill(0));
  const vector = Array(size).fill(0);
  for (const row of train) {
    const x = transform(row.x);
    for (let i = 0; i < size; i++) { vector[i] += x[i] * row.y; for (let j = 0; j < size; j++) matrix[i][j] += x[i] * x[j]; }
  }
  for (let i = 1; i < size; i++) matrix[i][i] += 1; // Fixed ridge penalty; no tuning against the test set.
  const weights = solve(matrix, vector);
  const score = (set) => ({ count: set.length,
    modelMaeC: set.reduce((sum, r) => sum + Math.abs(transform(r.x).reduce((p, v, i) => p + v * weights[i], 0) - r.y), 0) / set.length,
    persistenceMaeC: set.reduce((sum, r) => sum + Math.abs(r.x[0] - r.y), 0) / set.length });
  return { kind: 'experimental-temperature-ridge', version: 1, trainedAt: new Date().toISOString(), deviceId: (payload.data ?? payload).deviceId,
    horizonMinutes: 60, featureNames, mean, scale, weights, readyForDeployment: false,
    split: { trainLastTarget: new Date(train.at(-1).targetAt).toISOString(), validationStart: new Date(validationAt).toISOString(), validationLastTarget: new Date(validation.at(-1).targetAt).toISOString(), testStart: new Date(testAt).toISOString() },
    metrics: { validation: score(validation), test: score(test) },
    limitations: 'Retrospective single-station temperature experiment; no rainfall probabilities, no uncertainty calibration, not loaded by chatbot. Requires seasonal and prospective evaluation.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [input, output] = process.argv.slice(2);
    if (!input || !output) throw new Error('Usage: node scripts/train-weather.mjs observations.json experimental-model.json');
    const payload = JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
    const model = trainTemperatureModel(payload);
    writeFileSync(output, JSON.stringify(model, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({ output, metrics: model.metrics, readyForDeployment: false }, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
