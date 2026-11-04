import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { Worker } from 'bullmq';
import { BillingQueueConnection } from '../billing-queue-connection.js';
import {
  BILLING_QUEUE_PREFIX,
  CHARGE_RETRIES_QUEUE,
} from '../billing-queue.constants.js';
import { ChargeRetriesProcessor } from './charge-retries.processor.js';

@Injectable()
export class ChargeRetriesWorker
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(ChargeRetriesWorker.name);
  private worker?: Worker;

  constructor(
    private readonly processor: ChargeRetriesProcessor,
    private readonly connection: BillingQueueConnection,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker(
      CHARGE_RETRIES_QUEUE,
      (job) => this.processor.process(job),
      { connection: this.connection.redis, prefix: BILLING_QUEUE_PREFIX },
    );
    this.worker.on('error', (error) =>
      this.logger.error(`Worker error: ${error.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
