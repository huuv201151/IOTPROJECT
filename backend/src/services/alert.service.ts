import { AlertRecord, AlertRuleRecord, MeasurementRecord } from '../shared';
import { dataStore } from '../db/store';
import { logger } from '../utils/logger';

export class AlertService {
  // Prevent alert spam: track last alert time per (deviceId + ruleId)
  private lastAlertTriggered: Map<string, number> = new Map();

  /**
   * Evaluate telemetry measurements against device alert rules
   */
  async evaluateTelemetry(deviceId: string, measurement: MeasurementRecord) {
    const rules = await dataStore.getAlertRules(deviceId);
    const activeRules = rules.filter((r) => r.enabled);
    const now = Date.now();

    for (const rule of activeRules) {
      const cooldownKey = `${deviceId}:${rule.id}`;
      const lastTriggered = this.lastAlertTriggered.get(cooldownKey) || 0;
      // 10 minutes cooldown between duplicate alerts for same rule
      if (now - lastTriggered < 10 * 60 * 1000) {
        continue;
      }

      let triggered = false;
      let alertMessage = '';

      switch (rule.alertType) {
        case 'HIGH_TEMPERATURE':
          if (rule.comparison === 'GREATER_THAN' && measurement.temperature > rule.threshold) {
            triggered = true;
            alertMessage = `Nhiệt độ hiện tại đạt ${measurement.temperature}°C (vượt ngưỡng ${rule.threshold}°C)`;
          }
          break;

        case 'LOW_TEMPERATURE':
          if (rule.comparison === 'LESS_THAN' && measurement.temperature < rule.threshold) {
            triggered = true;
            alertMessage = `Nhiệt độ môi trường hạ thấp còn ${measurement.temperature}°C (dưới ngưỡng ${rule.threshold}°C)`;
          }
          break;

        case 'HIGH_HUMIDITY':
          if (rule.comparison === 'GREATER_THAN' && measurement.humidity > rule.threshold) {
            triggered = true;
            alertMessage = `Độ ẩm không khí tăng cao ${measurement.humidity}% (vượt ngưỡng ${rule.threshold}%)`;
          }
          break;

        case 'LOW_HUMIDITY':
          if (rule.comparison === 'LESS_THAN' && measurement.humidity < rule.threshold) {
            triggered = true;
            alertMessage = `Độ ẩm không khí giảm mạnh còn ${measurement.humidity}% (dưới ngưỡng ${rule.threshold}%)`;
          }
          break;

      }

      if (triggered) {
        this.lastAlertTriggered.set(cooldownKey, now);
        const alert = await dataStore.createAlert({
          deviceId,
          type: rule.alertType,
          severity: rule.severity,
          message: alertMessage
        });
        logger.warn({ alertId: alert.id, rule: rule.alertType, msg: alertMessage }, 'Alert condition triggered!');
        return alert;
      }
    }

    return null;
  }

  /**
   * Check for device offline (called periodically)
   */
  async checkDeviceOffline(deviceId: string) {
    const device = await dataStore.getDevice(deviceId);
    if (!device || !device.lastSeen) return null;

    const diffSeconds = (Date.now() - new Date(device.lastSeen).getTime()) / 1000;
    // Consider offline if no heartbeat for 120 seconds
    if (diffSeconds > 120 && device.isOnline) {
      await dataStore.updateDeviceStatus(deviceId, false, device.lastSeen, device.wifiRssi, device.uptime);

      const alert = await dataStore.createAlert({
        deviceId,
        type: 'DEVICE_OFFLINE',
        severity: 'CRITICAL',
        message: `Trạm ${device.name} (${deviceId}) mất kết nối đã hơn ${Math.round(diffSeconds)} giây`
      });
      return alert;
    }
    return null;
  }
}

export const alertService = new AlertService();
