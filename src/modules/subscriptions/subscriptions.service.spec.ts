import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import {
  ConflictError,
  NotFoundError,
  UnprocessableError,
} from '../../shared/errors/index.js';
import { InMemoryCustomersRepository } from '../customers/testing/in-memory-customers.repository.js';
import type { PlanInterval } from '../plans/plan.js';
import { InMemoryPlansRepository } from '../plans/testing/in-memory-plans.repository.js';
import { InvalidTransitionError } from './domain/index.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { InMemorySubscriptionsRepository } from './testing/in-memory-subscriptions.repository.js';

describe('SubscriptionsService', () => {
  const startedAt = new Date('2026-01-31T10:30:00.000Z');
  let customers: InMemoryCustomersRepository;
  let plans: InMemoryPlansRepository;
  let subscriptions: InMemorySubscriptionsRepository;
  let clock: FixedClock;
  let service: SubscriptionsService;

  beforeEach(() => {
    customers = new InMemoryCustomersRepository();
    plans = new InMemoryPlansRepository();
    subscriptions = new InMemorySubscriptionsRepository();
    clock = new FixedClock(startedAt);
    service = new SubscriptionsService(subscriptions, customers, plans, clock);
  });

  async function seed(interval: PlanInterval = 'monthly') {
    const customer = await customers.create({
      id: 'cus_1',
      name: 'Ana',
      email: 'ana@example.com',
    });
    const plan = await plans.create({
      id: 'plan_1',
      name: 'Basic',
      amountCents: 1990,
      interval,
    });
    return { customer, plan };
  }

  const input = {
    customerId: 'cus_1',
    planId: 'plan_1',
    paymentMethod: 'card',
  } as const;

  describe('create', () => {
    it('creates an incomplete subscription starting now', async () => {
      await seed();

      const subscription = await service.create(input);

      expect(subscription).toMatchObject({
        ...input,
        status: 'incomplete',
        canceledAt: null,
        billingAnchor: startedAt,
        currentPeriodStart: startedAt,
        currentPeriodEnd: new Date('2026-02-28T10:30:00.000Z'),
      });
      expect(subscription.id).toMatch(/^sub_[0-9a-z]{26}$/);
    });

    it('computes a yearly period end from the plan interval', async () => {
      await seed('yearly');

      const subscription = await service.create(input);

      expect(subscription.currentPeriodEnd).toEqual(
        new Date('2027-01-31T10:30:00.000Z'),
      );
    });

    it('rejects an unknown customer with NotFoundError', async () => {
      await seed();

      await expect(
        service.create({ ...input, customerId: 'cus_missing' }),
      ).rejects.toThrow(new NotFoundError('Customer cus_missing not found'));
    });

    it('rejects an unknown plan with NotFoundError', async () => {
      await seed();

      await expect(
        service.create({ ...input, planId: 'plan_missing' }),
      ).rejects.toThrow(new NotFoundError('Plan plan_missing not found'));
    });

    it('rejects an inactive plan with UnprocessableError', async () => {
      await seed();
      plans.deactivate('plan_1');

      await expect(service.create(input)).rejects.toBeInstanceOf(
        UnprocessableError,
      );
    });
  });

  describe('getById', () => {
    it('returns the subscription', async () => {
      await seed();
      const { id } = await service.create(input);

      await expect(service.getById(id)).resolves.toMatchObject({ id });
    });

    it('throws NotFoundError for an unknown id', async () => {
      await expect(service.getById('sub_missing')).rejects.toThrow(
        new NotFoundError('Subscription sub_missing not found'),
      );
    });
  });

  describe('cancel', () => {
    it('cancels and stamps canceledAt from the clock', async () => {
      await seed();
      const { id } = await service.create(input);
      const canceledAt = new Date('2026-02-10T00:00:00.000Z');
      clock.set(canceledAt);

      const canceled = await service.cancel(id);

      expect(canceled).toMatchObject({ id, status: 'canceled', canceledAt });
      await expect(service.getById(id)).resolves.toMatchObject({
        status: 'canceled',
      });
    });

    it('rejects cancelling twice via the transition rule', async () => {
      await seed();
      const { id } = await service.create(input);
      await service.cancel(id);

      await expect(service.cancel(id)).rejects.toBeInstanceOf(
        InvalidTransitionError,
      );
    });

    it('throws NotFoundError for an unknown id', async () => {
      await expect(service.cancel('sub_missing')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });

    it('cancels when the status moved to another cancellable one after it was read', async () => {
      await seed();
      const created = await service.create(input);
      const staleRead = { ...created, status: 'active' as const };
      await subscriptions.changeStatus(created.id, {
        fromAnyOf: ['incomplete'],
        to: 'past_due',
      });
      vi.spyOn(subscriptions, 'findById').mockResolvedValueOnce(staleRead);

      await expect(service.cancel(created.id)).resolves.toMatchObject({
        status: 'canceled',
      });
    });

    it('answers ConflictError when the status changed after it was read', async () => {
      await seed();
      const { id } = await service.create(input);
      vi.spyOn(subscriptions, 'changeStatus').mockResolvedValueOnce(null);

      await expect(service.cancel(id)).rejects.toBeInstanceOf(ConflictError);
    });
  });
});
