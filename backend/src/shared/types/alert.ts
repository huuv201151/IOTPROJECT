import type { RainAlertEvidence } from '../rain-monitor';

export type AlertType =
  | 'HEAVY_RAIN'
  | 'RAIN_ACCUMULATION'
  | 'HIGH_TEMPERATURE'
  | 'LOW_TEMPERATURE'
  | 'HIGH_HUMIDITY'
  | 'LOW_HUMIDITY'
  | 'DEVICE_OFFLINE'
  | 'MISSING_TELEMETRY'
  | 'SENSOR_ERROR'
  | 'MQTT_FAILURE';

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AlertRuleRecord {
  id: string;
  deviceId: string;
  alertType: AlertType;
  threshold: number;
  comparison: 'GREATER_THAN' | 'LESS_THAN';
  enabled: boolean;
  severity: AlertSeverity;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRecord {
  id: string;
  deviceId: string;
  type: AlertType;
  severity: AlertSeverity;
  message: string;
  isRead: boolean;
  createdAt: string;
  resolvedAt?: string;
  rainEvidence?: RainAlertEvidence;
}
