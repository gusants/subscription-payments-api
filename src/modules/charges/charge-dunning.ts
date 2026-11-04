import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../shared/clock/index.js';
import { currentOrNewCorrelationId } from '../../shared/correlation/index.js';
import { BillingQueue } from '../billing-queue/billing-queue.port.js';
import type { RetryIntervalUnit } from './domain/retry-schedule.js';
import { BillingRepository } from './billing.repository.js';
import type { Charge, RecordedOutcome } from './charge.js';
import { DUNNING_INTERVAL_UNIT } from './dunning-interval-unit.js';
import { dunningStepAfterFailure, type DunningStep } from './domain/index.js';

const NO_DELAY_MS = 0;

const correlationIdOf = ({
  correlationId,
}: Pick<Charge, 'correlationId'>): string =>
  correlationId ?? currentOrNewCorrelationId();

@Injectable()
export class ChargeDunning {
  private readonly logger = new Logger(ChargeDunning.name);

  constructor(
    private readonly billing: BillingRepository,
    private readonly queue: BillingQueue,
    private readonly clock: Clock,
    @Inject(DUNNING_INTERVAL_UNIT) private readonly unit: RetryIntervalUnit,
  ) {}

  async afterSettlement({
    charge,
    subscription,
  }: Pick<RecordedOutcome, 'charge' | 'subscription'>): Promise<boolean> {
    const step = dunningStepAfterFailure({
      charge,
      subscription,
      unit: this.unit,
      now: this.clock.now(),
    });
    try {
      return await this.apply(step, charge);
    } catch (error) {
      this.logger.error(
        `Dunning follow-up ${JSON.stringify(step)} for charge ${charge.id} (subscription ${subscription.id}, retries made ${charge.retryCount}) failed after the charge was settled; the charge keeps its settled state and the follow-up must be recovered`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  requestRetryNow(
    charge: Pick<Charge, 'id' | 'retryCount' | 'correlationId'>,
  ): Promise<void> {
    return this.queue.scheduleRetry({
      chargeId: charge.id,
      attempt: charge.retryCount + 1,
      delayMs: NO_DELAY_MS,
      correlationId: correlationIdOf(charge),
    });
  }

  private async apply(step: DunningStep, charge: Charge): Promise<boolean> {
    if (step.kind === 'schedule') {
      await this.queue.scheduleRetry({
        chargeId: charge.id,
        attempt: step.attempt,
        delayMs: step.delayMs,
        correlationId: correlationIdOf(charge),
      });
      return false;
    }
    if (step.kind === 'exhaust') {
      const applied = await this.billing.recordDunningExhaustion(
        step.exhaustion,
      );
      if (applied) {
        this.logger.warn(
          `Charge ${charge.id} exhausted its ${charge.retryCount} dunning retries; subscription ${step.exhaustion.subscription.id} canceled`,
        );
      }
      return applied;
    }
    return false;
  }
}
