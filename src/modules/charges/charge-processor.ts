import { Injectable, Logger } from '@nestjs/common';
import {
  GatewayUnavailableError,
  PaymentGateway,
  type GatewayCharge,
  type GatewayFailureReason,
} from '../../gateway/index.js';
import { Clock } from '../../shared/clock/index.js';
import { UnprocessableError } from '../../shared/errors/index.js';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import { assertTransition as assertSubscriptionTransition } from '../subscriptions/domain/index.js';
import type { Subscription } from '../subscriptions/subscription.js';
import { BillingRepository } from './billing.repository.js';
import type { Charge } from './charge.js';
import {
  assertTransition as assertChargeTransition,
  subscriptionStatusAfterCharge,
  toChargeOutcome,
  type ChargeOutcome,
} from './domain/index.js';

export interface PendingChargeRequest {
  charge: Charge;
  subscription: Subscription;
  gatewayCustomerId: string;
}

export interface ProcessedCharge {
  charge: Charge;
  subscription: Subscription;
  failureReason: GatewayFailureReason | null;
}

@Injectable()
export class ChargeProcessor {
  private readonly logger = new Logger(ChargeProcessor.name);

  constructor(
    private readonly billing: BillingRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
  ) {}

  async process(request: PendingChargeRequest): Promise<ProcessedCharge> {
    const gatewayCharge = await this.requestGatewayCharge(request);
    const outcome = gatewayCharge && toChargeOutcome(gatewayCharge);
    if (!gatewayCharge || !outcome) {
      const { charge, subscription } = request;
      return { charge, subscription, failureReason: null };
    }
    return this.recordOutcome(request, gatewayCharge, outcome);
  }

  private async requestGatewayCharge({
    charge,
    subscription,
    gatewayCustomerId,
  }: PendingChargeRequest): Promise<GatewayCharge | null> {
    if (!subscription.cardToken) {
      throw new UnprocessableError(
        `Subscription ${subscription.id} has no card token`,
      );
    }
    try {
      return await this.gateway.createCharge({
        gatewayCustomerId,
        amountCents: charge.amountCents,
        method: 'card',
        cardToken: subscription.cardToken,
        externalRef: charge.id,
        idempotencyKey: `${charge.id}:${charge.attemptCount + 1}`,
      });
    } catch (error) {
      if (error instanceof GatewayUnavailableError) {
        this.logger.warn(
          `Gateway unavailable for charge ${charge.id}; left pending for reconciliation`,
        );
        return null;
      }
      throw error;
    }
  }

  private async recordOutcome(
    { charge, subscription }: PendingChargeRequest,
    gatewayCharge: GatewayCharge,
    outcome: ChargeOutcome,
  ): Promise<ProcessedCharge> {
    const subscriptionStatus = subscriptionStatusAfterCharge(
      subscription.status,
      outcome.chargeStatus,
    );
    assertChargeTransition(charge.status, outcome.chargeStatus);
    if (subscriptionStatus) {
      assertSubscriptionTransition(subscription.status, subscriptionStatus);
    }
    const settled = await this.billing.recordChargeOutcome({
      charge: {
        id: charge.id,
        fromAnyOf: [charge.status],
        to: outcome.chargeStatus,
        gatewayChargeId: gatewayCharge.id,
        paidAt: outcome.chargeStatus === 'paid' ? this.clock.now() : null,
      },
      attempt: {
        id: generateId(ID_PREFIXES.paymentAttempt),
        chargeId: charge.id,
        gatewayChargeId: gatewayCharge.id,
        result: outcome.attemptResult,
        failureReason: outcome.failureReason,
      },
      subscription: {
        id: subscription.id,
        change: subscriptionStatus && {
          fromAnyOf: [subscription.status],
          to: subscriptionStatus,
        },
      },
    });
    return { ...settled, failureReason: outcome.failureReason };
  }
}
