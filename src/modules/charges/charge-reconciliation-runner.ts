import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../shared/clock/index.js';
import type { RetryIntervalUnit } from './domain/retry-schedule.js';
import type { Charge, ChargeWithSubscription } from './charge.js';
import { runWithinChargeCorrelation } from './charge-correlation.js';
import { ChargeDunning } from './charge-dunning.js';
import {
  RECONCILIATION_BATCH_SIZE,
  RECONCILIATION_STALE_AFTER_MS,
} from './charge-reconciliation-options.js';
import { ChargeProcessor } from './charge-processor.js';
import { ChargesRepository } from './charges.repository.js';
import { DUNNING_INTERVAL_UNIT } from './dunning-interval-unit.js';
import { overdueDunningCutoffs, staleAttemptCutoff } from './domain/index.js';

export interface ReconciliationSummary {
  stalePending: number;
  checked: number;
  failed: number;
  dunningFollowUps: number;
}

@Injectable()
export class ChargeReconciliationRunner {
  private readonly logger = new Logger(ChargeReconciliationRunner.name);

  constructor(
    private readonly charges: ChargesRepository,
    private readonly processor: ChargeProcessor,
    private readonly dunning: ChargeDunning,
    private readonly clock: Clock,
    @Inject(DUNNING_INTERVAL_UNIT) private readonly unit: RetryIntervalUnit,
    @Inject(RECONCILIATION_STALE_AFTER_MS)
    private readonly staleAfterMs: number,
    @Inject(RECONCILIATION_BATCH_SIZE) private readonly batchSize: number,
  ) {}

  async run(): Promise<ReconciliationSummary> {
    const now = this.clock.now();
    const stale = await this.charges.findStalePendingCharges(
      staleAttemptCutoff(now, this.staleAfterMs),
      this.batchSize,
    );
    const followUps = await this.charges.findOverdueDunningFollowUps(
      overdueDunningCutoffs(now, this.unit, this.staleAfterMs),
      this.batchSize,
    );
    let checked = 0;
    for (const charge of stale) {
      const reconciled = await runWithinChargeCorrelation(charge, () =>
        this.reconcile(charge),
      );
      if (reconciled) checked += 1;
    }
    for (const found of followUps) {
      await runWithinChargeCorrelation(found.charge, () =>
        this.recoverFollowUp(found),
      );
    }
    return {
      stalePending: stale.length,
      checked,
      failed: stale.length - checked,
      dunningFollowUps: followUps.length,
    };
  }

  private async reconcile(charge: Charge): Promise<boolean> {
    try {
      const { charge: current } = await this.processor.reconcile(charge);
      this.logger.log(
        `Charge ${charge.id} (subscription ${charge.subscriptionId}) reconciled: ${current.status}`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Reconciling charge ${charge.id} (subscription ${charge.subscriptionId}, attempt started ${charge.attemptStartedAt?.toISOString()}) failed`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  private async recoverFollowUp({
    charge,
    subscription,
  }: ChargeWithSubscription): Promise<void> {
    this.logger.warn(
      `Charge ${charge.id} (subscription ${subscription.id}, ${charge.status}, ${charge.retryCount} retries made) has an overdue dunning follow-up; re-applying it`,
    );
    await this.dunning.afterSettlement({ charge, subscription });
  }
}
