import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { deviceController } from '../controllers/device.controller';
import { telemetryController } from '../controllers/telemetry.controller';
import { alertController } from '../controllers/alert.controller';
import { exportController } from '../controllers/export.controller';
import { demoController } from '../controllers/demo.controller';
import { getObservationSeries } from '../controllers/observation-series.controller';
import { systemController } from '../controllers/system.controller';
import { authenticate } from '../middleware/auth.middleware';
import { rainAuditController } from '../controllers/rain-audit.controller';
import { rainMonitorService } from '../services/rain-monitor.service';
import { deviceIdSchema } from '../shared/schemas/device.schema';

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
apiRouter.get('/devices/:id/rain-monitor', async (req, res) => {
  const station = deviceIdSchema.safeParse(req.params.id);
  if (!station.success) return res.status(400).json({ success: false, error: 'Mã trạm không hợp lệ' });
  try {
    const isDemo = req.query.demo === '1' ? true : undefined;
    const scenario = typeof req.query.scenario === 'string' ? req.query.scenario : undefined;
    const data = await rainMonitorService.getSnapshot(station.data, new Date(), isDemo, scenario);
    if (!data) return res.status(404).json({ success: false, error: 'Không tìm thấy trạm' });
    return res.json({ success: true, data });
  } catch {
    return res.status(503).json({ success: false, error: 'Chưa đọc được dữ liệu cảnh báo mưa của trạm' });
  }
});
apiRouter.get('/devices/:id/hourly-rain', telemetryController.getHourlyRain);
apiRouter.get('/devices/:id/daily-rain', telemetryController.getDailyRain);
apiRouter.get('/devices/:id/rain-audit', rainAuditController.list);
apiRouter.post('/devices/:id/rain-test-periods', authenticate, rainAuditController.create);
apiRouter.post('/devices/:id/rain-test-periods/all-recorded', authenticate, rainAuditController.markAllRecorded);
apiRouter.patch('/devices/:id/rain-test-periods/:periodId/stop', authenticate, rainAuditController.stop);

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

// Historical observations used for offline model training.
apiRouter.get('/ai/series', getObservationSeries);
