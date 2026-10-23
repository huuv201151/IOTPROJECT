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
    .default('true')
    .transform((val) => val.toLowerCase() !== 'false' && val !== '0'),
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
  GEMINI_MODEL: z.string().optional().default('gemini-3.5-flash')
});

export const env = EnvSchema.parse(process.env);
