import type { Job } from 'bullmq';
import type { ChargeRetryRunner } from '../../charges/charge-retry-runner.js';
import type { ChargeRetryJobData } from '../bullmq-billing-queue.js';
import { ChargeRetriesProcessor } from './charge-retries.processor.js';

describe('ChargeRetriesProcessor', () => {
  const job = (data: ChargeRetryJobData) =>
    ({ data }) as Job<ChargeRetryJobData>;

  it('hands the job data to the retry runner', async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const processor = new ChargeRetriesProcessor({
      run,
    } as unknown as ChargeRetryRunner);

    await processor.process(
      job({ chargeId: 'ch_1', attempt: 2, correlationId: 'cor_test_journey' }),
    );

    expect(run).toHaveBeenCalledWith({ chargeId: 'ch_1', attempt: 2 });
  });

  it('lets a runner failure fail the job so the queue can retry it', async () => {
    const processor = new ChargeRetriesProcessor({
      run: vi.fn().mockRejectedValue(new Error('boom')),
    } as unknown as ChargeRetryRunner);

    await expect(
      processor.process(
        job({
          chargeId: 'ch_1',
          attempt: 1,
          correlationId: 'cor_test_journey',
        }),
      ),
    ).rejects.toThrow('boom');
  });
});
