import { envSchema, type Env } from '../../shared/config/env.schema.js';

const flagsEnvSchema = envSchema.pick({
  NODE_ENV: true,
  WORKERS_ENABLED: true,
  BULL_BOARD_ENABLED: true,
});

type FlagsEnv = Pick<
  Env,
  'NODE_ENV' | 'WORKERS_ENABLED' | 'BULL_BOARD_ENABLED'
>;

export function areBillingWorkersEnabled(
  env: Record<string, unknown>,
): boolean {
  const { WORKERS_ENABLED }: FlagsEnv = flagsEnvSchema.parse(env);
  return WORKERS_ENABLED;
}

export function isBullBoardEnabled(env: Record<string, unknown>): boolean {
  const { NODE_ENV, BULL_BOARD_ENABLED }: FlagsEnv = flagsEnvSchema.parse(env);
  const enabledByDefault = NODE_ENV !== 'production';
  return BULL_BOARD_ENABLED ?? enabledByDefault;
}
