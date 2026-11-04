import { tracingSettingsFrom } from './shared/tracing/tracing-settings.js';

const settings = tracingSettingsFrom(process.env);

if (settings.enabled) {
  const { startTracing } = await import('./shared/tracing/start-tracing.js');
  await startTracing(settings);
}
