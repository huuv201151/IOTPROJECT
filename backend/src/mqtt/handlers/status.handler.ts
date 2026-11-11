import { dataStore } from '../../db/store';
import { emitDeviceStatus } from '../../socket/io';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import { normalizeStationId } from '../../shared/utils/station-alias';

export async function handleStatusMessage(topic: string, rawPayload: Buffer | string) {
  try {
    const rawStr = rawPayload.toString().trim();
    const parts = topic.split('/');
    const stationIdFromTopic = parts[1] || env.DEFAULT_STATION_ID;

    let rawDeviceId = stationIdFromTopic;
    let isOnline = true;
    let wifiRssi: number | undefined;
    let uptime: number | undefined;
    let timestamp = new Date().toISOString();

    if (rawStr === 'online' || rawStr === 'offline') {
      isOnline = rawStr === 'online';
    } else {
      try {
        const json = JSON.parse(rawStr);
        if (typeof json === 'object' && json !== null) {
          rawDeviceId = json.deviceId || json.device_id || stationIdFromTopic;
          isOnline = json.status === 'online';
          wifiRssi = json.wifiRssi ?? json.wifi_rssi_dbm;
          uptime = json.uptime ?? json.uptime_ms;
          timestamp = json.timestamp || timestamp;
        }
      } catch {
        isOnline = rawStr.toLowerCase().includes('online');
      }
    }

    const deviceId = normalizeStationId(rawDeviceId, topic, env.DEFAULT_STATION_ID);

    // Auto-create/ensure device in database
    await dataStore.upsertDevice({
      deviceId,
      name: `Trạm ${deviceId}`,
      location: 'Trạm khí tượng tự động'
    });

    await dataStore.updateDeviceStatus(deviceId, isOnline, timestamp, wifiRssi, uptime);
    emitDeviceStatus(deviceId, isOnline, timestamp, wifiRssi);

    if (env.DEFAULT_STATION_ID && deviceId !== env.DEFAULT_STATION_ID) {
      await dataStore.upsertDevice({
        deviceId: env.DEFAULT_STATION_ID,
        name: `Trạm ${env.DEFAULT_STATION_ID}`,
        location: 'Trạm khí tượng tự động'
      });
      await dataStore.updateDeviceStatus(env.DEFAULT_STATION_ID, isOnline, timestamp, wifiRssi, uptime);
      emitDeviceStatus(env.DEFAULT_STATION_ID, isOnline, timestamp, wifiRssi);
    }

    logger.info({ deviceId, isOnline, topic }, 'Station status updated from MQTT');
  } catch (err: unknown) {
    const error = err as Error;
    logger.error({ err: error.message }, 'Error processing status MQTT message');
  }
}
