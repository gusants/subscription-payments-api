import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { createAddHookMessageChannel } from 'import-in-the-middle';
import { register } from 'node:module';
import { tracedInstrumentations } from './traced-instrumentations.js';
import type { TracingSettings } from './tracing-settings.js';
import { onTracingShutdown } from './tracing-shutdown.js';

function registerEsmHookForInstrumentedModulesOnly() {
  const { registerOptions, waitForAllMessagesAcknowledged } =
    createAddHookMessageChannel();
  register('import-in-the-middle/hook.mjs', import.meta.url, registerOptions);
  return waitForAllMessagesAcknowledged;
}

export async function startTracing({
  serviceName,
}: TracingSettings): Promise<void> {
  const hookAcknowledged = registerEsmHookForInstrumentedModulesOnly();
  const sdk = new NodeSDK({
    serviceName,
    traceExporter: new OTLPTraceExporter(),
    instrumentations: tracedInstrumentations(),
    metricReaders: [],
    logRecordProcessors: [],
  });
  sdk.start();
  onTracingShutdown(() => sdk.shutdown());
  await hookAcknowledged();
}
