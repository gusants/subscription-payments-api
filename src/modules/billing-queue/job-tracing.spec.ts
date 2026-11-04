import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import type { ReadableSpan } from '@opentelemetry/sdk-trace';
import { currentCorrelationId } from '../../shared/correlation/index.js';
import {
  startInMemoryTracing,
  type InMemoryTracing,
} from '../../shared/tracing/testing/in-memory-tracing.js';
import { processWithinJobContext, type TraceCarrier } from './job-context.js';
import { currentTraceCarrier, tracePublish } from './job-tracing.js';

const RETRY_JOB = {
  queueName: 'charge-retries',
  jobName: 'charge-retry',
  jobId: 'retry-ch_01abc-2',
};

const TRACEPARENT = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/;

describe('job tracing with tracing on', () => {
  let tracing: InMemoryTracing;

  beforeAll(() => {
    tracing = startInMemoryTracing();
  });

  afterEach(() => {
    tracing.exporter.reset();
  });

  afterAll(async () => {
    await tracing.stop();
  });

  const finishedSpan = (name: string): ReadableSpan => {
    const span = tracing.exporter
      .getFinishedSpans()
      .find((candidate) => candidate.name === name);
    if (!span) throw new Error(`span ${name} was not exported`);
    return span;
  };

  const publishWithinRequest = (): Promise<TraceCarrier | undefined> =>
    trace
      .getTracer('test')
      .startActiveSpan('POST /subscriptions', async (request) => {
        const carrier = await tracePublish(RETRY_JOB, (traceCarrier) =>
          Promise.resolve(traceCarrier),
        );
        request.end();
        return carrier;
      });

  it('injects the publish span into a W3C carrier', async () => {
    const carrier = await publishWithinRequest();

    const request = finishedSpan('POST /subscriptions');
    const publish = finishedSpan('publish charge-retries');
    expect(carrier?.['traceparent']).toMatch(TRACEPARENT);
    expect(carrier?.['traceparent']).toContain(
      `-${publish.spanContext().traceId}-${publish.spanContext().spanId}-`,
    );
    expect(publish.kind).toBe(SpanKind.PRODUCER);
    expect(publish.parentSpanContext?.spanId).toBe(
      request.spanContext().spanId,
    );
    expect(publish.attributes).toMatchObject({
      'messaging.system': 'bullmq',
      'messaging.operation.type': 'publish',
      'messaging.destination.name': 'charge-retries',
      'messaging.bullmq.job.name': 'charge-retry',
      'messaging.message.id': 'retry-ch_01abc-2',
    });
  });

  it('processes a job published without delay as a child of the span that published it', async () => {
    const traceCarrier = await publishWithinRequest();
    const job = {
      id: RETRY_JOB.jobId,
      name: RETRY_JOB.jobName,
      queueName: RETRY_JOB.queueName,
      data: { correlationId: 'cor_job_journey', traceCarrier },
    };

    const seen = await processWithinJobContext(job, () =>
      Promise.resolve({
        correlationId: currentCorrelationId(),
        spanId: trace.getActiveSpan()?.spanContext().spanId,
      }),
    );

    const publish = finishedSpan('publish charge-retries');
    const processing = finishedSpan('process charge-retries');
    expect(processing.kind).toBe(SpanKind.CONSUMER);
    expect(processing.spanContext().traceId).toBe(
      publish.spanContext().traceId,
    );
    expect(processing.parentSpanContext?.spanId).toBe(
      publish.spanContext().spanId,
    );
    expect(processing.attributes).toMatchObject({
      'messaging.operation.type': 'process',
      'messaging.message.id': 'retry-ch_01abc-2',
      'app.correlation_id': 'cor_job_journey',
    });
    expect(seen).toEqual({
      correlationId: 'cor_job_journey',
      spanId: processing.spanContext().spanId,
    });
  });

  it('processes a retry published with a delay in a trace of its own, linked to the publish span', async () => {
    const traceCarrier = await publishWithinRequest();
    const job = {
      id: RETRY_JOB.jobId,
      name: RETRY_JOB.jobName,
      queueName: RETRY_JOB.queueName,
      data: {
        correlationId: 'cor_job_journey',
        traceCarrier,
        publishDelayMs: 24 * 60 * 60 * 1000,
      },
    };

    await processWithinJobContext(job, () => Promise.resolve());

    const publish = finishedSpan('publish charge-retries');
    const processing = finishedSpan('process charge-retries');
    expect(processing.parentSpanContext).toBeUndefined();
    expect(processing.spanContext().traceId).not.toBe(
      publish.spanContext().traceId,
    );
    expect(processing.links.map(({ context }) => context)).toEqual([
      expect.objectContaining({
        traceId: publish.spanContext().traceId,
        spanId: publish.spanContext().spanId,
      }),
    ]);
    expect(processing.attributes['app.correlation_id']).toBe('cor_job_journey');
  });

  it.each([
    ['no delay', 0],
    ['a delay that is not a number', '86400000'],
  ])(
    'keeps a retry published with %s in the trace that published it',
    async (_label, publishDelayMs) => {
      const traceCarrier = await publishWithinRequest();
      const job = {
        id: RETRY_JOB.jobId,
        name: RETRY_JOB.jobName,
        queueName: RETRY_JOB.queueName,
        data: {
          correlationId: 'cor_job_journey',
          traceCarrier,
          publishDelayMs,
        },
      };

      await processWithinJobContext(job as never, () => Promise.resolve());

      const publish = finishedSpan('publish charge-retries');
      const processing = finishedSpan('process charge-retries');
      expect(processing.parentSpanContext?.spanId).toBe(
        publish.spanContext().spanId,
      );
      expect(processing.links).toEqual([]);
    },
  );

  it.each([
    ['no carrier', undefined],
    ['an unreadable traceparent', { traceparent: 'not-a-trace' }],
  ])(
    'starts an unlinked trace for a delayed job with %s',
    async (_label, traceCarrier) => {
      const job = {
        id: RETRY_JOB.jobId,
        name: RETRY_JOB.jobName,
        queueName: RETRY_JOB.queueName,
        data: { traceCarrier, publishDelayMs: 1000 } as never,
      };

      await processWithinJobContext(job, () => Promise.resolve());

      const processing = finishedSpan('process charge-retries');
      expect(processing.parentSpanContext).toBeUndefined();
      expect(processing.links).toEqual([]);
    },
  );

  it.each([
    ['a job enqueued before tracing', undefined],
    ['a null carrier', null],
    ['a carrier that is not an object', 'traceparent'],
    ['an unreadable traceparent', { traceparent: 'not-a-trace' }],
  ])('starts a new trace for %s', async (_label, traceCarrier) => {
    const job = {
      id: '1',
      name: 'reconcile-charges',
      queueName: 'charge-reconciliation',
      data: { traceCarrier } as never,
    };

    await expect(
      processWithinJobContext(job, () => Promise.resolve('done')),
    ).resolves.toBe('done');

    const processing = finishedSpan('process charge-reconciliation');
    expect(processing.parentSpanContext).toBeUndefined();
    expect(processing.attributes['app.correlation_id']).toMatch(/^cor_/);
  });

  it('marks the processing span as failed and rethrows', async () => {
    const job = {
      id: '1',
      name: 'charge-retry',
      queueName: 'charge-retries',
      data: { correlationId: 'cor_job_failure' },
    };
    const failure = new Error('gateway timed out');

    await expect(
      processWithinJobContext(job, () => Promise.reject(failure)),
    ).rejects.toBe(failure);

    const processing = finishedSpan('process charge-retries');
    expect(processing.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'gateway timed out',
    });
    expect(processing.events.map((event) => event.name)).toEqual(['exception']);
  });

  it('marks the publish span as failed when a non-error is thrown', async () => {
    await expect(
      tracePublish(RETRY_JOB, () => Promise.reject('redis down')),
    ).rejects.toBe('redis down');

    expect(finishedSpan('publish charge-retries').status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'redis down',
    });
  });

  it('has no carrier outside a span', () => {
    expect(currentTraceCarrier()).toBeUndefined();
  });
});
