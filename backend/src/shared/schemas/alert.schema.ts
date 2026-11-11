import { z } from 'zod';

const AlertRuleSchema = z.object({
  deviceId: z.string().min(1),
  alertType: z.enum([
    'HEAVY_RAIN',
    'RAIN_ACCUMULATION',
    'HIGH_TEMPERATURE',
    'LOW_TEMPERATURE',
    'HIGH_HUMIDITY',
    'LOW_HUMIDITY',
    'DEVICE_OFFLINE',
    'MISSING_TELEMETRY',
    'SENSOR_ERROR',
    'MQTT_FAILURE'
  ]),
  threshold: z.number(),
  comparison: z.enum(['GREATER_THAN', 'LESS_THAN']),
  enabled: z.boolean().default(true),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  description: z.string().optional()
});

export const AlertRuleCreateSchema = AlertRuleSchema.refine((rule) => {
  if (rule.alertType !== 'RAIN_ACCUMULATION') return true;
  return rule.comparison === 'GREATER_THAN' && rule.threshold > 0;
}, { message: 'Ngưỡng mưa 60 phút phải là số mm dương, dùng so sánh lớn hơn.' });

export const AlertRuleUpdateSchema = AlertRuleSchema.partial();
