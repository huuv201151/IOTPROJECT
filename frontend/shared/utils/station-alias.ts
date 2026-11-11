/**
 * Canonical station aliases mapping.
 * In production IoT deployments, an ESP32 station may publish with:
 * - Hardware MAC-derived client ID: e.g. "weather-F47723AD4F7C" (from IOT_MQTT_TLS.ino)
 * - Topic-defined station ID: e.g. "station01" (weather/station01/data)
 * - Canonical dashboard default station: e.g. "RS-ESP32S3-01"
 *
 * All of these represent the same physical station. Normalizing to the canonical ID prevents
 * split telemetry, duplicate mirror rows, and quarantined AI observations.
 */

export const PRIMARY_STATION_ID = 'RS-ESP32S3-01';

export const KNOWN_STATION_ALIASES: readonly string[] = [
  'RS-ESP32S3-01',
  'station01',
  'weather-F47723AD4F7C'
];

export function isCanonicalPrimaryStation(id?: string): boolean {
  if (!id) return false;
  const trimmed = id.trim();
  return (
    trimmed === PRIMARY_STATION_ID ||
    trimmed === 'station01' ||
    trimmed.startsWith('weather-')
  );
}

export function normalizeStationId(rawId?: string, topic?: string, defaultStation = PRIMARY_STATION_ID): string {
  const trimmed = (rawId || '').trim();
  const topicStation = topic ? topic.split('/')[1]?.trim() : '';

  if (
    trimmed === defaultStation ||
    trimmed === 'station01' ||
    trimmed.startsWith('weather-') ||
    topicStation === 'station01' ||
    topicStation === defaultStation
  ) {
    return defaultStation;
  }

  return trimmed || defaultStation;
}

export function getStationQueryAliases(deviceId: string, defaultStation = PRIMARY_STATION_ID): string[] {
  if (isCanonicalPrimaryStation(deviceId)) {
    const set = new Set([defaultStation, ...KNOWN_STATION_ALIASES]);
    return Array.from(set);
  }
  return [deviceId];
}
