import { Inject, Injectable } from '@nestjs/common';
import { BillingQueueConnection } from '../billing-queue-connection.js';
import { SUBSCRIPTION_RENEWALS_QUEUE } from '../billing-queue.constants.js';
import { RENEWAL_INTERVAL_MS } from '../recurring-job-intervals.js';
import { RecurringJobWorker } from '../recurring-job-worker.js';
import { SubscriptionRenewalsProcessor } from './subscription-renewals.processor.js';

export const SUBSCRIPTION_RENEWALS_SCHEDULER_ID = 'subscription-renewals';
export const SUBSCRIPTION_RENEWALS_JOB_NAME = 'subscription-renewals-sweep';

@Injectable()
export class SubscriptionRenewalsWorker extends RecurringJobWorker {
  constructor(
    processor: SubscriptionRenewalsProcessor,
    connection: BillingQueueConnection,
    @Inject(RENEWAL_INTERVAL_MS) everyMs: number,
  ) {
    super(connection, {
      queueName: SUBSCRIPTION_RENEWALS_QUEUE,
      schedulerId: SUBSCRIPTION_RENEWALS_SCHEDULER_ID,
      jobName: SUBSCRIPTION_RENEWALS_JOB_NAME,
      everyMs,
      run: () => processor.process(),
    });
  }
}
