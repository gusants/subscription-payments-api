import { tracingSettingsFrom } from './tracing-settings.js';

describe('tracingSettingsFrom', () => {
  it('keeps tracing off when nothing is set', () => {
    expect(tracingSettingsFrom({})).toEqual({
      enabled: false,
      serviceName: 'subscription-payments-api',
    });
  });

  it.each([
    ['true', true],
    ['false', false],
    ['1', true],
    ['0', false],
  ])(
    'reads OTEL_ENABLED=%s as the env schema does',
    (OTEL_ENABLED, enabled) => {
      expect(tracingSettingsFrom({ OTEL_ENABLED }).enabled).toBe(enabled);
    },
  );

  it('takes the service name from OTEL_SERVICE_NAME', () => {
    expect(
      tracingSettingsFrom({
        OTEL_ENABLED: 'true',
        OTEL_SERVICE_NAME: 'payments-worker',
      }),
    ).toEqual({ enabled: true, serviceName: 'payments-worker' });
  });

  it.each([
    ['an unreadable flag', { OTEL_ENABLED: 'sometimes' }],
    [
      'an endpoint that is not a URL',
      { OTEL_EXPORTER_OTLP_ENDPOINT: 'not a url' },
    ],
  ])('refuses to boot with %s', (_label, rawEnv) => {
    expect(() => tracingSettingsFrom(rawEnv)).toThrow();
  });

  it('ignores the variables that tracing does not own', () => {
    expect(() =>
      tracingSettingsFrom({ DATABASE_URL: 'not-a-url', PORT: 'abc' }),
    ).not.toThrow();
  });
});
