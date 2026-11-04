import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  DATABASE_URL: z.url(),
  REDIS_HOST: z.string().min(1),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  PAYMENT_GATEWAY: z.enum(['fake']).default('fake'),
  FAKE_GATEWAY_DATA_FILE: z.string().min(1).default('data/fake-gateway.json'),
  FAKE_GATEWAY_ROUTES_ENABLED: z.stringbool().optional(),
  FAKE_GATEWAY_PIX_EXPIRATION_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(1800),
  FAKE_GATEWAY_BOLETO_EXPIRATION_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(259200),
  FAKE_GATEWAY_EXPIRATION_SWEEP_INTERVAL_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(5000),
  CHARGE_ATTEMPT_LEASE_SECONDS: z.coerce.number().int().positive().default(30),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(rawEnv: Record<string, unknown>): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  return result.data;
}
