import { Injectable } from '@nestjs/common';
import { SubscriptionRenewalRunner } from '../../charges/subscription-renewal-runner.js';

@Injectable()
export class SubscriptionRenewalsProcessor {
  constructor(private readonly runner: SubscriptionRenewalRunner) {}

  async process(): Promise<void> {
    await this.runner.run();
  }
}
