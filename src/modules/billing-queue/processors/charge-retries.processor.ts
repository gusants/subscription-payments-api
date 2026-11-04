import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ChargeRetryRunner } from '../../charges/charge-retry-runner.js';
import { CHARGE_RETRIES_QUEUE } from '../billing-queue.constants.js';
import type { ChargeRetryJobData } from '../bullmq-billing-queue.js';

@Processor(CHARGE_RETRIES_QUEUE)
export class ChargeRetriesProcessor extends WorkerHost {
  constructor(private readonly runner: ChargeRetryRunner) {
    super();
  }

  async process({ data }: Job<ChargeRetryJobData>): Promise<void> {
    await this.runner.run(data);
  }
}
