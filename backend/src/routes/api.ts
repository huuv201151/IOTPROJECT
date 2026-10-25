import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { deviceController } from '../controllers/device.controller';
import { telemetryController } from '../controllers/telemetry.controller';
import { alertController } from '../controllers/alert.controller';
import { exportController } from '../controllers/export.controller';
import { demoController } from '../controllers/demo.controller';
import { aiController } from '../controllers/ai.controller';
import { systemController } from '../controllers/system.controller';
import { authenticate } from '../middleware/auth.middleware';

export const apiRouter = Router();

// Infrastructure Diagnostics (EMQX & Aiven)
apiRouter.get('/system/status', systemController.getStatus);
apiRouter.post('/system/test-db', systemController.testDatabase);
apiRouter.post('/system/test-mqtt', systemController.testMqtt);

// Authentication
apiRouter.post('/auth/login', authController.login);
apiRouter.get('/auth/me', authenticate, authController.me);

// Dashboard Summary (Main Overview landing data)
apiRouter.get('/dashboard/summary', telemetryController.getDashboardSummary);

// Devices
apiRouter.get('/devices', deviceController.getDevices);
apiRouter.post('/devices', deviceController.createDevice);
apiRouter.get('/devices/:id', deviceController.getDevice);
apiRouter.get('/devices/:id/config', deviceController.getConfig);
apiRouter.patch('/devices/:id/config', deviceController.updateConfig);
apiRouter.post('/devices/:id/command', deviceController.sendCommand);
apiRouter.get('/devices/:id/commands', deviceController.getCommands);
apiRouter.post('/devices/reset-rain', deviceController.resetRainOnly);
apiRouter.post('/devices/:id/reset-rain', deviceController.resetRainOnly);
apiRouter.post('/devices/:id/reset-data', deviceController.resetData);

// Telemetry & Environmental Analytics
apiRouter.get('/devices/:id/latest', telemetryController.getLatest);
apiRouter.get('/devices/:id/measurements', telemetryController.getSeries);
apiRouter.get('/devices/:id/statistics', telemetryController.getEnvironmentalSummary);

// Rainfall Analytics
apiRouter.get('/devices/:id/rainfall', telemetryController.getRainfallStats);
apiRouter.get('/devices/:id/hourly-rain', telemetryController.getHourlyRain);
apiRouter.get('/devices/:id/daily-rain', telemetryController.getDailyRain);

// Alerts & Notification Center
apiRouter.get('/alerts', alertController.getAlerts);
apiRouter.patch('/alerts/:id/resolve', alertController.resolveAlert);
apiRouter.get('/alerts/rules/:deviceId', alertController.getRules);
apiRouter.post('/alerts/rules', alertController.createRule);
apiRouter.patch('/alerts/rules/:id', alertController.updateRule);

// Historical Export
apiRouter.get('/export', exportController.exportCsv);

// Demo Mode & Simulator Controls
apiRouter.get('/demo/mode', demoController.getMode);
apiRouter.post('/demo/toggle', demoController.toggleMode);
apiRouter.post('/demo/simulate-tip', demoController.simulateTip);

// RainSense AI Assistant
apiRouter.post('/ai/chat', aiController.chat);
apiRouter.get('/ai/context', aiController.getContext);
apiRouter.get('/ai/config', aiController.getConfig);
apiRouter.post('/ai/config', aiController.updateConfig);
apiRouter.post('/ai/test', aiController.testKey);
