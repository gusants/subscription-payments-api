import { trace } from '@opentelemetry/api';
import { currentCorrelationId } from '../../shared/correlation/index.js';
import { processWithinJobContext, runWithinJobContext } from './job-context.js';
import { tracePublish } from './job-tracing.js';

describe('runWithinJobContext', () => {
  it('processes within the correlation id carried by the job', () => {
    expect(
      runWithinJobContext(
        { correlationId: 'cor_job_journey' },
        currentCorrelationId,
      ),
    ).toBe('cor_job_journey');
  });

  it.each([
    ['a job enqueued before correlation ids', {}],
    ['a job without data', undefined],
    ['a malformed id', { correlationId: 'bad id\n' }],
  ])('generates an id for %s', (_label, data) => {
    expect(runWithinJobContext(data, currentCorrelationId)).toMatch(/^cor_/);
  });

  it('gives every execution its own generated id', () => {
    const first = runWithinJobContext({}, currentCorrelationId);
    const second = runWithinJobContext({}, currentCorrelationId);

    expect(first).not.toBe(second);
  });
});

describe('processWithinJobContext with tracing off', () => {
  const job = {
    id: '1',
    name: 'charge-retry',
    queueName: 'charge-retries',
    data: { correlationId: 'cor_job_journey' },
  };

  it('runs the job within its correlation id and no span', async () => {
    const seen = await processWithinJobContext(job, () =>
      Promise.resolve({
        correlationId: currentCorrelationId(),
        span: trace.getActiveSpan(),
      }),
    );

    expect(seen).toEqual({ correlationId: 'cor_job_journey', span: undefined });
  });

  it('rethrows the failure of the job', async () => {
    const failure = new Error('boom');

    await expect(
      processWithinJobContext(job, () => Promise.reject(failure)),
    ).rejects.toBe(failure);
  });
});

describe('tracePublish with tracing off', () => {
  it('publishes without a trace carrier', async () => {
    const carrier = await tracePublish(
      { queueName: 'charge-retries', jobName: 'charge-retry' },
      (traceCarrier) => Promise.resolve(traceCarrier),
    );

    expect(carrier).toBeUndefined();
  });
});
