import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { currentCorrelationId } from '../../../shared/correlation/index.js';
import type { BillingQueueConnection } from '../billing-queue-connection.js';
import type { ChargeRetryJobData } from '../bullmq-billing-queue.js';
import type { ChargeRetriesProcessor } from './charge-retries.processor.js';
import { ChargeRetriesWorker } from './charge-retries.worker.js';
import type { SubscriptionRenewalsProcessor } from './subscription-renewals.processor.js';
import { SubscriptionRenewalsWorker } from './subscription-renewals.worker.js';

type Handler = (...args: unknown[]) => unknown;

const bullmq = vi.hoisted(() => ({
  processors: [] as ((job: unknown) => Promise<unknown>)[],
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
}));

vi.mock('bullmq', () => ({
  Worker: class {
    constructor(_name: string, processor: (job: unknown) => Promise<unknown>) {
      bullmq.processors.push(processor);
    }
    on(event: string, handler: Handler) {
      bullmq.handlers.set(event, handler);
      return this;
    }
    close() {
      return Promise.resolve();
    }
  },
  Queue: class {
    upsertJobScheduler() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  },
}));

const connection = { redis: {} } as BillingQueueConnection;

const retryJob = (data: Partial<ChargeRetryJobData>): Job<ChargeRetryJobData> =>
  ({
    id: 'retry:ch_1:1',
    data: { chargeId: 'ch_1', attempt: 1, ...data },
    attemptsMade: 2,
    opts: { attempts: 5 },
  }) as Job<ChargeRetryJobData>;

describe('billing job workers', () => {
  beforeEach(() => {
    bullmq.processors.length = 0;
    bullmq.handlers.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ChargeRetriesWorker', () => {
    function start() {
      const seen: (string | undefined)[] = [];
      const processor = {
        process: () => {
          seen.push(currentCorrelationId());
          return Promise.resolve();
        },
      } as unknown as ChargeRetriesProcessor;
      new ChargeRetriesWorker(processor, connection).onApplicationBootstrap();
      return { seen, processJob: bullmq.processors[0]! };
    }

    it('processes a job within the correlation id it carries', async () => {
      const { seen, processJob } = start();

      await processJob(retryJob({ correlationId: 'cor_job_journey' }));

      expect(seen).toEqual(['cor_job_journey']);
    });

    it('processes a job enqueued without a correlation id within a generated one', async () => {
      const { seen, processJob } = start();

      await processJob(retryJob({}));

      expect(seen).toEqual([expect.stringMatching(/^cor_/)]);
    });

    it('reports a failed technical attempt within the correlation id of the job', () => {
      start();
      const seen: (string | undefined)[] = [];
      const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {
        seen.push(currentCorrelationId());
      });

      bullmq.handlers.get('failed')!(
        retryJob({ correlationId: 'cor_job_journey' }),
        new Error('gateway down'),
      );
      bullmq.handlers.get('failed')!(undefined, new Error('lost job'));

      expect(seen).toEqual(['cor_job_journey']);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'retry:ch_1:1',
          chargeId: 'ch_1',
          attempt: 1,
          attemptsMade: 2,
          maxAttempts: 5,
        }),
      );
    });
  });

  describe('recurring workers', () => {
    it('runs every execution within its own correlation id', async () => {
      const seen: (string | undefined)[] = [];
      const processor = {
        process: () => {
          seen.push(currentCorrelationId());
          return Promise.resolve();
        },
      } as unknown as SubscriptionRenewalsProcessor;
      await new SubscriptionRenewalsWorker(
        processor,
        connection,
        60_000,
      ).onApplicationBootstrap();
      const processJob = bullmq.processors[0]!;

      await processJob({ data: {} });
      await processJob({ data: {} });
      await processJob({ data: { correlationId: 'cor_manual_run' } });

      expect(seen).toEqual([
        expect.stringMatching(/^cor_/),
        expect.stringMatching(/^cor_/),
        'cor_manual_run',
      ]);
      expect(seen[0]).not.toBe(seen[1]);
    });
  });
});
