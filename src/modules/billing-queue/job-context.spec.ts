import { currentCorrelationId } from '../../shared/correlation/index.js';
import { runWithinJobContext } from './job-context.js';

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
