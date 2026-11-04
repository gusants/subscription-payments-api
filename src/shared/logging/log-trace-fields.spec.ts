import { context, trace } from '@opentelemetry/api';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { runWithCorrelationId } from '../correlation/index.js';
import {
  startInMemoryTracing,
  type InMemoryTracing,
} from '../tracing/testing/in-memory-tracing.js';
import { buildPinoHttpOptions, logContextMixin } from './pino-http-options.js';

function collectingLogger() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      done();
    },
  });
  const { mixin, level } = buildPinoHttpOptions({
    nodeEnv: 'production',
    level: 'info',
  });
  return { lines, logger: pino({ mixin, level }, destination) };
}

describe('log context with tracing on', () => {
  let tracing: InMemoryTracing;

  beforeAll(() => {
    tracing = startInMemoryTracing();
  });

  afterAll(async () => {
    await tracing.stop();
  });

  it('stamps the active trace and span ids next to the correlation id', () => {
    const { lines, logger } = collectingLogger();

    const span = trace.getTracer('test').startActiveSpan('work', (active) => {
      runWithCorrelationId('journey-0001', () => logger.info('inside'));
      active.end();
      return active;
    });
    logger.info('outside');

    const { traceId, spanId } = span.spanContext();
    expect(lines[0]).toMatchObject({
      msg: 'inside',
      correlationId: 'journey-0001',
      trace_id: traceId,
      span_id: spanId,
    });
    expect(lines[1]).not.toHaveProperty('trace_id');
    expect(lines[1]).not.toHaveProperty('span_id');
  });

  it('leaves out an invalid span context', () => {
    const invalid = trace.wrapSpanContext({
      traceId: '0'.repeat(32),
      spanId: '0'.repeat(16),
      traceFlags: 0,
    });

    expect(
      context.with(trace.setSpan(context.active(), invalid), logContextMixin),
    ).toEqual({});
  });
});
