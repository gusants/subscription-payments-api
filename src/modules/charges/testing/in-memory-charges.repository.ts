import type { DunningFollowUpCutoff } from '../domain/dunning-recovery.js';
import type { PageWindow } from '../../customers/customer.js';
import type { InMemorySubscriptionsRepository } from '../../subscriptions/testing/in-memory-subscriptions.repository.js';
import type {
  Charge,
  ChargePage,
  ChargeWithAttempts,
  ChargeWithSubscription,
} from '../charge.js';
import { ChargesRepository } from '../charges.repository.js';
import type { InMemoryBillingRepository } from './in-memory-billing.repository.js';

const newestFirst = (a: Charge, b: Charge): number =>
  b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id);

export class InMemoryChargesRepository extends ChargesRepository {
  constructor(
    private readonly billing: InMemoryBillingRepository,
    private readonly subscriptions: InMemorySubscriptionsRepository,
  ) {
    super();
  }

  async findWithSubscription(
    id: string,
  ): Promise<ChargeWithSubscription | null> {
    const charge = this.billing.charges().find((found) => found.id === id);
    if (!charge) return null;
    const subscription = await this.subscriptions.findById(
      charge.subscriptionId,
    );
    return subscription ? { charge, subscription } : null;
  }

  findLiveByPeriod(
    subscriptionId: string,
    periodStart: Date,
  ): Promise<Charge | null> {
    const live = this.billing
      .charges()
      .find(
        (charge) =>
          charge.subscriptionId === subscriptionId &&
          charge.periodStart.getTime() === periodStart.getTime() &&
          charge.status !== 'expired',
      );
    return Promise.resolve(live ?? null);
  }

  findStalePendingCardCharges(
    attemptStartedBefore: Date,
    limit: number,
  ): Promise<Charge[]> {
    const stale = this.billing
      .charges()
      .filter(
        (charge) =>
          charge.status === 'pending' &&
          charge.method === 'card' &&
          (charge.attemptStartedAt ?? charge.createdAt) < attemptStartedBefore,
      )
      .slice(0, limit);
    return Promise.resolve(stale);
  }

  async findOverdueDunningFollowUps(
    cutoffs: readonly DunningFollowUpCutoff[],
    limit: number,
  ): Promise<ChargeWithSubscription[]> {
    const all = this.billing.charges();
    const overdue: ChargeWithSubscription[] = [];
    for (const charge of all) {
      const cutoff = cutoffs.find(
        ({ retryCount }) => retryCount === charge.retryCount,
      );
      const supersededByLiveCharge =
        charge.status === 'expired' &&
        all.some(
          (other) =>
            other.subscriptionId === charge.subscriptionId &&
            other.periodStart.getTime() === charge.periodStart.getTime() &&
            other.status !== 'expired',
        );
      const subscription = await this.subscriptions.findById(
        charge.subscriptionId,
      );
      if (
        cutoff &&
        charge.firstFailedAt &&
        charge.firstFailedAt < cutoff.failedBefore &&
        (charge.status === 'failed' || charge.status === 'expired') &&
        !supersededByLiveCharge &&
        subscription &&
        subscription.status !== 'canceled'
      ) {
        overdue.push({ charge, subscription });
      }
    }
    return overdue.slice(0, limit);
  }

  findWithAttempts(id: string): Promise<ChargeWithAttempts | null> {
    const charge = this.billing.charges().find((found) => found.id === id);
    return Promise.resolve(charge ? this.withAttempts(charge) : null);
  }

  async listByCustomer(
    customerId: string,
    { skip, take }: PageWindow,
  ): Promise<ChargePage> {
    const owned: Charge[] = [];
    for (const charge of this.billing.charges()) {
      const subscription = await this.subscriptions.findById(
        charge.subscriptionId,
      );
      if (subscription?.customerId === customerId) owned.push(charge);
    }
    const sorted = owned.sort(newestFirst);
    return {
      items: sorted.slice(skip, skip + take).map((c) => this.withAttempts(c)),
      total: sorted.length,
    };
  }

  private withAttempts(charge: Charge): ChargeWithAttempts {
    return {
      ...charge,
      attempts: this.billing
        .attempts()
        .filter(({ chargeId }) => chargeId === charge.id),
    };
  }
}
