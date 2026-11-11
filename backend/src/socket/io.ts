import { Server as HttpServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import {
  MeasurementRecord,
  TelemetryPayload,
  RainEventRecord,
  RainfallStatistics,
  AlertRecord,
  DeviceCommandRecord
} from '../shared';
import { logger } from '../utils/logger';

let ioInstance: SocketIOServer | null = null;

export function initSocketIO(server: HttpServer, corsOrigin: string): SocketIOServer {
  const allowedOrigins = corsOrigin.split(',').map((s) => s.trim());

  ioInstance = new SocketIOServer(server, {
    cors: {
      origin: allowedOrigins.includes('*') ? true : allowedOrigins,
      methods: ['GET', 'POST'],
      credentials: true
    },
    pingInterval: 10000,
    pingTimeout: 5000
  });

  ioInstance.on('connection', (socket) => {
    logger.info({ socketId: socket.id }, 'Socket.IO client connected');

    socket.on('join:station', (deviceId: string) => {
      socket.join(`station:${deviceId}`);
      logger.debug({ socketId: socket.id, deviceId }, 'Socket joined station room');
    });

    socket.on('leave:station', (deviceId: string) => {
      socket.leave(`station:${deviceId}`);
    });

    socket.on('disconnect', (reason) => {
      logger.info({ socketId: socket.id, reason }, 'Socket.IO client disconnected');
    });
  });

  return ioInstance;
}

export function getSocketIO(): SocketIOServer | null {
  return ioInstance;
}

export function emitTelemetryUpdate(
  deviceId: string,
  measurement: MeasurementRecord,
  latest: TelemetryPayload
) {
  if (!ioInstance) return;
  ioInstance.to(`station:${deviceId}`).emit('telemetry:update', { deviceId, measurement, latest });
  ioInstance.emit('telemetry:broadcast', { deviceId, measurement, latest });
}

export function emitRainUpdate(
  deviceId: string,
  rainEvent: RainEventRecord | null,
  statistics: RainfallStatistics,
  broadcastGlobal: boolean = true
) {
  if (!ioInstance) return;
  ioInstance.to(`station:${deviceId}`).emit('rain:update', { deviceId, rainEvent, statistics });
  if (broadcastGlobal) {
    ioInstance.emit('rain:broadcast', { deviceId, rainEvent, statistics });
  }
}

export function emitDeviceStatus(
  deviceId: string,
  isOnline: boolean,
  lastSeen: string,
  wifiRssi?: number
) {
  if (!ioInstance) return;
  ioInstance.to(`station:${deviceId}`).emit('device:status', { deviceId, isOnline, lastSeen, wifiRssi });
  ioInstance.emit('device:status:all', { deviceId, isOnline, lastSeen, wifiRssi });
}

export function emitNewAlert(alert: AlertRecord) {
  if (!ioInstance) return;
  ioInstance.emit('alert:new', alert);
}

export function emitCommandStatus(command: DeviceCommandRecord) {
  if (!ioInstance) return;
  ioInstance.to(`station:${command.deviceId}`).emit('command:status', command);
  ioInstance.emit('command:status', command);
}
