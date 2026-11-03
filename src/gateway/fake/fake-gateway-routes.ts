import { envSchema, type Env } from '../../shared/config/env.schema.js';

const routeEnvSchema = envSchema.pick({
  NODE_ENV: true,
  PAYMENT_GATEWAY: true,
});

export function isFakeGatewayControllerEnabled(
  env: Record<string, unknown>,
): boolean {
  const {
    NODE_ENV,
    PAYMENT_GATEWAY,
  }: Pick<Env, 'NODE_ENV' | 'PAYMENT_GATEWAY'> = routeEnvSchema.parse(env);
  return NODE_ENV !== 'production' && PAYMENT_GATEWAY === 'fake';
}
