import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { BillingQueue, type ChargeRetryRequest } from './billing-queue.port.js';
import { CHARGE_RETRIES_QUEUE } from './billing-queue.constants.js';
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

  async scheduleRetry({
    chargeId,
    attempt,
    delayMs,
  }: ChargeRetryRequest): Promise<void> {
    await this.chargeRetries.add(
      CHARGE_RETRY_JOB_NAME,
      { chargeId, attempt },
      { jobId: retryJobId(chargeId, attempt), delay: delayMs },
    );
  }
}
