import { ConflictError } from '../../../shared/errors/index.js';
import type { NewSubscription } from '../../subscriptions/subscription.js';
import { InMemorySubscriptionsRepository } from '../../subscriptions/testing/in-memory-subscriptions.repository.js';
import { BillingRepository } from '../billing.repository.js';
import { ChargeSettlementConflictError } from '../charge-settlement-conflict.error.js';
import type { ChargeStatus } from '../charge-status.js';
import type {
  AttachedGatewayCharge,
  Charge,
  ChargeSettlementRecord,
  GatewayAttempt,
  NewCharge,
  PaymentAttempt,
  RecordedOutcome,
  SubscriptionWithCharge,
} from '../charge.js';

export class InMemoryBillingRepository extends BillingRepository {
  private readonly stored = new Map<string, Charge>();
  private readonly recorded: PaymentAttempt[] = [];

  constructor(private readonly subscriptions: InMemorySubscriptionsRepository) {
    super();
  }

  async createSubscriptionWithFirstCharge(
    subscription: NewSubscription,
    charge: NewCharge,
  ): Promise<SubscriptionWithCharge> {
    const created = await this.subscriptions.create(subscription);
    const now = new Date();
    const createdCharge: Charge = {
      ...charge,
      status: 'pending',
      gatewayChargeId: null,
      attemptCount: 0,
      nextRetryAt: null,
      paidAt: null,
      expiresAt: null,
      paymentInstructions: null,
      createdAt: now,
      updatedAt: now,
    };
    this.stored.set(createdCharge.id, createdCharge);
    return { subscription: created, charge: { ...createdCharge } };
  }

  markChargePending(
    id: string,
    fromAnyOf: readonly ChargeStatus[],
    attempt: GatewayAttempt,
  ): Promise<Charge | null> {
    const found = this.stored.get(id);
    if (!found || !fromAnyOf.includes(found.status)) {
      return Promise.resolve(null);
    }
    const reopened: Charge = {
      ...found,
      status: 'pending',
      ...attempt,
      updatedAt: new Date(),
    };
    this.stored.set(id, reopened);
    return Promise.resolve({ ...reopened });
  }

  takeAttemptLease(
    id: string,
    leaseExpiredBefore: Date,
    startedAt: Date,
  ): Promise<Charge | null> {
    const found = this.stored.get(id);
    const leaseExpired =
      !found?.attemptStartedAt || found.attemptStartedAt < leaseExpiredBefore;
    if (found?.status !== 'pending' || !leaseExpired) {
      return Promise.resolve(null);
    }
    const leased: Charge = { ...found, attemptStartedAt: startedAt };
    this.stored.set(id, leased);
    return Promise.resolve({ ...leased });
  }

  attachGatewayCharge(
    id: string,
    attached: AttachedGatewayCharge,
  ): Promise<Charge | null> {
    const found = this.stored.get(id);
    if (found?.status !== 'pending') return Promise.resolve(null);
    const updated: Charge = { ...found, ...attached };
    this.stored.set(id, updated);
    return Promise.resolve({ ...updated });
  }

  async recordChargeOutcome({
    charge,
    attempt,
    subscription,
  }: ChargeSettlementRecord): Promise<RecordedOutcome> {
    const found = this.stored.get(charge.id);
    if (!found) {
      throw new ConflictError(`Charge ${charge.id} was modified concurrently`);
    }
    if (!charge.fromAnyOf.includes(found.status)) {
      return this.currentStateOfIdenticalSettlement(
        found,
        charge,
        subscription.id,
      );
    }
    const settled: Charge = {
      ...found,
      status: charge.to,
      gatewayChargeId: charge.gatewayChargeId,
      paidAt: charge.paidAt,
      attemptCount: found.attemptCount + (attempt ? 1 : 0),
      updatedAt: new Date(),
    };
    this.stored.set(settled.id, settled);
    if (attempt) this.recorded.push({ ...attempt, createdAt: new Date() });
    const changed = subscription.change
      ? await this.subscriptions.changeStatus(
          subscription.id,
          subscription.change,
        )
      : null;
    const current = await this.subscriptions.findById(subscription.id);
    if (!current) {
      throw new ConflictError(`Subscription ${subscription.id} not found`);
    }
    return {
      subscription: current,
      charge: { ...settled },
      subscriptionChangeApplied: !subscription.change || changed !== null,
    };
  }

  private async currentStateOfIdenticalSettlement(
    found: Charge,
    expected: ChargeSettlementRecord['charge'],
    subscriptionId: string,
  ): Promise<RecordedOutcome> {
    const settledIdentically =
      found.status === expected.to &&
      found.gatewayChargeId === expected.gatewayChargeId;
    const current = await this.subscriptions.findById(subscriptionId);
    if (!settledIdentically) {
      throw new ChargeSettlementConflictError(
        found.id,
        found.status,
        found.gatewayChargeId,
      );
    }
    if (!current) {
      throw new ConflictError(`Subscription ${subscriptionId} not found`);
    }
    return {
      subscription: current,
      charge: { ...found },
      subscriptionChangeApplied: true,
    };
  }

  charges(): Charge[] {
    return [...this.stored.values()].map((charge) => ({ ...charge }));
  }

  attempts(): PaymentAttempt[] {
    return this.recorded.map((attempt) => ({ ...attempt }));
  }
}
