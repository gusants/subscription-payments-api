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
  GATEWAY_WEBHOOK_SECRET: z.string().min(32),
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
  FAKE_GATEWAY_WEBHOOK_URL: z.url().optional(),
  FAKE_GATEWAY_WEBHOOK_DELAY_MS: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(500),
  FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE: z.coerce
    .number()
    .min(0)
    .max(1)
    .default(0),
  FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED: z.stringbool().default(true),
  RETRY_INTERVAL_UNIT: z.enum(['days', 'minutes']).default('days'),
  ALLOW_ACCELERATED_RETRIES: z.stringbool().optional(),
  RENEWAL_JOB_INTERVAL_SECONDS: z.coerce.number().int().positive().optional(),
  RENEWAL_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(100),
  RECONCILIATION_JOB_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  RECONCILIATION_STALE_AFTER_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5),
  RECONCILIATION_BATCH_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .max(1000)
    .default(100),
  DEV_ROUTES_ENABLED: z.stringbool().optional(),
  WORKERS_ENABLED: z.stringbool().default(true),
  BULL_BOARD_ENABLED: z.stringbool().optional(),
  CHARGE_ATTEMPT_LEASE_SECONDS: z.coerce.number().int().positive().default(30),
  IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().positive().default(86400),
  IDEMPOTENCY_LOCK_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  LLM_PROVIDER: z.enum(['fake', 'gemini']).default('fake'),
  LLM_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(8000),
  LLM_THINKING_LEVEL: z
    .enum(['minimal', 'low', 'medium', 'high'])
    .default('minimal'),
  CUSTOMER_SUMMARY_CACHE_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(86400),
  CUSTOMER_SUMMARY_FALLBACK_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  GEMINI_API_KEY: z.string().min(1).optional(),
  OTEL_ENABLED: z.stringbool().default(false),
  OTEL_SERVICE_NAME: z.string().min(1).default('subscription-payments-api'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
});

export type Env = z.infer<typeof envSchema>;

function isUnacknowledgedAcceleratedRetries({
  NODE_ENV,
  RETRY_INTERVAL_UNIT,
  ALLOW_ACCELERATED_RETRIES,
}: Env): boolean {
  return (
    NODE_ENV === 'production' &&
    RETRY_INTERVAL_UNIT === 'minutes' &&
    !ALLOW_ACCELERATED_RETRIES
  );
}

function isGeminiWithoutApiKey({ LLM_PROVIDER, GEMINI_API_KEY }: Env): boolean {
  return LLM_PROVIDER === 'gemini' && GEMINI_API_KEY === undefined;
}

export function validateEnv(rawEnv: Record<string, unknown>): Env {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  if (isUnacknowledgedAcceleratedRetries(result.data)) {
    throw new Error(
      'Invalid environment variables:\nRETRY_INTERVAL_UNIT=minutes compresses the dunning calendar (D+1, D+3, D+7) to minutes and is refused when NODE_ENV=production; set ALLOW_ACCELERATED_RETRIES=true to run it anyway (demo only)',
    );
  }
  if (isGeminiWithoutApiKey(result.data)) {
    throw new Error(
      'Invalid environment variables:\nGEMINI_API_KEY is required when LLM_PROVIDER=gemini',
    );
  }
  return result.data;
}
