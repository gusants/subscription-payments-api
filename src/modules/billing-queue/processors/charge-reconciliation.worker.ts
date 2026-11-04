import { Inject, Injectable } from '@nestjs/common';
import { BillingQueueConnection } from '../billing-queue-connection.js';
import { CHARGE_RECONCILIATION_QUEUE } from '../billing-queue.constants.js';
import { RECONCILIATION_INTERVAL_MS } from '../recurring-job-intervals.js';
import { RecurringJobWorker } from '../recurring-job-worker.js';
import { ChargeReconciliationProcessor } from './charge-reconciliation.processor.js';

export const CHARGE_RECONCILIATION_SCHEDULER_ID = 'charge-reconciliation';
export const CHARGE_RECONCILIATION_JOB_NAME = 'charge-reconciliation-sweep';

@Injectable()
export class ChargeReconciliationWorker extends RecurringJobWorker {
  constructor(
    processor: ChargeReconciliationProcessor,
    connection: BillingQueueConnection,
    @Inject(RECONCILIATION_INTERVAL_MS) everyMs: number,
  ) {
    super(connection, {
      queueName: CHARGE_RECONCILIATION_QUEUE,
      schedulerId: CHARGE_RECONCILIATION_SCHEDULER_ID,
      jobName: CHARGE_RECONCILIATION_JOB_NAME,
      everyMs,
      run: () => processor.process(),
    });
  }
}
