import {
  DeviceRecord,
  DeviceConfigurationRecord,
  MeasurementRecord,
  RainEventRecord,
  AlertRuleRecord,
  AlertRecord,
  DeviceCommandRecord,
  calculateDewPoint
} from '../shared';
import { getPrismaClient, isDbConnected } from './prisma';
import { logger } from '../utils/logger';
import bcrypt from 'bcryptjs';
import { recordReadSource } from './read-diagnostics';
import { randomUUID } from 'node:crypto';
import type { RainTestPeriod } from '../shared/types/rain';
import type { RainAlertEvidence } from '../shared/rain-monitor';
import { formatRainEvidence } from '../shared/rain-monitor';

// In-memory persistent caches for standalone/demo operation or fallback
class InMemoryStore {
  devices: Map<string, DeviceRecord> = new Map();
  configs: Map<string, DeviceConfigurationRecord> = new Map();
  measurements: MeasurementRecord[] = [];
  rainEvents: RainEventRecord[] = [];
  rainTestPeriods: RainTestPeriod[] = [];
  alertRules: AlertRuleRecord[] = [];
  alerts: AlertRecord[] = [];
  commands: Map<string, DeviceCommandRecord> = new Map();
  users: Array<{ id: string; email: string; passwordHash: string; role: string }> = [];
  processedMessageIds: Set<string> = new Set();
}

const memoryStore = new InMemoryStore();
const rainAlertStates = new Map<string, { level: number; at: number }>();

function rainAlertRecord(deviceId: string, evidence: RainAlertEvidence, at: string): AlertRecord {
  return {
    id: randomUUID(), deviceId, type: evidence.unit === 'mm' ? 'RAIN_ACCUMULATION' : 'HEAVY_RAIN',
    severity: evidence.severity, message: formatRainEvidence(evidence), isRead: false, createdAt: at, rainEvidence: evidence
  };
}

export const dataStore = {
  // ----------------------------------------------------
  // USERS
  // ----------------------------------------------------
  async getUserByEmail(email: string) {
    if (isDbConnected()) {
      try {
        return await getPrismaClient().user.findUnique({ where: { email } });
      } catch (err) {
        logger.error({ err }, 'Prisma error fetching user');
      }
    }
    return memoryStore.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) || null;
  },

  async createUser(user: { email: string; passwordHash: string; role?: string }) {
    if (isDbConnected()) {
      try {
        return await getPrismaClient().user.upsert({
          where: { email: user.email },
          update: { passwordHash: user.passwordHash, role: user.role || 'ADMIN' },
          create: { email: user.email, passwordHash: user.passwordHash, role: user.role || 'ADMIN' }
        });
      } catch (err) {
        logger.error({ err }, 'Prisma error creating user');
      }
    }
    const existing = memoryStore.users.find((u) => u.email.toLowerCase() === user.email.toLowerCase());
    if (existing) {
      existing.passwordHash = user.passwordHash;
      existing.role = user.role || 'ADMIN';
      return existing;
    }
    const created = {
      id: `usr-${Date.now()}`,
      email: user.email,
      passwordHash: user.passwordHash,
      role: user.role || 'ADMIN'
    };
    memoryStore.users.push(created);
    return created;
  },

  // ----------------------------------------------------
  // DEVICES
  // ----------------------------------------------------
  async getDevice(deviceId: string): Promise<DeviceRecord | null> {
    if (isDbConnected()) {
      try {
        const d = await getPrismaClient().device.findUnique({ where: { deviceId } });
        recordReadSource('postgresql');
        if (d) {
          return {
            id: d.id,
            deviceId: d.deviceId,
            name: d.name,
            location: d.location,
            timezone: d.timezone,
            firmwareVersion: d.firmwareVersion,
            isOnline: d.isOnline,
            lastSeen: d.lastSeen?.toISOString(),
            wifiRssi: d.wifiRssi ?? undefined,
            uptime: d.uptime ?? undefined,
            createdAt: d.createdAt.toISOString(),
            updatedAt: d.updatedAt.toISOString()
          };
        }
      } catch (err) {
        logger.error({ err }, 'Prisma error getDevice');
      }
    }
    recordReadSource('memory');
    return memoryStore.devices.get(deviceId) || null;
  },

  async getAllDevices(): Promise<DeviceRecord[]> {
    if (isDbConnected()) {
      try {
        const list = await getPrismaClient().device.findMany({ orderBy: { createdAt: 'asc' } });
        return list.map((d) => ({
          id: d.id,
          deviceId: d.deviceId,
          name: d.name,
          location: d.location,
          timezone: d.timezone,
          firmwareVersion: d.firmwareVersion,
          isOnline: d.isOnline,
          lastSeen: d.lastSeen?.toISOString(),
          wifiRssi: d.wifiRssi ?? undefined,
          uptime: d.uptime ?? undefined,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString()
        }));
      } catch (err) {
        logger.error({ err }, 'Prisma error getAllDevices');
      }
    }
    return Array.from(memoryStore.devices.values());
  },

  async upsertDevice(data: {
    deviceId: string;
    name: string;
    location?: string;
    timezone?: string;
    firmwareVersion?: string;
    rainMmPerTip?: number;
  }): Promise<DeviceRecord> {
    const nowIso = new Date().toISOString();
    if (isDbConnected()) {
      try {
        const prisma = getPrismaClient();
        const d = await prisma.device.upsert({
          where: { deviceId: data.deviceId },
          update: {
            name: data.name,
            location: data.location,
            timezone: data.timezone,
            firmwareVersion: data.firmwareVersion
          },
          create: {
            deviceId: data.deviceId,
            name: data.name,
            location: data.location || 'Trạm quan trắc',
            timezone: data.timezone || 'Asia/Ho_Chi_Minh',
            firmwareVersion: data.firmwareVersion || '1.0.0',
            isOnline: false,
            configuration: {
              create: {
                rainMmPerTip: data.rainMmPerTip ?? 0.25,
                sensorInterval: 10,
                mqttInterval: 30
              }
            }
          }
        });
        return {
          id: d.id,
          deviceId: d.deviceId,
          name: d.name,
          location: d.location,
          timezone: d.timezone,
          firmwareVersion: d.firmwareVersion,
          isOnline: d.isOnline,
          lastSeen: d.lastSeen?.toISOString(),
          wifiRssi: d.wifiRssi ?? undefined,
          uptime: d.uptime ?? undefined,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString()
        };
      } catch (err) {
        logger.error({ err }, 'Prisma error upsertDevice');
      }
    }

    let dev = memoryStore.devices.get(data.deviceId);
    if (!dev) {
      dev = {
        id: `dev-${Date.now()}`,
        deviceId: data.deviceId,
        name: data.name,
        location: data.location || 'Trạm quan trắc trung tâm',
        timezone: data.timezone || 'Asia/Ho_Chi_Minh',
        firmwareVersion: data.firmwareVersion || '1.0.0',
        isOnline: false,
        createdAt: nowIso,
        updatedAt: nowIso
      };
      memoryStore.devices.set(data.deviceId, dev);
      memoryStore.configs.set(data.deviceId, {
        id: `cfg-${Date.now()}`,
        deviceId: data.deviceId,
        rainMmPerTip: data.rainMmPerTip ?? 0.25,
        sensorInterval: 10,
        mqttInterval: 30,
        updatedAt: nowIso
      });
    } else {
      dev.name = data.name;
      if (data.location) dev.location = data.location;
      if (data.timezone) dev.timezone = data.timezone;
      if (data.firmwareVersion) dev.firmwareVersion = data.firmwareVersion;
      dev.updatedAt = nowIso;
    }
    return dev;
  },

  async updateDeviceStatus(
    deviceId: string,
    isOnline: boolean,
    lastSeen: string,
    wifiRssi?: number,
    uptime?: number
  ): Promise<void> {
    if (isDbConnected()) {
      try {
        await getPrismaClient().device.update({
          where: { deviceId },
          data: {
            isOnline,
            lastSeen: new Date(lastSeen),
            wifiRssi: wifiRssi !== undefined ? wifiRssi : undefined,
            uptime: uptime !== undefined ? uptime : undefined
          }
        });
      } catch (err) {
        logger.error({ err }, 'Prisma error updateDeviceStatus');
      }
    }
    const dev = memoryStore.devices.get(deviceId);
    if (dev) {
      dev.isOnline = isOnline;
      dev.lastSeen = lastSeen;
      if (wifiRssi !== undefined) dev.wifiRssi = wifiRssi;
      if (uptime !== undefined) dev.uptime = uptime;
      dev.updatedAt = new Date().toISOString();
    }
  },

  // ----------------------------------------------------
  // CONFIGURATION
  // ----------------------------------------------------
  async getConfig(deviceId: string): Promise<DeviceConfigurationRecord | null> {
    if (isDbConnected()) {
      try {
        const c = await getPrismaClient().deviceConfiguration.findUnique({ where: { deviceId } });
        recordReadSource('postgresql');
        if (c) {
          return {
            id: c.id,
            deviceId: c.deviceId,
            rainMmPerTip: c.rainMmPerTip,
            sensorInterval: c.sensorInterval,
            mqttInterval: c.mqttInterval,
            updatedAt: c.updatedAt.toISOString()
          };
        }
      } catch (err) {
        logger.error({ err }, 'Prisma error getConfig');
      }
    }
    recordReadSource('memory');
    return memoryStore.configs.get(deviceId) || null;
  },

  async updateConfig(
    deviceId: string,
    update: Partial<Omit<DeviceConfigurationRecord, 'id' | 'deviceId' | 'updatedAt'>>
  ): Promise<DeviceConfigurationRecord> {
    const nowIso = new Date().toISOString();
    if (isDbConnected()) {
      try {
        const c = await getPrismaClient().deviceConfiguration.upsert({
          where: { deviceId },
          update: {
            rainMmPerTip: update.rainMmPerTip,
            sensorInterval: update.sensorInterval,
            mqttInterval: update.mqttInterval
          },
          create: {
            deviceId,
            rainMmPerTip: update.rainMmPerTip ?? 0.25,
            sensorInterval: update.sensorInterval ?? 10,
            mqttInterval: update.mqttInterval ?? 30
          }
        });
        return {
          id: c.id,
          deviceId: c.deviceId,
          rainMmPerTip: c.rainMmPerTip,
          sensorInterval: c.sensorInterval,
          mqttInterval: c.mqttInterval,
          updatedAt: c.updatedAt.toISOString()
        };
      } catch (err) {
        logger.error({ err }, 'Prisma error updateConfig');
      }
    }

    let cfg = memoryStore.configs.get(deviceId);
    if (!cfg) {
      cfg = {
        id: `cfg-${Date.now()}`,
        deviceId,
        rainMmPerTip: update.rainMmPerTip ?? 0.25,
        sensorInterval: update.sensorInterval ?? 10,
        mqttInterval: update.mqttInterval ?? 30,
        updatedAt: nowIso
      };
      memoryStore.configs.set(deviceId, cfg);
    } else {
      if (update.rainMmPerTip !== undefined) cfg.rainMmPerTip = update.rainMmPerTip;
      if (update.sensorInterval !== undefined) cfg.sensorInterval = update.sensorInterval;
      if (update.mqttInterval !== undefined) cfg.mqttInterval = update.mqttInterval;
      cfg.updatedAt = nowIso;
    }
    return cfg;
  },

  // ----------------------------------------------------
  // MEASUREMENTS & DEDUPLICATION
  // ----------------------------------------------------
  isMessageProcessed(messageId: string): boolean {
    return memoryStore.processedMessageIds.has(messageId);
  },

  markMessageProcessed(messageId: string): void {
    memoryStore.processedMessageIds.add(messageId);
    if (memoryStore.processedMessageIds.size > 10000) {
      const it = memoryStore.processedMessageIds.values();
      for (let i = 0; i < 2000; i++) {
        const val = it.next().value;
        if (val) memoryStore.processedMessageIds.delete(val);
      }
    }
  },

  async saveMeasurement(data: {
    deviceId: string;
    messageId: string;
    timestamp: string;
    temperature: number;
    humidity: number;
    pressure: number;
    wifiRssi: number;
    uptime: number;
    totalRainTips?: number;
    rainRate?: number;
  }): Promise<MeasurementRecord | null> {
    if (this.isMessageProcessed(data.messageId)) {
      logger.warn({ messageId: data.messageId }, 'Duplicate telemetry message dropped');
      return null;
    }
    memoryStore.processedMessageIds.add(data.messageId);

    const dewPoint = calculateDewPoint(data.temperature, data.humidity);
    const nowIso = new Date().toISOString();

    const record: MeasurementRecord = {
      id: `m-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      deviceId: data.deviceId,
      messageId: data.messageId,
      timestamp: data.timestamp,
      temperature: data.temperature,
      humidity: data.humidity,
      pressure: data.pressure,
      dewPoint,
      wifiRssi: data.wifiRssi,
      uptime: data.uptime,
      totalRainTips: data.totalRainTips,
      rainRate: data.rainRate,
      createdAt: nowIso
    };

    if (isDbConnected()) {
      try {
        await getPrismaClient().measurement.create({
          data: {
            deviceId: record.deviceId,
            messageId: record.messageId,
            timestamp: new Date(record.timestamp),
            temperature: record.temperature,
            humidity: record.humidity,
            pressure: record.pressure,
            dewPoint: record.dewPoint,
            wifiRssi: record.wifiRssi,
            uptime: record.uptime,
            totalRainTips: record.totalRainTips,
            rainRate: record.rainRate
          }
        });
      } catch (err) {
        logger.error({ err }, 'Prisma error saveMeasurement');
      }
    }

    memoryStore.measurements.push(record);
    // Limit memory measurements to last 50,000 to prevent unbounded memory growth
    if (memoryStore.measurements.length > 50000) {
      memoryStore.measurements.splice(0, 5000);
    }

    return record;
  },

  async getLatestMeasurement(deviceId: string): Promise<MeasurementRecord | null> {
    if (isDbConnected()) {
      try {
        const m = await getPrismaClient().measurement.findFirst({
          where: { deviceId },
          orderBy: { timestamp: 'desc' }
        });
        recordReadSource('postgresql');
        if (m) {
          return {
            id: m.id,
            deviceId: m.deviceId,
            messageId: m.messageId,
            timestamp: m.timestamp.toISOString(),
            temperature: m.temperature,
            humidity: m.humidity,
            pressure: m.pressure,
            dewPoint: m.dewPoint ?? undefined,
            wifiRssi: m.wifiRssi ?? 0,
            uptime: m.uptime ?? 0,
            totalRainTips: m.totalRainTips ?? undefined,
            rainRate: m.rainRate ?? undefined,
            createdAt: m.createdAt.toISOString()
          };
        }
      } catch (err) {
        logger.error({ err }, 'Prisma error getLatestMeasurement');
      }
    }

    recordReadSource('memory');
    const latestMemory = memoryStore.measurements.filter((m) => m.deviceId === deviceId)
      .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];
    return latestMemory || null;
  },

  async getMeasurements(
    deviceId: string,
    options?: { from?: string; to?: string; limit?: number }
  ): Promise<MeasurementRecord[]> {
    const limit = options?.limit || 1000;
    const fromDate = options?.from ? new Date(options.from) : undefined;
    const toDate = options?.to ? new Date(options.to) : undefined;

    if (isDbConnected()) {
      try {
        const list = await getPrismaClient().measurement.findMany({
          where: {
            deviceId,
            ...(fromDate || toDate
              ? {
                  timestamp: {
                    ...(fromDate ? { gte: fromDate } : {}),
                    ...(toDate ? { lte: toDate } : {})
                  }
                }
              : {})
          },
          orderBy: { timestamp: 'desc' },
          take: limit
        });
        recordReadSource('postgresql');
        return list.reverse().map((m) => ({
          id: m.id,
          deviceId: m.deviceId,
          messageId: m.messageId,
          timestamp: m.timestamp.toISOString(),
          temperature: m.temperature,
          humidity: m.humidity,
          pressure: m.pressure,
          dewPoint: m.dewPoint ?? undefined,
          wifiRssi: m.wifiRssi ?? 0,
          uptime: m.uptime ?? 0,
          totalRainTips: m.totalRainTips ?? undefined,
          rainRate: m.rainRate ?? undefined,
          createdAt: m.createdAt.toISOString()
        }));
      } catch (err) {
        logger.error({ err }, 'Prisma error getMeasurements');
      }
    }

    recordReadSource('memory');
    const filtered = memoryStore.measurements.filter((m) => {
      if (m.deviceId !== deviceId) return false;
      const t = new Date(m.timestamp).getTime();
      if (fromDate && t < fromDate.getTime()) return false;
      if (toDate && t > toDate.getTime()) return false;
      return true;
    });

    return filtered.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp)).slice(-limit);
  },

  // ----------------------------------------------------
  // RAIN EVENTS
  // ----------------------------------------------------
  async saveRainEvent(data: {
    deviceId: string;
    eventId: string;
    timestamp: string;
    tipCount: number;
    calibrationFactor: number;
    intervalFrom?: string;
    timingQuality?: RainEventRecord['timingQuality'];
    dataKind?: RainEventRecord['dataKind'];
    testNote?: string;
  }): Promise<RainEventRecord | null> {
    if (this.isMessageProcessed(data.eventId)) {
      logger.warn({ eventId: data.eventId }, 'Duplicate rain event dropped');
      return null;
    }
    memoryStore.processedMessageIds.add(data.eventId);

    const rainfallMm = Math.round(data.tipCount * data.calibrationFactor * 100) / 100;
    const nowIso = new Date().toISOString();

    const record: RainEventRecord = {
      id: `re-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      deviceId: data.deviceId,
      eventId: data.eventId,
      timestamp: data.timestamp,
      tipCount: data.tipCount,
      calibrationFactor: data.calibrationFactor,
      rainfallMm,
      intervalFrom: data.intervalFrom,
      timingQuality: data.timingQuality ?? 'legacy',
      dataKind: data.dataKind,
      testNote: data.testNote,
      createdAt: nowIso
    };

    if (isDbConnected()) {
      try {
        await getPrismaClient().rainEvent.create({
          data: {
            deviceId: record.deviceId,
            eventId: record.eventId,
            timestamp: new Date(record.timestamp),
            tipCount: record.tipCount,
            calibrationFactor: record.calibrationFactor,
            rainfallMm: record.rainfallMm,
            intervalFrom: record.intervalFrom ? new Date(record.intervalFrom) : null,
            timingQuality: record.timingQuality,
            dataKind: record.dataKind ?? 'unverified',
            testNote: record.testNote
          }
        });
      } catch (err) {
        logger.error({ err }, 'Prisma error saveRainEvent');
      }
    }

    memoryStore.rainEvents.push(record);
    return record;
  },

  async getRainTestPeriods(deviceId: string): Promise<RainTestPeriod[]> {
    if (isDbConnected()) {
      const rows = await getPrismaClient().rainTestPeriod.findMany({ where: { deviceId }, orderBy: { from: 'desc' } });
      recordReadSource('postgresql');
      return rows.map((r) => ({ ...r, from: r.from.toISOString(), to: r.to.toISOString(), createdAt: r.createdAt.toISOString() }));
    }
    recordReadSource('memory');
    return memoryStore.rainTestPeriods.filter((r) => r.deviceId === deviceId);
  },

  async saveRainTestPeriod(data: Omit<RainTestPeriod, 'id' | 'createdAt'>): Promise<RainTestPeriod> {
    const record = { ...data, id: randomUUID(), createdAt: new Date().toISOString() };
    if (isDbConnected()) {
      await getPrismaClient().rainTestPeriod.create({ data: { ...record, from: new Date(data.from), to: new Date(data.to), createdAt: new Date(record.createdAt) } });
    } else memoryStore.rainTestPeriods.push(record);
    return record;
  },

  async endRainTestPeriod(deviceId: string, id: string, to: string): Promise<void> {
    if (isDbConnected()) {
      const result = await getPrismaClient().rainTestPeriod.updateMany({ where: { id, deviceId, from: { lt: new Date(to) }, to: { gt: new Date(to) } }, data: { to: new Date(to) } });
      if (!result.count) throw new Error('Phiên thử không tồn tại hoặc đã kết thúc');
    } else {
      const period = memoryStore.rainTestPeriods.find((p) => p.id === id && p.deviceId === deviceId && p.from < to && p.to > to);
      if (!period) throw new Error('Phiên thử không tồn tại hoặc đã kết thúc');
      period.to = to;
    }
  },

  async getRainEvents(deviceId: string, from?: string, to?: string): Promise<RainEventRecord[]> {
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;

    if (isDbConnected()) {
      try {
        const list = await getPrismaClient().rainEvent.findMany({
          where: {
            deviceId,
            ...(fromDate || toDate
              ? {
                  timestamp: {
                    ...(fromDate ? { gte: fromDate } : {}),
                    ...(toDate ? { lte: toDate } : {})
                  }
                }
              : {})
          },
          orderBy: { timestamp: 'asc' }
        });
        recordReadSource('postgresql');
        return list.map((r) => ({
          id: r.id,
          deviceId: r.deviceId,
          eventId: r.eventId,
          timestamp: r.timestamp.toISOString(),
          tipCount: r.tipCount,
          calibrationFactor: r.calibrationFactor,
          rainfallMm: r.rainfallMm,
          intervalFrom: r.intervalFrom?.toISOString(),
          timingQuality: r.timingQuality as RainEventRecord['timingQuality'],
          dataKind: r.dataKind as RainEventRecord['dataKind'],
          testNote: r.testNote ?? undefined,
          createdAt: r.createdAt.toISOString()
        }));
      } catch (err) {
        logger.error({ err }, 'Prisma error getRainEvents');
      }
    }

    recordReadSource('memory');
    return memoryStore.rainEvents.filter((r) => {
      if (r.deviceId !== deviceId) return false;
      const t = new Date(r.timestamp).getTime();
      if (fromDate && t < fromDate.getTime()) return false;
      if (toDate && t > toDate.getTime()) return false;
      return true;
    });
  },

  // ----------------------------------------------------
  // ALERT RULES & ALERTS
  // ----------------------------------------------------
  async getAlertRules(deviceId: string): Promise<AlertRuleRecord[]> {
    if (isDbConnected()) {
      try {
        const list = await getPrismaClient().alertRule.findMany({
          where: { deviceId }
        });
        recordReadSource('postgresql');
        return list.map((r) => ({
          id: r.id,
          deviceId: r.deviceId,
          alertType: r.alertType as AlertRuleRecord['alertType'],
          threshold: r.threshold,
          comparison: r.comparison as AlertRuleRecord['comparison'],
          enabled: r.enabled,
          severity: r.severity as AlertRuleRecord['severity'],
          description: r.description ?? undefined,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString()
        }));
      } catch (err) {
        logger.error({ err }, 'Prisma error getAlertRules');
      }
    }
    recordReadSource('memory');
    return memoryStore.alertRules.filter((r) => r.deviceId === deviceId);
  },

  async createAlertRule(rule: Omit<AlertRuleRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<AlertRuleRecord> {
    const nowIso = new Date().toISOString();
    const created: AlertRuleRecord = {
      ...rule,
      id: `rule-${Date.now()}`,
      createdAt: nowIso,
      updatedAt: nowIso
    };

    if (isDbConnected()) {
      try {
        const r = await getPrismaClient().alertRule.create({
          data: {
            deviceId: rule.deviceId,
            alertType: rule.alertType,
            threshold: rule.threshold,
            comparison: rule.comparison,
            enabled: rule.enabled,
            severity: rule.severity,
            description: rule.description
          }
        });
        return {
          id: r.id,
          deviceId: r.deviceId,
          alertType: r.alertType as AlertRuleRecord['alertType'],
          threshold: r.threshold,
          comparison: r.comparison as AlertRuleRecord['comparison'],
          enabled: r.enabled,
          severity: r.severity as AlertRuleRecord['severity'],
          description: r.description ?? undefined,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString()
        };
      } catch (err) {
        logger.error({ err }, 'Prisma error createAlertRule');
      }
    }

    memoryStore.alertRules.push(created);
    return created;
  },

  async updateAlertRule(id: string, update: Partial<AlertRuleRecord>): Promise<AlertRuleRecord | null> {
    const nowIso = new Date().toISOString();
    if (isDbConnected()) {
      try {
        const r = await getPrismaClient().alertRule.update({
          where: { id },
          data: {
            threshold: update.threshold,
            comparison: update.comparison,
            enabled: update.enabled,
            severity: update.severity,
            description: update.description
          }
        });
        return {
          id: r.id,
          deviceId: r.deviceId,
          alertType: r.alertType as AlertRuleRecord['alertType'],
          threshold: r.threshold,
          comparison: r.comparison as AlertRuleRecord['comparison'],
          enabled: r.enabled,
          severity: r.severity as AlertRuleRecord['severity'],
          description: r.description ?? undefined,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString()
        };
      } catch (err) {
        logger.error({ err }, 'Prisma error updateAlertRule');
      }
    }

    const item = memoryStore.alertRules.find((r) => r.id === id);
    if (!item) return null;
    Object.assign(item, update, { updatedAt: nowIso });
    return item;
  },

  async createAlert(data: Omit<AlertRecord, 'id' | 'createdAt' | 'isRead'>): Promise<AlertRecord> {
    const nowIso = new Date().toISOString();
    const alert: AlertRecord = {
      ...data,
      id: `alt-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      isRead: false,
      createdAt: nowIso
    };

    if (isDbConnected()) {
      try {
        await getPrismaClient().alert.create({
          data: {
            deviceId: alert.deviceId,
            type: alert.type,
            severity: alert.severity,
            message: alert.message,
            isRead: false
          }
        });
      } catch (err) {
        logger.error({ err }, 'Prisma error createAlert');
      }
    }

    memoryStore.alerts.unshift(alert);
    return alert;
  },

  async recordRainAlert(deviceId: string, level: number | null, at: string, evidence: RainAlertEvidence | null): Promise<AlertRecord | null> {
    const evaluatedAt = new Date(at);
    if (isDbConnected()) {
      return getPrismaClient().$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO rain_alert_states ("deviceId", level, "evaluatedAt")
          VALUES (${deviceId}, 0, ${new Date(0)}) ON CONFLICT ("deviceId") DO NOTHING`;
        const [previous] = await tx.$queryRaw<Array<{ level: number; evaluatedAt: Date }>>`
          SELECT level, "evaluatedAt" FROM rain_alert_states WHERE "deviceId" = ${deviceId} FOR UPDATE`;
        if (previous.evaluatedAt >= evaluatedAt) return null;
        await tx.rainAlertState.update({
          where: { deviceId },
          data: { level: level === 0 ? 0 : Math.max(level ?? previous.level, previous.level), evaluatedAt }
        });
        if (!evidence || level === null || level <= previous.level) return null;
        const record = rainAlertRecord(deviceId, evidence, at);
        await tx.alert.create({ data: { ...record, createdAt: evaluatedAt, rainEvidence: { ...evidence } } });
        return record;
      });
    }
    const previous = rainAlertStates.get(deviceId) ?? { level: 0, at: 0 };
    if (previous.at >= evaluatedAt.getTime()) return null;
    rainAlertStates.set(deviceId, { level: level === 0 ? 0 : Math.max(level ?? previous.level, previous.level), at: evaluatedAt.getTime() });
    if (!evidence || level === null || level <= previous.level) return null;
    const record = rainAlertRecord(deviceId, evidence, at);
    memoryStore.alerts.unshift(record);
    return record;
  },

  async getAlerts(filter?: { deviceId?: string; isRead?: boolean; limit?: number }): Promise<AlertRecord[]> {
    const limit = filter?.limit || 100;
    if (isDbConnected()) {
      try {
        const list = await getPrismaClient().alert.findMany({
          where: {
            ...(filter?.deviceId ? { deviceId: filter.deviceId } : {}),
            ...(filter?.isRead !== undefined ? { isRead: filter.isRead } : {})
          },
          orderBy: { createdAt: 'desc' },
          take: limit
        });
        recordReadSource('postgresql');
        return list.map((a) => ({
          id: a.id,
          deviceId: a.deviceId,
          type: a.type as AlertRecord['type'],
          severity: a.severity as AlertRecord['severity'],
          message: a.message,
          isRead: a.isRead,
          createdAt: a.createdAt.toISOString(),
          resolvedAt: a.resolvedAt?.toISOString(),
          rainEvidence: (a.rainEvidence as unknown as RainAlertEvidence | null) ?? undefined
        }));
      } catch (err) {
        logger.error({ err }, 'Prisma error getAlerts');
      }
    }

    recordReadSource('memory');
    return memoryStore.alerts
      .filter((a) => {
        if (filter?.deviceId && a.deviceId !== filter.deviceId) return false;
        if (filter?.isRead !== undefined && a.isRead !== filter.isRead) return false;
        return true;
      })
      .slice(0, limit);
  },

  async resolveAlert(id: string): Promise<AlertRecord | null> {
    const nowIso = new Date().toISOString();
    if (isDbConnected()) {
      try {
        const a = await getPrismaClient().alert.update({
          where: { id },
          data: { isRead: true, resolvedAt: new Date() }
        });
        return {
          id: a.id,
          deviceId: a.deviceId,
          type: a.type as AlertRecord['type'],
          severity: a.severity as AlertRecord['severity'],
          message: a.message,
          isRead: a.isRead,
          createdAt: a.createdAt.toISOString(),
          resolvedAt: a.resolvedAt?.toISOString(),
          rainEvidence: (a.rainEvidence as unknown as RainAlertEvidence | null) ?? undefined
        };
      } catch (err) {
        logger.error({ err }, 'Prisma error resolveAlert');
      }
    }

    const item = memoryStore.alerts.find((a) => a.id === id);
    if (item) {
      item.isRead = true;
      item.resolvedAt = nowIso;
    }
    return item || null;
  },

  // ----------------------------------------------------
  // COMMANDS
  // ----------------------------------------------------
  async createCommand(cmd: Omit<DeviceCommandRecord, 'id' | 'createdAt'>): Promise<DeviceCommandRecord> {
    const nowIso = new Date().toISOString();
    const created: DeviceCommandRecord = {
      ...cmd,
      id: `cmd-${Date.now()}`,
      createdAt: nowIso
    };

    if (isDbConnected()) {
      try {
        await getPrismaClient().deviceCommand.create({
          data: {
            deviceId: cmd.deviceId,
            commandId: cmd.commandId,
            action: cmd.action,
            payload: cmd.payload as any,
            status: cmd.status
          }
        });
      } catch (err) {
        logger.error({ err }, 'Prisma error createCommand');
      }
    }

    memoryStore.commands.set(cmd.commandId, created);
    return created;
  },

  async updateCommandStatus(
    commandId: string,
    status: DeviceCommandRecord['status'],
    errorMessage?: string
  ): Promise<DeviceCommandRecord | null> {
    const nowIso = new Date().toISOString();
    if (isDbConnected()) {
      try {
        await getPrismaClient().deviceCommand.update({
          where: { commandId },
          data: {
            status,
            errorMessage,
            acknowledgedAt: status === 'APPLIED' || status === 'FAILED' ? new Date() : undefined
          }
        });
      } catch (err) {
        logger.error({ err }, 'Prisma error updateCommandStatus');
      }
    }

    const cmd = memoryStore.commands.get(commandId);
    if (cmd) {
      cmd.status = status;
      if (errorMessage) cmd.errorMessage = errorMessage;
      if (status === 'APPLIED' || status === 'FAILED') {
        cmd.acknowledgedAt = nowIso;
      }
    }
    return cmd || null;
  },

  async getCommands(deviceId: string): Promise<DeviceCommandRecord[]> {
    if (isDbConnected()) {
      try {
        const list = await getPrismaClient().deviceCommand.findMany({
          where: { deviceId },
          orderBy: { createdAt: 'desc' },
          take: 50
        });
        return list.map((c) => ({
          id: c.id,
          deviceId: c.deviceId,
          commandId: c.commandId,
          action: c.action as any,
          payload: c.payload as any,
          status: c.status as any,
          createdAt: c.createdAt.toISOString(),
          acknowledgedAt: c.acknowledgedAt?.toISOString(),
          errorMessage: c.errorMessage ?? undefined
        }));
      } catch (err) {
        logger.error({ err }, 'Prisma error getCommands');
      }
    }
    return Array.from(memoryStore.commands.values())
      .filter((c) => c.deviceId === deviceId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  // ----------------------------------------------------
  // ----------------------------------------------------
  // DATA PURGE / RESET
  // ----------------------------------------------------
  async clearRainEvents(deviceId?: string): Promise<void> {
    if (isDbConnected()) {
      try {
        const prisma = getPrismaClient();
        if (deviceId) {
          await prisma.rainEvent.deleteMany({ where: { deviceId } });
        } else {
          await prisma.rainEvent.deleteMany();
        }
      } catch (err) {
        logger.error({ err }, 'Prisma error clearRainEvents');
      }
    }

    if (deviceId) {
      memoryStore.rainEvents = memoryStore.rainEvents.filter((r) => r.deviceId !== deviceId);
    } else {
      memoryStore.rainEvents = [];
    }
  },

  async clearTelemetryData(deviceId?: string): Promise<void> {
    if (isDbConnected()) {
      try {
        const prisma = getPrismaClient();
        if (deviceId) {
          await prisma.measurement.deleteMany({ where: { deviceId } });
          await prisma.rainEvent.deleteMany({ where: { deviceId } });
          await prisma.alert.deleteMany({ where: { deviceId } });
          await prisma.deviceCommand.deleteMany({ where: { deviceId } });
          await prisma.device.update({
            where: { deviceId },
            data: { isOnline: false, lastSeen: null, wifiRssi: null, uptime: null }
          });
        } else {
          await prisma.measurement.deleteMany();
          await prisma.rainEvent.deleteMany();
          await prisma.alert.deleteMany();
          await prisma.deviceCommand.deleteMany();
          await prisma.device.updateMany({
            data: { isOnline: false, lastSeen: null, wifiRssi: null, uptime: null }
          });
        }
      } catch (err) {
        logger.error({ err }, 'Prisma error clearTelemetryData');
      }
    }

    if (deviceId) {
      memoryStore.measurements = memoryStore.measurements.filter((m) => m.deviceId !== deviceId);
      memoryStore.rainEvents = memoryStore.rainEvents.filter((r) => r.deviceId !== deviceId);
      memoryStore.alerts = memoryStore.alerts.filter((a) => a.deviceId !== deviceId);
      const dev = memoryStore.devices.get(deviceId);
      if (dev) {
        dev.isOnline = false;
        dev.lastSeen = undefined;
        dev.wifiRssi = undefined;
        dev.uptime = undefined;
      }
      for (const [cmdId, cmd] of memoryStore.commands.entries()) {
        if (cmd.deviceId === deviceId) {
          memoryStore.commands.delete(cmdId);
        }
      }
    } else {
      memoryStore.measurements = [];
      memoryStore.rainEvents = [];
      memoryStore.alerts = [];
      memoryStore.commands.clear();
      memoryStore.devices.forEach((dev) => {
        dev.isOnline = false;
        dev.lastSeen = undefined;
        dev.wifiRssi = undefined;
        dev.uptime = undefined;
      });
    }
    memoryStore.processedMessageIds.clear();
    logger.info({ deviceId }, 'Cleaned all fake/historical telemetry and reset hardware state for ESP32-S3');
  }
};
