import type { HttpInstrumentationConfig } from '@opentelemetry/instrumentation-http';
import type { IncomingMessage } from 'node:http';
import { REDACTED } from '../logging/redact-paths.js';
import {
  redactedQueryAttributes,
  tracedInstrumentations,
} from './traced-instrumentations.js';

describe('tracedInstrumentations', () => {
  const instrumentations = tracedInstrumentations();

  afterAll(() => {
    instrumentations.forEach((instrumentation) => instrumentation.disable());
  });

  it('traces http, express, pg and ioredis only', () => {
    expect(
      instrumentations.map(({ instrumentationName }) => instrumentationName),
    ).toEqual([
      '@opentelemetry/instrumentation-http',
      '@opentelemetry/instrumentation-express',
      '@opentelemetry/instrumentation-pg',
      '@opentelemetry/instrumentation-ioredis',
    ]);
  });

  it('leaves the health probe out of the traces', () => {
    const { ignoreIncomingRequestHook } =
      instrumentations[0]!.getConfig() as HttpInstrumentationConfig;
    const ignores = (url: string | undefined) =>
      ignoreIncomingRequestHook?.({ url } as IncomingMessage);

    expect(ignores('/health')).toBe(true);
    expect(ignores('/subscriptions')).toBe(false);
    expect(ignores(undefined)).toBe(false);
  });

  it('replaces the query of an incoming request', () => {
    const { startIncomingSpanHook } =
      instrumentations[0]!.getConfig() as HttpInstrumentationConfig;
    const attributesFor = (url: string | undefined) =>
      redactedQueryAttributes({ url } as IncomingMessage);

    expect(startIncomingSpanHook).toBe(redactedQueryAttributes);
    expect(attributesFor('/customers?search=ana%40example.com')).toEqual({
      'url.query': REDACTED,
    });
    expect(attributesFor('/customers')).toEqual({});
    expect(attributesFor(undefined)).toEqual({});
  });

  it('records database and redis calls only inside a traced operation', () => {
    expect(instrumentations.slice(2).map((it) => it.getConfig())).toEqual([
      expect.objectContaining({
        requireParentSpan: true,
        ignoreConnectSpans: true,
      }),
      expect.objectContaining({ requireParentSpan: true }),
    ]);
  });
});
