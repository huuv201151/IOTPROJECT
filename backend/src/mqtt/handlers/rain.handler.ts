import { RainEventPayloadSchema, RainEventPayload } from '../../shared';
import { dataStore } from '../../db/store';
import { rainfallService } from '../../services/rainfall.service';
import { emitRainUpdate } from '../../socket/io';
import { logger } from '../../utils/logger';
import { advanceRainCounter, withRainLock } from '../../services/rain-counter';

async function processRainEventMessage(topic: string, rawPayload: Buffer | string, simulated = false) {
  try {
    const json = JSON.parse(rawPayload.toString());
    const parseResult = RainEventPayloadSchema.safeParse(json);

    if (!parseResult.success) {
      logger.warn({ errors: parseResult.error.format() }, 'Invalid rain event payload structure');
      return;
    }

    const data: RainEventPayload = parseResult.data;

    // Check message deduplication
    if (dataStore.isMessageProcessed(data.messageId)) {
      logger.debug({ messageId: data.messageId }, 'Duplicate rain event ignored');
      return;
    }

    // Retrieve station specific calibration factor (mm/tip)
    const config = await dataStore.getConfig(data.deviceId);
    const calibrationFactor = config?.rainMmPerTip ?? 0.64;
    const previous = await dataStore.getLatestMeasurement(data.deviceId);
    const change = advanceRainCounter(data.deviceId, { tips: data.cumulativeTips, timestamp: data.timestamp, bootId: data.bootId }, previous, data.tipCount);
    if (!change) return;

    // Save Rain Event
    const savedEvent = await dataStore.saveRainEvent({
      deviceId: data.deviceId,
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
      const stats = await rainfallService.getStatistics(data.deviceId);

      // Realtime broadcast to web dashboard
      emitRainUpdate(data.deviceId, savedEvent, stats);

      logger.info(
        { deviceId: data.deviceId, tipCount: data.tipCount, mm: savedEvent.rainfallMm, currentRate: stats.currentRateMmH },
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
  try { id = String(JSON.parse(payload.toString()).deviceId); }
  catch { return processRainEventMessage(topic, payload, simulated); }
  return withRainLock(id, () => processRainEventMessage(topic, payload, simulated));
}
