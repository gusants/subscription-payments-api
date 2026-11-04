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
