import { Injectable } from '@nestjs/common';
import { ChargeReconciliationRunner } from '../../charges/charge-reconciliation-runner.js';

@Injectable()
export class ChargeReconciliationProcessor {
  constructor(private readonly runner: ChargeReconciliationRunner) {}

  async process(): Promise<void> {
    await this.runner.run();
  }
}
