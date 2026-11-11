import type { Request, Response } from 'express';
import { env } from '../config/env';
import { withReadDiagnostics } from '../db/read-diagnostics';
import { dataStore } from '../db/store';
import { calculateWeatherFeatures } from '../services/ai-weather-features';
import { deviceIdSchema } from '../shared/schemas/device.schema';

export async function getObservationSeries(req: Request, res: Response) {
  const deviceId = deviceIdSchema.safeParse(req.query.deviceId || env.DEFAULT_STATION_ID);
  const from = typeof req.query.from === 'string' ? new Date(req.query.from) : new Date(NaN);
  const to = typeof req.query.to === 'string' ? new Date(req.query.to) : new Date();
  if (!deviceId.success || !Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())
    || to <= from || to.getTime() - from.getTime() > 7 * 86400000 || to.getTime() > Date.now() + 60000) {
    return res.status(400).json({ success: false, error: 'Cần mã trạm và khoảng thời gian hợp lệ, tối đa 7 ngày, không ở tương lai' });
  }
  try {
    const bounds = { from: from.toISOString(), to: to.toISOString() };
    const { value: records, source } = await withReadDiagnostics(() => dataStore.getMeasurements(deviceId.data, { ...bounds, limit: 20000 }));
    const config = await dataStore.getConfig(deviceId.data);
    const features = calculateWeatherFeatures(records, from, to, Math.max(120000, (config?.mqttInterval ?? 30) * 3000));
    return res.json({
      success: true,
      data: {
        deviceId: deviceId.data, ...bounds, source, demo: env.DEMO_MODE, historyTruncated: records.length >= 20000,
        units: { temperature: '°C', humidity: '%', pressure: 'hPa' }, features, records
      }
    });
  } catch {
    return res.status(503).json({ success: false, error: 'Chưa đọc được chuỗi môi trường' });
  }
}
