import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { BillingQueueConnection } from '../billing-queue-connection.js';
import {
  BILLING_QUEUE_PREFIX,
  CHARGE_RETRIES_QUEUE,
} from '../billing-queue.constants.js';
import type { ChargeRetryJobData } from '../bullmq-billing-queue.js';
import {
  processWithinJobContext,
  runWithinJobContext,
} from '../job-context.js';
import { ChargeRetriesProcessor } from './charge-retries.processor.js';

@Injectable()
export class ChargeRetriesWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ChargeRetriesWorker.name);
  private worker?: Worker<ChargeRetryJobData>;

  constructor(
    private readonly processor: ChargeRetriesProcessor,
    private readonly connection: BillingQueueConnection,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<ChargeRetryJobData>(
      CHARGE_RETRIES_QUEUE,
      (job) => processWithinJobContext(job, () => this.processor.process(job)),
      { connection: this.connection.redis, prefix: BILLING_QUEUE_PREFIX },
    );
    this.worker.on('error', (error) =>
      this.logger.error(`Worker error: ${error.message}`),
    );
    this.worker.on('failed', (job, error) => {
      if (job) this.reportFailure(job, error);
    });
  }

  private reportFailure(job: Job<ChargeRetryJobData>, error: Error): void {
    const { chargeId, attempt } = job.data;
    const maxAttempts = job.opts.attempts ?? 1;
    runWithinJobContext(job.data, () =>
      this.logger.warn({
        msg: `Retry ${attempt} of charge ${chargeId} failed on technical attempt ${job.attemptsMade} of ${maxAttempts}: ${error.message}`,
        jobId: job.id,
        chargeId,
        attempt,
        attemptsMade: job.attemptsMade,
        maxAttempts,
      }),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
