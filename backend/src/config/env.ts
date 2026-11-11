import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { z } from 'zod';

// Load .env from root or local workspace directory
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(__dirname, '../../../../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../.env')
];

for (const envPath of envCandidates) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}
dotenv.config();

const StationProfileSchema = z.object({
  environmentSensors: z.enum(['unknown', 'bme280', 'bmp180-dht11']).default('unknown'),
  hardwareVariant: z.enum(['unknown', 'oled-s3', 'rainsense-s3']).default('unknown'),
  wiringVerified: z.boolean().default(false),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  elevationMeters: z.number().min(-500).max(9000).optional()
}).refine((p) => (p.latitude === undefined) === (p.longitude === undefined), 'Cần cả latitude và longitude');

const StationProfilesSchema = z.string().default('{}').transform((text, ctx) => {
  try { return JSON.parse(text) as unknown; }
  catch { ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'AI_STATION_PROFILES phải là JSON hợp lệ' }); return z.NEVER; }
}).pipe(z.record(StationProfileSchema));

const EnvSchema = z.object({
  PORT: z.string().default('5000').transform((val) => parseInt(val, 10)),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  // Aiven PostgreSQL Database Connection URI
  // Example for Aiven: postgresql://avnadmin:SECRET_PASSWORD@pg-cluster.aivencloud.com:12345/defaultdb?sslmode=require
  DATABASE_URL: z
    .string()
    .default('postgresql://postgres:postgres@localhost:5432/rainsense?sslmode=disable'),

  // EMQX MQTT Broker Configuration
  // Examples:
  // - EMQX Public Test Broker: mqtt://broker.emqx.io:1883
  // - EMQX Cloud (TLS): mqtts://your-instance.emqx.cloud:8883 (or tls://...)
  // - EMQX Local Docker: mqtt://localhost:1883
  MQTT_BROKER_URL: z.string().default('mqtt://broker.emqx.io:1883'),
  MQTT_USERNAME: z.string().optional().default(''),
  MQTT_PASSWORD: z.string().optional().default(''),
  MQTT_CLIENT_ID: z.string().default('rainsense-backend-server'),
  MQTT_TOPIC_PREFIX: z.string().default('weather'),
  MQTT_REJECT_UNAUTHORIZED: z
    .string()
    .default('false')
    .transform((val) => val.toLowerCase() === 'true' || val === '1'),
  MQTT_CA_CERT: z.string().optional().default(''),
  MQTT_KEEPALIVE: z.string().default('60').transform((val) => parseInt(val, 10)),
  MQTT_CONNECT_TIMEOUT: z.string().default('10000').transform((val) => parseInt(val, 10)),

  // Security & Authentication
  JWT_SECRET: z.string().min(16).default('rainsense_super_secure_jwt_secret_key_at_least_32_characters'),
  ADMIN_EMAIL: z.string().email().default('admin@rainsense.io'),
  ADMIN_PASSWORD: z.string().min(6).default('Admin@123456'),

  // Application Modes
  DEMO_MODE: z.string().default('false').transform((val) => val === 'true' || val === '1'),
  CORS_ORIGIN: z.string().default('http://localhost:3000,http://127.0.0.1:3000'),

  // Station Default Configuration
  DEFAULT_STATION_ID: z.string().default('RS-ESP32S3-01'),
  DEFAULT_CALIBRATION_MM_PER_TIP: z.string().default('0.25').transform((val) => parseFloat(val)),
  DEFAULT_TIMEZONE: z.string().default('Asia/Ho_Chi_Minh'),
  GEMINI_API_KEY: z.string().optional().default(''),
  GEMINI_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).default('gemini-3.5-flash-lite'),
  GEMINI_FALLBACK_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).default('gemini-3.8-flash'),
  AI_STATION_PROFILES: StationProfilesSchema,
  AI_FORECAST_ENABLED: z.string().default('true').transform((s) => s === 'true' || s === '1'),
  OPEN_METEO_API_KEY: z.string().default(''),
  RAIN_MODEL_FILE: z.string().default('')
});

export const env = EnvSchema.parse(process.env);
