import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { ChargeRetryRunner } from '../../charges/charge-retry-runner.js';
import type { ChargeRetryJobData } from '../bullmq-billing-queue.js';

@Injectable()
export class ChargeRetriesProcessor {
  constructor(private readonly runner: ChargeRetryRunner) {}

  async process({
    data: { chargeId, attempt },
  }: Job<ChargeRetryJobData>): Promise<void> {
    await this.runner.run({ chargeId, attempt });
  }
}
