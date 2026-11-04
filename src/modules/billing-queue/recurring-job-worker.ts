import {
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { BillingQueueConnection } from './billing-queue-connection.js';
import { BILLING_QUEUE_PREFIX } from './billing-queue.constants.js';
import { runWithinJobContext, type JobContext } from './job-context.js';

export interface RecurringJobDefinition {
  queueName: string;
  schedulerId: string;
  jobName: string;
  everyMs: number;
  run: () => Promise<unknown>;
}

export abstract class RecurringJobWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(this.constructor.name);
  private queue?: Queue<Partial<JobContext>>;
  private worker?: Worker<Partial<JobContext>>;

  protected constructor(
    private readonly connection: BillingQueueConnection,
    private readonly job: RecurringJobDefinition,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const { queueName, schedulerId, jobName, everyMs, run } = this.job;
    const options = {
      connection: this.connection.redis,
      prefix: BILLING_QUEUE_PREFIX,
    };
    this.queue = new Queue(queueName, options);
    this.worker = new Worker<Partial<JobContext>>(
      queueName,
      (job) => runWithinJobContext(job.data, run),
      options,
    );
    this.worker.on('error', (error) =>
      this.logger.error(`Worker error: ${error.message}`),
    );
    await this.queue.upsertJobScheduler(
      schedulerId,
      { every: everyMs },
      { name: jobName },
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
  }
}
