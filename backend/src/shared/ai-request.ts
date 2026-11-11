import { z } from 'zod';

export const deviceIdSchema = z.string().trim().min(1).max(80).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/);
export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  deviceId: deviceIdSchema,
  history: z.unknown().optional(),
  rainMonitorDemo: z.boolean().optional()
});
