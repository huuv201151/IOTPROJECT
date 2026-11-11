import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { env } from '../config/env';
import { logger } from '../utils/logger';
import type { MonitoredRainWindow, RainMonitorSnapshot } from '../shared/rain-monitor';
import { roundRain } from './rain-observations';

export const rainFeatures = ['rain15m', 'rain60m', 'rain180m', 'rain1440m'] as const;
export const pressureFeatures = [...rainFeatures, 'pressureHpa', 'delta3hHpa'] as const;
export function improvesRainMae(
  candidate: { maeMm: number; wetMaeMm: number | null },
  baseline: { maeMm: number; wetMaeMm: number | null }
): boolean {
  return candidate.wetMaeMm !== null && baseline.wetMaeMm !== null
    && candidate.maeMm < baseline.maeMm && candidate.wetMaeMm < baseline.wetMaeMm;
}

const score = z.object({
  count: z.number().int().min(30),
  wetCount: z.number().int().positive(),
  storms: z.number().int().positive(),
  maeMm: z.number().finite().nonnegative(),
  wetMaeMm: z.number().finite().nonnegative()
}).refine(({ count, wetCount, storms }) => wetCount < count && storms <= wetCount);
const comparison = z.object({ baseline: score, rain: score, rainPressure: score }).refine(({ baseline, rain, rainPressure }) =>
  [rain, rainPressure].every((candidate) => candidate.count === baseline.count
    && candidate.wetCount === baseline.wetCount && candidate.storms === baseline.storms));

export const rainModelSchema = z.object({
  kind: z.literal('rainsense-rain-ridge'),
  modelVersion: z.string().min(1),
  deviceId: z.string().min(1),
  horizonMinutes: z.literal(60),
  trainedFrom: z.string().datetime(),
  trainedTo: z.string().datetime(),
  evaluated: z.literal(true),
  features: z.enum(['rain', 'rain_pressure']),
  metrics: z.object({ validation: comparison, test: comparison }),
  mean: z.array(z.number().finite()),
  scale: z.array(z.number().finite().positive()),
  weights: z.array(z.number().finite())
}).refine((model) => {
  const size = model.features === 'rain' ? rainFeatures.length : pressureFeatures.length;
  const selected = model.features === 'rain' ? 'rain' : 'rainPressure';
  return model.mean.length === size && model.scale.length === size && model.weights.length === size + 1
    && Date.parse(model.trainedTo) > Date.parse(model.trainedFrom)
    && Object.values(model.metrics).every((split) => improvesRainMae(split[selected], split.baseline)
      && (selected === 'rain' || improvesRainMae(split.rainPressure, split.rain)));
});

let loaded: { file: string; model: z.infer<typeof rainModelSchema> | null } | undefined;
function configuredRainModel() {
  const file = env.RAIN_MODEL_FILE;
  if (!file) return null;
  if (loaded?.file === file) return loaded.model;
  try {
    loaded = { file, model: rainModelSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) };
  } catch {
    logger.warn('Configured rain model could not be loaded. Using persistence estimate.');
    loaded = { file, model: null };
  }
  return loaded.model;
}

export function predictRain(deviceId: string, windows: MonitoredRainWindow[], pressure: RainMonitorSnapshot['pressure']) {
  const model = configuredRainModel();
  if (!model || model.deviceId !== deviceId) return null;
  const values = [15, 60, 180, 1440].map((minutes) => windows.find((window) => window.minutes === minutes)?.rainfallMm ?? null);
  if (model.features === 'rain_pressure') values.push(pressure.hpa, pressure.delta3hHpa);
  if (values.some((value) => value === null)) return null;
  const prediction = values.reduce<number>((sum, value, index) => {
    return sum + ((value! - model.mean[index]) / model.scale[index]) * model.weights[index + 1];
  }, model.weights[0]);
  if (!Number.isFinite(prediction)) return null;
  return {
    estimatedRainMm: roundRain(Math.max(0, prediction)), modelVersion: model.modelVersion,
    modelFeatures: model.features, trainedFrom: model.trainedFrom, trainedTo: model.trainedTo
  };
}
