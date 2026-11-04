import { envSchema, type Env } from '../../shared/config/env.schema.js';

const routeEnvSchema = envSchema.pick({
  NODE_ENV: true,
  PAYMENT_GATEWAY: true,
  FAKE_GATEWAY_ROUTES_ENABLED: true,
});

export function isFakeGatewayControllerEnabled(
  env: Record<string, unknown>,
): boolean {
  const {
    NODE_ENV,
    PAYMENT_GATEWAY,
    FAKE_GATEWAY_ROUTES_ENABLED,
  }: Pick<Env, 'NODE_ENV' | 'PAYMENT_GATEWAY' | 'FAKE_GATEWAY_ROUTES_ENABLED'> =
    routeEnvSchema.parse(env);
  const enabledByDefault = NODE_ENV !== 'production';
  return (
    PAYMENT_GATEWAY === 'fake' &&
    (FAKE_GATEWAY_ROUTES_ENABLED ?? enabledByDefault)
  );
}
