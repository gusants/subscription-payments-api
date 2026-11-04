import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  BILLING_DEFAULT_JOB_OPTIONS,
  BULLMQ_REDIS_OPTIONS,
} from '../../src/modules/billing-queue/billing-queue.options.js';
import { BullMqBillingQueue } from '../../src/modules/billing-queue/bullmq-billing-queue.js';
import type { ChargeRetryJobData } from '../../src/modules/billing-queue/bullmq-billing-queue.js';
import { retryJobId } from '../../src/modules/billing-queue/domain/retry-schedule.js';
import { createRedisConnection } from '../../src/shared/redis/create-redis-connection.js';

const FAR_FUTURE_MS = 60 * 60 * 1000;

describe('BullMqBillingQueue (integration)', () => {
  let connection: Redis;
  let queue: Queue<ChargeRetryJobData>;
  let billingQueue: BullMqBillingQueue;
  let queueName: string;
  const workers: Worker[] = [];

  beforeEach(() => {
    queueName = `charge-retries-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    connection = createRedisConnection({
      host: process.env['REDIS_HOST']!,
      port: Number(process.env['REDIS_PORT']),
      ...BULLMQ_REDIS_OPTIONS,
    });
    queue = new Queue<ChargeRetryJobData>(queueName, {
      connection,
      prefix: 'bull-test',
      defaultJobOptions: BILLING_DEFAULT_JOB_OPTIONS,
    });
    billingQueue = new BullMqBillingQueue(queue);
  });

  afterEach(async () => {
    await Promise.all(workers.splice(0).map((worker) => worker.close()));
    await queue.obliterate({ force: true });
    await queue.close();
    await connection.quit();
  });

  it('stores a delayed job under the deterministic colon-separated id', async () => {
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: FAR_FUTURE_MS,
    });

    const job = await queue.getJob(retryJobId('ch_01abc', 1));

    expect(job?.id).toBe('retry:ch_01abc:1');
    expect(job?.data).toEqual({ chargeId: 'ch_01abc', attempt: 1 });
    expect(await job?.getState()).toBe('delayed');
    expect(await queue.getDelayedCount()).toBe(1);
  });

  it('never schedules the same charge and attempt twice', async () => {
    const request = {
      chargeId: 'ch_01abc',
      attempt: 2,
      delayMs: FAR_FUTURE_MS,
    };

    await Promise.all([
      billingQueue.scheduleRetry(request),
      billingQueue.scheduleRetry(request),
    ]);
    await billingQueue.scheduleRetry(request);

    expect(await queue.getJobCountByTypes('delayed', 'waiting')).toBe(1);
  });

  it('keeps different attempts of the same charge as distinct jobs', async () => {
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: FAR_FUTURE_MS,
    });
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 2,
      delayMs: FAR_FUTURE_MS,
    });

    expect(await queue.getDelayedCount()).toBe(2);
  });

  it('delivers the job to a worker with its id and data once the delay elapses', async () => {
    const processed = new Promise<{ id?: string; data: ChargeRetryJobData }>(
      (resolve) => {
        workers.push(
          new Worker<ChargeRetryJobData>(
            queueName,
            async (job) => {
              resolve({ id: job.id, data: job.data });
            },
            { connection, prefix: 'bull-test' },
          ),
        );
      },
    );
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 3,
      delayMs: 0,
    });

    expect(await processed).toEqual({
      id: 'retry:ch_01abc:3',
      data: { chargeId: 'ch_01abc', attempt: 3 },
    });
  });
});
