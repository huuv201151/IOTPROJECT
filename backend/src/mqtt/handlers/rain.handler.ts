import { RainEventPayloadSchema, RainEventPayload, normalizeStationId } from '../../shared';
import { dataStore } from '../../db/store';
import { rainfallService } from '../../services/rainfall.service';
import { emitRainUpdate } from '../../socket/io';
import { logger } from '../../utils/logger';
import { advanceRainCounter, withRainLock } from '../../services/rain-counter';
import { env } from '../../config/env';

async function processRainEventMessage(topic: string, rawPayload: Buffer | string, simulated = false) {
  try {
    const json = JSON.parse(rawPayload.toString());
    const parseResult = RainEventPayloadSchema.safeParse(json);

    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.format() }, 'Invalid rain event payload structure');
      return;
    }

    const data: RainEventPayload = parseResult.data;
    const deviceId = normalizeStationId(data.deviceId, topic, env.DEFAULT_STATION_ID);

    // Check message deduplication
    if (dataStore.isMessageProcessed(data.messageId)) {
      logger.debug({ messageId: data.messageId }, 'Duplicate rain event ignored');
      return;
    }

    // Retrieve station specific calibration factor (mm/tip)
    const config = await dataStore.getConfig(deviceId);
    const calibrationFactor = config?.rainMmPerTip ?? 0.64;
    const previous = await dataStore.getLatestMeasurement(deviceId);
    const change = advanceRainCounter(deviceId, { tips: data.cumulativeTips, timestamp: data.timestamp, bootId: data.bootId }, previous, data.tipCount);
    if (!change) return;

    // Save Rain Event
    const savedEvent = await dataStore.saveRainEvent({
      deviceId,
      eventId: data.messageId,
      timestamp: data.timestamp,
      tipCount: change.increment,
      calibrationFactor,
      intervalFrom: change.intervalFrom,
      timingQuality: change.timingQuality,
      dataKind: simulated ? 'test' : undefined, testNote: simulated ? 'Dữ liệu giả lập' : undefined
    });

    if (savedEvent) {
      // Recalculate statistics
      const stats = await rainfallService.getStatistics(deviceId);

      // Realtime broadcast to web dashboard
      emitRainUpdate(deviceId, savedEvent, stats);

      logger.info(
        { deviceId, tipCount: data.tipCount, mm: savedEvent.rainfallMm, currentRate: stats.currentRateMmH },
        'Processed valid rain gauge bucket tip event'
      );
    }
  } catch (err: unknown) {
    const error = err as Error;
    logger.error({ err: error.message }, 'Error processing rain MQTT message');
  }
}

export async function handleRainEventMessage(topic: string, payload: Buffer | string, simulated = false) {
  let id: string;
  try {
    const json = JSON.parse(payload.toString());
    id = normalizeStationId(String(json.deviceId || json.device_id || topic.split('/')[1]), topic, env.DEFAULT_STATION_ID);
  } catch {
    id = normalizeStationId(topic.split('/')[1], topic, env.DEFAULT_STATION_ID);
  }
  return withRainLock(id, () => processRainEventMessage(topic, payload, simulated));
}
