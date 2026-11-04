import { envSchema } from '../config/env.schema.js';

const tracingEnvSchema = envSchema.pick({
  OTEL_ENABLED: true,
  OTEL_SERVICE_NAME: true,
  OTEL_EXPORTER_OTLP_ENDPOINT: true,
});

export interface TracingSettings {
  enabled: boolean;
  serviceName: string;
}

export function tracingSettingsFrom(
  rawEnv: Record<string, unknown>,
): TracingSettings {
  const { OTEL_ENABLED, OTEL_SERVICE_NAME } = tracingEnvSchema.parse(rawEnv);
  return { enabled: OTEL_ENABLED, serviceName: OTEL_SERVICE_NAME };
}
