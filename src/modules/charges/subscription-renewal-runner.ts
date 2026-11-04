import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../shared/clock/index.js';
import type { RenewalCandidate } from './charge.js';
import { ChargeProcessor } from './charge-processor.js';
import { RENEWAL_BATCH_SIZE } from './renewal-batch-size.js';
import { RenewalsRepository } from './renewals.repository.js';

export interface RenewalRunSummary {
  found: number;
  renewed: number;
  alreadyGenerated: number;
  failed: number;
}

@Injectable()
export class SubscriptionRenewalRunner {
  private readonly logger = new Logger(SubscriptionRenewalRunner.name);

  constructor(
    private readonly renewals: RenewalsRepository,
    private readonly processor: ChargeProcessor,
    private readonly clock: Clock,
    @Inject(RENEWAL_BATCH_SIZE) private readonly batchSize: number,
  ) {}

  async run(): Promise<RenewalRunSummary> {
    const due = await this.renewals.findDue(this.clock.now(), this.batchSize);
    const summary: RenewalRunSummary = {
      found: due.length,
      renewed: 0,
      alreadyGenerated: 0,
      failed: 0,
    };
    for (const candidate of due) {
      const result = await this.renew(candidate);
      summary[result] += 1;
    }
    return summary;
  }

  private async renew(
    candidate: RenewalCandidate,
  ): Promise<'renewed' | 'alreadyGenerated' | 'failed'> {
    const { subscription } = candidate;
    try {
      const processed = await this.processor.renew(candidate);
      if (!processed) return 'alreadyGenerated';
      this.logger.log(
        `Subscription ${subscription.id} renewed with charge ${processed.charge.id} (${processed.charge.status})`,
      );
      return 'renewed';
    } catch (error) {
      this.logger.error(
        `Renewal of subscription ${subscription.id} (period ending ${subscription.currentPeriodEnd.toISOString()}) failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return 'failed';
    }
  }
}
