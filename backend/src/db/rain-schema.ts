import type { PrismaClient } from '@prisma/client';

/** Additive migration only: never reset, truncate or reinterpret existing rain records. */
export async function ensureRainSchema(client: PrismaClient) {
  await client.$executeRaw`ALTER TABLE rain_events ADD COLUMN IF NOT EXISTS "intervalFrom" TIMESTAMP(3)`;
  await client.$executeRaw`ALTER TABLE rain_events ADD COLUMN IF NOT EXISTS "timingQuality" TEXT NOT NULL DEFAULT 'legacy'`;
  await client.$executeRaw`ALTER TABLE rain_events ADD COLUMN IF NOT EXISTS "dataKind" TEXT NOT NULL DEFAULT 'unverified'`;
  await client.$executeRaw`ALTER TABLE rain_events ADD COLUMN IF NOT EXISTS "testNote" TEXT`;
  await client.$executeRaw`CREATE TABLE IF NOT EXISTS rain_test_periods (
    id TEXT PRIMARY KEY, "deviceId" TEXT NOT NULL, "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL, note TEXT NOT NULL, "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`;
  await client.$executeRaw`CREATE INDEX IF NOT EXISTS rain_test_periods_device_time ON rain_test_periods ("deviceId", "from", "to")`;
  await client.$executeRaw`ALTER TABLE alerts ADD COLUMN IF NOT EXISTS "rainEvidence" JSONB`;
  await client.$executeRaw`CREATE TABLE IF NOT EXISTS rain_alert_states (
    "deviceId" TEXT PRIMARY KEY, level INTEGER NOT NULL, "evaluatedAt" TIMESTAMP(3) NOT NULL)`;
}
