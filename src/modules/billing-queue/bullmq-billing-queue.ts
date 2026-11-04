import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { withTimeout } from '../../shared/async/with-timeout.js';
import { BillingQueue, type ChargeRetryRequest } from './billing-queue.port.js';
import { CHARGE_RETRIES_QUEUE } from './billing-queue.constants.js';
import { ENQUEUE_TIMEOUT_MS } from './billing-queue.options.js';
import { retryJobId } from './domain/retry-schedule.js';

export const CHARGE_RETRY_JOB_NAME = 'charge-retry';

export interface ChargeRetryJobData {
  chargeId: string;
  attempt: number;
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

  private async enqueue(
    chargeId: string,
    attempt: number,
    delayMs: number,
  ): Promise<void> {
    const job = await this.chargeRetries.add(
      CHARGE_RETRY_JOB_NAME,
      { chargeId, attempt },
      { jobId: retryJobId(chargeId, attempt), delay: delayMs },
    );
    if (delayMs === 0 && (await job.isDelayed())) await job.promote();
  }
}
