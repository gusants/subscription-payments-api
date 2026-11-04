import { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  BILLING_DEFAULT_JOB_OPTIONS,
  BULLMQ_PRODUCER_REDIS_OPTIONS,
  BULLMQ_REDIS_OPTIONS,
  ENQUEUE_TIMEOUT_MS,
  TECHNICAL_RETRY_ATTEMPTS,
  TECHNICAL_RETRY_BACKOFF_MS,
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

  it('promotes every delayed retry and reports how many it moved', async () => {
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: FAR_FUTURE_MS,
    });
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01def',
      attempt: 2,
      delayMs: FAR_FUTURE_MS,
    });

    const promoted = await billingQueue.promoteDelayedRetries();

    expect(promoted).toBe(2);
    expect(await queue.getDelayedCount()).toBe(0);
    expect(await queue.getWaitingCount()).toBe(2);
  });

  it('promotes nothing when no retry is delayed', async () => {
    expect(await billingQueue.promoteDelayedRetries()).toBe(0);
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

  it('promotes the already scheduled job when asked to run now instead of duplicating it', async () => {
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: FAR_FUTURE_MS,
    });

    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: 0,
    });

    const job = await queue.getJob(retryJobId('ch_01abc', 1));
    expect(await job?.getState()).toBe('waiting');
    expect(await queue.getJobCountByTypes('delayed', 'waiting')).toBe(1);
  });

  it('gives retry jobs technical attempts with exponential backoff', async () => {
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: FAR_FUTURE_MS,
    });

    const job = await queue.getJob(retryJobId('ch_01abc', 1));

    expect(job?.opts).toMatchObject({
      attempts: TECHNICAL_RETRY_ATTEMPTS,
      backoff: { type: 'exponential', delay: TECHNICAL_RETRY_BACKOFF_MS },
    });
  });

  it('re-runs a job that throws with backoff and keeps it as failed once the attempts are exhausted', async () => {
    let runs = 0;
    workers.push(
      new Worker<ChargeRetryJobData>(
        queueName,
        async () => {
          runs += 1;
          throw new Error('gateway unavailable');
        },
        { connection, prefix: 'bull-test' },
      ),
    );

    await queue.add(
      'charge-retry',
      { chargeId: 'ch_01abc', attempt: 1 },
      {
        jobId: 'retry:ch_01abc:1',
        attempts: 3,
        backoff: { type: 'exponential', delay: 20 },
      },
    );

    await vi.waitFor(
      async () => {
        const job = await queue.getJob('retry:ch_01abc:1');
        expect(await job?.getState()).toBe('failed');
      },
      { timeout: 10_000 },
    );
    expect(runs).toBe(3);
    expect(await queue.getFailedCount()).toBe(1);
  });

  async function runWorkerUntil(
    state: 'failed' | 'completed',
    processor: () => Promise<void>,
  ): Promise<void> {
    const worker = new Worker<ChargeRetryJobData>(queueName, processor, {
      connection,
      prefix: 'bull-test',
    });
    workers.push(worker);
    await vi.waitFor(
      async () => {
        const job = await queue.getJob('retry:ch_01abc:1');
        expect(await job?.getState()).toBe(state);
      },
      { timeout: 10_000 },
    );
    await worker.close();
  }

  it('re-runs a failed job when the same retry is scheduled again, with its attempts reset', async () => {
    await queue.add(
      'charge-retry',
      { chargeId: 'ch_01abc', attempt: 1 },
      { jobId: 'retry:ch_01abc:1', attempts: 1 },
    );
    await runWorkerUntil('failed', () =>
      Promise.reject(new Error('gateway unavailable')),
    );

    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: FAR_FUTURE_MS,
    });

    const job = await queue.getJob('retry:ch_01abc:1');
    expect(await job?.getState()).toBe('waiting');
    expect(job?.attemptsMade).toBe(0);
    expect(await queue.getFailedCount()).toBe(0);
  });

  it('runs a completed retry again when the charge still needs that attempt', async () => {
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: 0,
    });
    await runWorkerUntil('completed', () => Promise.resolve());

    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: 0,
    });

    const job = await queue.getJob('retry:ch_01abc:1');
    expect(await job?.getState()).toBe('waiting');
    expect(await queue.getJobCountByTypes('completed', 'waiting')).toBe(1);
  });

  it('leaves a retry that is already waiting or delayed untouched', async () => {
    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: FAR_FUTURE_MS,
    });
    const before = await queue.getJob('retry:ch_01abc:1');

    await billingQueue.scheduleRetry({
      chargeId: 'ch_01abc',
      attempt: 1,
      delayMs: FAR_FUTURE_MS,
    });

    const after = await queue.getJob('retry:ch_01abc:1');
    expect(after?.timestamp).toBe(before?.timestamp);
    expect(await after?.getState()).toBe('delayed');
  });

  describe('with Redis down', () => {
    const UNREACHABLE_PORT = 1;
    let downConnection: Redis;
    let downQueue: Queue<ChargeRetryJobData>;

    beforeEach(() => {
      downConnection = createRedisConnection({
        host: '127.0.0.1',
        port: UNREACHABLE_PORT,
        ...BULLMQ_PRODUCER_REDIS_OPTIONS,
      });
      downQueue = new Queue<ChargeRetryJobData>(queueName, {
        connection: downConnection,
        prefix: 'bull-test',
      });
      downQueue.on('error', () => undefined);
    });

    afterEach(async () => {
      downConnection.disconnect();
      await downQueue.close().catch(() => undefined);
    });

    it('rejects the enqueue within the enqueue timeout instead of hanging', async () => {
      const startedAt = Date.now();

      await expect(
        new BullMqBillingQueue(downQueue).scheduleRetry({
          chargeId: 'ch_01abc',
          attempt: 1,
          delayMs: FAR_FUTURE_MS,
        }),
      ).rejects.toThrow();

      expect(Date.now() - startedAt).toBeLessThanOrEqual(
        ENQUEUE_TIMEOUT_MS + 500,
      );
    });
  });
});
