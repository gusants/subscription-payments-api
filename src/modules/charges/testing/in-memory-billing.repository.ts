import { ConflictError } from '../../../shared/errors/index.js';
import type { NewSubscription } from '../../subscriptions/subscription.js';
import { InMemorySubscriptionsRepository } from '../../subscriptions/testing/in-memory-subscriptions.repository.js';
import { BillingRepository } from '../billing.repository.js';
import type { ChargeStatus } from '../charge-status.js';
import type {
  Charge,
  ChargeOutcomeRecord,
  NewCharge,
  PaymentAttempt,
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
      gatewayAttemptKey: null,
      attemptStartedAt: null,
      attemptCount: 0,
      nextRetryAt: null,
      paidAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.stored.set(createdCharge.id, createdCharge);
    return { subscription: created, charge: { ...createdCharge } };
  }

  markChargePending(
    id: string,
    fromAnyOf: readonly ChargeStatus[],
  ): Promise<Charge | null> {
    const found = this.stored.get(id);
    if (!found || !fromAnyOf.includes(found.status)) {
      return Promise.resolve(null);
    }
    const reopened: Charge = {
      ...found,
      status: 'pending',
      updatedAt: new Date(),
    };
    this.stored.set(id, reopened);
    return Promise.resolve({ ...reopened });
  }

  async recordChargeOutcome({
    charge,
    attempt,
    subscription,
  }: ChargeOutcomeRecord): Promise<SubscriptionWithCharge> {
    const found = this.stored.get(charge.id);
    if (!found || !charge.fromAnyOf.includes(found.status)) {
      throw new ConflictError(`Charge ${charge.id} was modified concurrently`);
    }
    const settled: Charge = {
      ...found,
      status: charge.to,
      gatewayChargeId: charge.gatewayChargeId,
      paidAt: charge.paidAt,
      attemptCount: found.attemptCount + 1,
      updatedAt: new Date(),
    };
    this.stored.set(settled.id, settled);
    this.recorded.push({ ...attempt, createdAt: new Date() });
    if (subscription.change) {
      await this.subscriptions.changeStatus(
        subscription.id,
        subscription.change,
      );
    }
    const current = await this.subscriptions.findById(subscription.id);
    if (!current) {
      throw new ConflictError(`Subscription ${subscription.id} not found`);
    }
    return { subscription: current, charge: { ...settled } };
  }

  charges(): Charge[] {
    return [...this.stored.values()].map((charge) => ({ ...charge }));
  }

  attempts(): PaymentAttempt[] {
    return this.recorded.map((attempt) => ({ ...attempt }));
  }
}
