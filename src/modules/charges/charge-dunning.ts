import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../../shared/clock/index.js';
import { currentOrNewCorrelationId } from '../../shared/correlation/index.js';
import { BillingQueue } from '../billing-queue/billing-queue.port.js';
import type { RetryIntervalUnit } from './domain/retry-schedule.js';
import { BillingRepository } from './billing.repository.js';
import type { Charge, RecordedOutcome } from './charge.js';
import { DUNNING_INTERVAL_UNIT } from './dunning-interval-unit.js';
import { logPaymentEvent, PAYMENT_EVENTS } from './payment-events.js';
import type { SubscriptionStatus } from '../subscriptions/subscription-status.js';
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
      return await this.apply(step, charge, subscription.status);
    } catch (error) {
      this.logger.error(
        `Dunning follow-up ${JSON.stringify(step)} for charge ${charge.id} (subscription ${subscription.id}, retries made ${charge.retryCount}) failed after the charge was settled; the charge keeps its settled state and the follow-up must be recovered`,
        error instanceof Error ? error.stack : String(error),
      );
      return false;
    }
  }

  requestRetryNow(
    charge: Pick<
      Charge,
      'id' | 'subscriptionId' | 'retryCount' | 'correlationId'
    >,
  ): Promise<void> {
    return this.scheduleRetry(charge, charge.retryCount + 1, NO_DELAY_MS);
  }

  private async scheduleRetry(
    charge: Pick<Charge, 'id' | 'subscriptionId' | 'correlationId'>,
    attempt: number,
    delayMs: number,
  ): Promise<void> {
    await this.queue.scheduleRetry({
      chargeId: charge.id,
      attempt,
      delayMs,
      correlationId: correlationIdOf(charge),
    });
    const runAt = new Date(this.clock.now().getTime() + delayMs);
    logPaymentEvent(
      {
        event: PAYMENT_EVENTS.chargeRetryScheduled,
        chargeId: charge.id,
        subscriptionId: charge.subscriptionId,
        attempt,
        delayMs,
        runAt: runAt.toISOString(),
      },
      `Retry ${attempt} of charge ${charge.id} scheduled for ${runAt.toISOString()}`,
    );
  }

  private async apply(
    step: DunningStep,
    charge: Charge,
    subscriptionStatus: SubscriptionStatus,
  ): Promise<boolean> {
    if (step.kind === 'schedule') {
      await this.scheduleRetry(charge, step.attempt, step.delayMs);
      return false;
    }
    if (step.kind === 'exhaust') {
      const applied = await this.billing.recordDunningExhaustion(
        step.exhaustion,
      );
      if (applied) this.logExhaustion(charge, step, subscriptionStatus);
      return applied;
    }
    return false;
  }

  private logExhaustion(
    charge: Charge,
    { exhaustion: { subscription } }: Extract<DunningStep, { kind: 'exhaust' }>,
    previousStatus: SubscriptionStatus,
  ): void {
    logPaymentEvent(
      {
        event: PAYMENT_EVENTS.chargeDunningExhausted,
        chargeId: charge.id,
        subscriptionId: subscription.id,
        retryCount: charge.retryCount,
      },
      `Charge ${charge.id} exhausted its ${charge.retryCount} dunning retries; subscription ${subscription.id} canceled`,
    );
    if (!subscription.change || previousStatus === subscription.change.to) {
      return;
    }
    logPaymentEvent(
      {
        event: PAYMENT_EVENTS.subscriptionStatusChanged,
        subscriptionId: subscription.id,
        from: previousStatus,
        to: subscription.change.to,
        cause: PAYMENT_EVENTS.chargeDunningExhausted,
        chargeId: charge.id,
      },
      `Subscription ${subscription.id} moved from ${previousStatus} to ${subscription.change.to} after charge ${charge.id} exhausted its retries`,
    );
  }
}
