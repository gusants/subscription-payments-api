import type {
  BillingPeriod,
  NewSubscription,
  StatusChange,
  Subscription,
} from '../subscription.js';
import { SubscriptionsRepository } from '../subscriptions.repository.js';

export class InMemorySubscriptionsRepository extends SubscriptionsRepository {
  private readonly subscriptions = new Map<string, Subscription>();

  create(subscription: NewSubscription): Promise<Subscription> {
    const now = new Date();
    const created: Subscription = {
      ...subscription,
      canceledAt: null,
      cancelReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.subscriptions.set(created.id, created);
    return Promise.resolve({ ...created });
  }

  findById(id: string): Promise<Subscription | null> {
    const found = this.subscriptions.get(id);
    return Promise.resolve(found ? { ...found } : null);
  }

  changeCardToken(id: string, cardToken: string): Promise<Subscription | null> {
    const found = this.subscriptions.get(id);
    if (!found) return Promise.resolve(null);
    const updated: Subscription = {
      ...found,
      cardToken,
      updatedAt: new Date(),
    };
    this.subscriptions.set(id, updated);
    return Promise.resolve({ ...updated });
  }

  advancePeriod(id: string, { start, end }: BillingPeriod): void {
    const found = this.subscriptions.get(id);
    if (!found || found.currentPeriodEnd >= end) return;
    this.subscriptions.set(id, {
      ...found,
      currentPeriodStart: start,
      currentPeriodEnd: end,
      updatedAt: new Date(),
    });
  }

  changeStatus(
    id: string,
    { fromAnyOf, to, canceledAt, cancelReason }: StatusChange,
  ): Promise<Subscription | null> {
    const found = this.subscriptions.get(id);
    if (!found || !fromAnyOf.includes(found.status)) {
      return Promise.resolve(null);
    }
    const updated: Subscription = {
      ...found,
      status: to,
      canceledAt: canceledAt ?? found.canceledAt,
      cancelReason: cancelReason ?? found.cancelReason,
      updatedAt: new Date(),
    };
    this.subscriptions.set(id, updated);
    return Promise.resolve({ ...updated });
  }
}
