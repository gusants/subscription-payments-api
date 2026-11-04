import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  GatewayCustomerNotFoundError,
  GatewayOutcomeUnknownError,
  GatewayUnavailableError,
  PaymentGateway,
  type GatewayCharge,
  type GatewayFailureReason,
} from '../../gateway/index.js';
import { Clock } from '../../shared/clock/index.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from '../../shared/errors/index.js';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import type { Customer } from '../customers/customer.js';
import { CustomersRepository } from '../customers/customers.repository.js';
import { statusesAllowedToTransitionTo as subscriptionStatusesAllowedToTransitionTo } from '../subscriptions/domain/index.js';
import type { Subscription } from '../subscriptions/subscription.js';
import { BillingRepository } from './billing.repository.js';
import { CHARGE_ATTEMPT_LEASE_MS } from './charge-attempt-lease.js';
import { ChargeSettlementConflictError } from './charge-settlement-conflict.error.js';
import type {
  Charge,
  ChargeSettlementRecord,
  RecordedOutcome,
} from './charge.js';
import { ChargesRepository } from './charges.repository.js';
import {
  assertBillable,
  type BillableSubscription,
  expirySettlement,
  assertTransition as assertChargeTransition,
  nextGatewayAttempt,
  statusesAllowedToTransitionTo as chargeStatusesAllowedToTransitionTo,
  subscriptionStatusAfterCharge,
  toChargeOutcome,
  type ChargeOutcome,
} from './domain/index.js';

export interface AttemptTarget {
  charge: Charge;
  subscription: BillableSubscription;
  customer: Customer & { gatewayCustomerId: string };
}

export interface ProcessedCharge {
  charge: Charge;
  subscription: Subscription;
  failureReason: GatewayFailureReason | null;
}

interface GatewayAttempt extends AttemptTarget {
  idempotencyKey: string;
}

function isCapturedAgainstSettledCharge(
  { charge }: ChargeSettlementRecord,
  { currentStatus }: ChargeSettlementConflictError,
): boolean {
  return (
    charge.to === 'paid' &&
    (currentStatus === 'expired' || currentStatus === 'paid')
  );
}

function attemptKeyOf({ id, gatewayAttemptKey }: Charge): string {
  if (!gatewayAttemptKey) {
    throw new Error(`Pending charge ${id} has no gateway attempt key`);
  }
  return gatewayAttemptKey;
}

@Injectable()
export class ChargeProcessor {
  private readonly logger = new Logger(ChargeProcessor.name);

  constructor(
    private readonly billing: BillingRepository,
    private readonly charges: ChargesRepository,
    private readonly customers: CustomersRepository,
    private readonly gateway: PaymentGateway,
    private readonly clock: Clock,
    @Inject(CHARGE_ATTEMPT_LEASE_MS) private readonly leaseMs: number,
  ) {}

  async process(target: AttemptTarget): Promise<ProcessedCharge> {
    const gatewayCharge = await this.send(this.toGatewayAttempt(target));
    return gatewayCharge
      ? this.settle(target, gatewayCharge)
      : this.unsettled(target);
  }

  async retry(charge: Charge): Promise<ProcessedCharge> {
    assertChargeTransition(charge.status, 'pending');
    const target = await this.resolveTarget(charge);
    const pending = await this.billing.markChargePending(
      charge.id,
      chargeStatusesAllowedToTransitionTo('pending'),
      nextGatewayAttempt(charge, this.clock.now()),
    );
    if (!pending) {
      throw new ConflictError(`Charge ${charge.id} was modified concurrently`);
    }
    return this.process({ ...target, charge: pending });
  }

  async reconcile(charge: Charge): Promise<ProcessedCharge> {
    if (charge.status !== 'pending') {
      throw new ConflictError(`Charge ${charge.id} is ${charge.status}`);
    }
    const target = await this.resolveTarget(charge);
    const now = this.clock.now();
    const leased = await this.billing.takeAttemptLease(
      charge.id,
      new Date(now.getTime() - this.leaseMs),
      now,
    );
    if (!leased) {
      throw new ConflictError(`Charge ${charge.id} has an attempt in flight`);
    }
    return this.reconcileLeased({ ...target, charge: leased });
  }

  private async reconcileLeased(
    target: AttemptTarget,
  ): Promise<ProcessedCharge> {
    const { charge } = target;
    let existing: GatewayCharge | null;
    try {
      existing = await this.gateway.findChargeByIdempotencyKey(
        attemptKeyOf(charge),
      );
    } catch (error) {
      this.abandon(charge, error);
      return this.unsettled(target);
    }
    return existing ? this.settle(target, existing) : this.process(target);
  }

  private async resolveTarget(charge: Charge): Promise<AttemptTarget> {
    const found = await this.charges.findWithSubscription(charge.id);
    if (!found) {
      throw new NotFoundError(`Charge ${charge.id} not found`);
    }
    assertBillable(found.subscription);
    const customer = await this.customers.findById(
      found.subscription.customerId,
    );
    if (!customer?.gatewayCustomerId) {
      throw new UnprocessableError(
        `Customer ${found.subscription.customerId} has no gateway customer`,
      );
    }
    return {
      charge,
      subscription: found.subscription,
      customer: { ...customer, gatewayCustomerId: customer.gatewayCustomerId },
    };
  }

  private toGatewayAttempt(target: AttemptTarget): GatewayAttempt {
    return { ...target, idempotencyKey: attemptKeyOf(target.charge) };
  }

  private async send(attempt: GatewayAttempt): Promise<GatewayCharge | null> {
    try {
      return await this.createGatewayCharge(
        attempt,
        attempt.customer.gatewayCustomerId,
      );
    } catch (error) {
      if (error instanceof GatewayCustomerNotFoundError) {
        return this.sendToRecreatedCustomer(attempt);
      }
      return this.abandon(attempt.charge, error);
    }
  }

  private async sendToRecreatedCustomer(
    attempt: GatewayAttempt,
  ): Promise<GatewayCharge | null> {
    try {
      const gatewayCustomerId = await this.recreateGatewayCustomer(attempt);
      return await this.createGatewayCharge(attempt, gatewayCustomerId);
    } catch (error) {
      return this.abandon(attempt.charge, error);
    }
  }

  private async recreateGatewayCustomer({
    customer,
  }: GatewayAttempt): Promise<string> {
    const created = await this.gateway.createCustomer({
      externalRef: customer.id,
      name: customer.name,
      email: customer.email,
    });
    return this.customers.replaceGatewayCustomerId(
      customer.id,
      customer.gatewayCustomerId,
      created.id,
    );
  }

  private createGatewayCharge(
    { charge, subscription, idempotencyKey }: GatewayAttempt,
    gatewayCustomerId: string,
  ): Promise<GatewayCharge> {
    const request = {
      gatewayCustomerId,
      amountCents: charge.amountCents,
      externalRef: charge.id,
      idempotencyKey,
    };
    return this.gateway.createCharge(
      subscription.paymentMethod === 'card'
        ? { ...request, method: 'card', cardToken: subscription.cardToken }
        : { ...request, method: subscription.paymentMethod },
    );
  }

  private abandon(charge: Charge, error: unknown): null {
    const outcome = `charge ${charge.id} left pending for reconciliation`;
    if (error instanceof GatewayUnavailableError) {
      this.logger.warn(`Gateway unavailable; ${outcome}`);
    } else if (error instanceof GatewayOutcomeUnknownError) {
      this.logger.warn(`Gateway outcome unknown; ${outcome}`);
    } else {
      this.logger.error(
        `Unexpected gateway failure; ${outcome}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
    return null;
  }

  private unsettled({ charge, subscription }: AttemptTarget): ProcessedCharge {
    return { charge, subscription, failureReason: null };
  }

  private async settle(
    target: AttemptTarget,
    gatewayCharge: GatewayCharge,
  ): Promise<ProcessedCharge> {
    if (gatewayCharge.status === 'expired') {
      return this.recordExpiry(target, gatewayCharge);
    }
    const outcome = toChargeOutcome(gatewayCharge);
    if (!outcome) return this.awaitSettlement(target, gatewayCharge);
    return this.recordOutcome(target, gatewayCharge, outcome);
  }

  private async awaitSettlement(
    target: AttemptTarget,
    gatewayCharge: GatewayCharge,
  ): Promise<ProcessedCharge> {
    const attached = await this.billing.attachGatewayCharge(target.charge.id, {
      gatewayChargeId: gatewayCharge.id,
      expiresAt: gatewayCharge.expiresAt ?? null,
      paymentInstructions: gatewayCharge.paymentInstructions ?? null,
    });
    return this.unsettled({ ...target, charge: attached ?? target.charge });
  }

  private recordExpiry(
    { charge, subscription }: AttemptTarget,
    gatewayCharge: GatewayCharge,
  ): Promise<ProcessedCharge> {
    return this.persist(
      expirySettlement({
        charge,
        subscription,
        gatewayChargeId: gatewayCharge.id,
        now: this.clock.now(),
      }),
      null,
    );
  }

  private recordOutcome(
    { charge, subscription }: AttemptTarget,
    gatewayCharge: GatewayCharge,
    outcome: ChargeOutcome,
  ): Promise<ProcessedCharge> {
    const subscriptionStatus = subscriptionStatusAfterCharge(
      subscription.status,
      outcome.chargeStatus,
    );
    return this.persist(
      {
        charge: {
          id: charge.id,
          fromAnyOf: ['pending'],
          to: outcome.chargeStatus,
          gatewayChargeId: gatewayCharge.id,
          paidAt:
            outcome.chargeStatus === 'paid'
              ? (gatewayCharge.paidAt ?? this.clock.now())
              : null,
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
            fromAnyOf:
              subscriptionStatusesAllowedToTransitionTo(subscriptionStatus),
            to: subscriptionStatus,
          },
        },
      },
      outcome.failureReason,
    );
  }

  private async persist(
    settlement: ChargeSettlementRecord,
    failureReason: GatewayFailureReason | null,
  ): Promise<ProcessedCharge> {
    const recorded = await this.recordSettlement(settlement);
    this.reportSettlement(settlement, recorded);
    return {
      charge: recorded.charge,
      subscription: recorded.subscription,
      failureReason,
    };
  }

  private async recordSettlement(
    settlement: ChargeSettlementRecord,
  ): Promise<RecordedOutcome> {
    try {
      return await this.billing.recordChargeOutcome(settlement);
    } catch (error) {
      if (
        error instanceof ChargeSettlementConflictError &&
        isCapturedAgainstSettledCharge(settlement, error)
      ) {
        this.logger.error(
          `Gateway charge ${settlement.charge.gatewayChargeId} captured money for charge ${settlement.charge.id} (subscription ${settlement.subscription.id}) but the charge is already ${error.currentStatus} with gateway charge ${error.currentGatewayChargeId}; refund required`,
        );
      }
      throw error;
    }
  }

  private reportSettlement(
    { charge, subscription }: ChargeSettlementRecord,
    recorded: RecordedOutcome,
  ): void {
    if (charge.to === 'paid' && recorded.subscription.status === 'canceled') {
      this.logger.error(
        `Charge ${charge.id} paid (gateway charge ${charge.gatewayChargeId}) on canceled subscription ${subscription.id}; refund required`,
      );
    } else if (!recorded.subscriptionChangeApplied) {
      this.logger.error(
        `Charge ${charge.id} settled as ${charge.to} (gateway charge ${charge.gatewayChargeId}) but subscription ${subscription.id} did not move to ${subscription.change?.to}; its status is now ${recorded.subscription.status}`,
      );
    }
  }
}
