import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { withTimeout } from '../../shared/async/with-timeout.js';
import { BillingQueue, type ChargeRetryRequest } from './billing-queue.port.js';
import { CHARGE_RETRIES_QUEUE } from './billing-queue.constants.js';
import {
  CHARGE_RETRY_JOB_OPTIONS,
  ENQUEUE_TIMEOUT_MS,
} from './billing-queue.options.js';
import { retryJobId } from './domain/retry-schedule.js';

export const CHARGE_RETRY_JOB_NAME = 'charge-retry';

export interface ChargeRetryJobData {
  chargeId: string;
  attempt: number;
}

async function promoteIfStillDelayed(job: Job): Promise<boolean> {
  try {
    await job.promote();
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
  }: ChargeRetryRequest): Promise<void> {
    return withTimeout(
      this.enqueue(chargeId, attempt, delayMs),
      ENQUEUE_TIMEOUT_MS,
    );
  }

  async promoteDelayedRetries(): Promise<number> {
    const delayed = await this.chargeRetries.getDelayed();
    const promotions = await Promise.all(delayed.map(promoteIfStillDelayed));
    return promotions.filter(Boolean).length;
  }

  private async enqueue(
    chargeId: string,
    attempt: number,
    delayMs: number,
  ): Promise<void> {
    const job = await this.chargeRetries.add(
      CHARGE_RETRY_JOB_NAME,
      { chargeId, attempt },
      {
        ...CHARGE_RETRY_JOB_OPTIONS,
        jobId: retryJobId(chargeId, attempt),
        delay: delayMs,
      },
    );
    if (delayMs === 0 && (await job.isDelayed())) await job.promote();
  }
}
