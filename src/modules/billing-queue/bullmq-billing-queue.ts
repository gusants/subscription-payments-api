import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { withTimeout } from '../../shared/async/with-timeout.js';
import {
  BillingQueue,
  RETRY_SCHEDULING,
  type ChargeRetryRequest,
  type RetryScheduling,
} from './billing-queue.port.js';
import { CHARGE_RETRIES_QUEUE } from './billing-queue.constants.js';
import {
  CHARGE_RETRY_JOB_OPTIONS,
  ENQUEUE_TIMEOUT_MS,
} from './billing-queue.options.js';
import { retryJobId } from './domain/retry-job-id.js';
import type { JobContext } from './job-context.js';
import { tracePublish } from './job-tracing.js';

export const CHARGE_RETRY_JOB_NAME = 'charge-retry';

export interface ChargeRetryJobData extends JobContext {
  chargeId: string;
  attempt: number;
  publicationId?: string;
}

async function promoteIfStillDelayed(job: Job): Promise<boolean> {
  try {
    await job.promote();
    return true;
  } catch {
    return false;
  }
}

async function rerunIfStillFailed(job: Job): Promise<boolean> {
  try {
    await job.retry('failed', { resetAttemptsMade: true });
    return true;
  } catch {
    return false;
  }
}

@Injectable()
export class BullMqBillingQueue extends BillingQueue {
  constructor(
    @InjectQueue(CHARGE_RETRIES_QUEUE)
    private readonly chargeRetries: Queue<ChargeRetryJobData>,
  ) {
    super();
  }

  scheduleRetry({
    chargeId,
    attempt,
    delayMs,
    correlationId,
  }: ChargeRetryRequest): Promise<RetryScheduling> {
    return withTimeout(
      this.enqueue(
        { chargeId, attempt, correlationId, publicationId: randomUUID() },
        delayMs,
      ),
      ENQUEUE_TIMEOUT_MS,
    );
  }

  async promoteDelayedRetries(): Promise<number> {
    const delayed = await this.chargeRetries.getDelayed();
    const promotions = await Promise.all(delayed.map(promoteIfStillDelayed));
    return promotions.filter(Boolean).length;
  }

  private enqueue(
    data: ChargeRetryJobData,
    delayMs: number,
  ): Promise<RetryScheduling> {
    const jobId = retryJobId(data.chargeId, data.attempt);
    return tracePublish(
      {
        queueName: CHARGE_RETRIES_QUEUE,
        jobName: CHARGE_RETRY_JOB_NAME,
        jobId,
      },
      (traceCarrier) =>
        this.publish(
          jobId,
          {
            ...data,
            ...(traceCarrier && { traceCarrier }),
            ...(delayMs > 0 && { publishDelayMs: delayMs }),
          },
          delayMs,
        ),
    );
  }

  private async publish(
    jobId: string,
    data: ChargeRetryJobData,
    delayMs: number,
  ): Promise<RetryScheduling> {
    await this.discardCompletedJob(jobId);
    const job = await this.chargeRetries.add(CHARGE_RETRY_JOB_NAME, data, {
      ...CHARGE_RETRY_JOB_OPTIONS,
      jobId,
      delay: delayMs,
    });
    if (await job.isFailed()) {
      return (await rerunIfStillFailed(job))
        ? RETRY_SCHEDULING.rerun
        : RETRY_SCHEDULING.alreadyScheduled;
    }
    if (delayMs === 0 && (await job.isDelayed())) {
      return (await promoteIfStillDelayed(job))
        ? RETRY_SCHEDULING.promoted
        : RETRY_SCHEDULING.alreadyScheduled;
    }
    return (await this.wasStoredBy(data, jobId))
      ? RETRY_SCHEDULING.enqueued
      : RETRY_SCHEDULING.alreadyScheduled;
  }

  private async wasStoredBy(
    { publicationId }: ChargeRetryJobData,
    jobId: string,
  ): Promise<boolean> {
    const stored = await this.chargeRetries.getJob(jobId);
    return stored === undefined || stored.data.publicationId === publicationId;
  }

  private async discardCompletedJob(jobId: string): Promise<void> {
    const existing = await this.chargeRetries.getJob(jobId);
    if (existing && (await existing.isCompleted())) await existing.remove();
  }
}
