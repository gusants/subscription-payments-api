import { PrismaBillingRepository } from '../../src/modules/charges/prisma-billing.repository.js';
import type {
  ChargeOutcomeRecord,
  NewCharge,
} from '../../src/modules/charges/charge.js';
import type { NewSubscription } from '../../src/modules/subscriptions/subscription.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { ConflictError } from '../../src/shared/errors/index.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('PrismaBillingRepository (integration)', () => {
  let prisma: PrismaService;
  let repository: PrismaBillingRepository;
  let customerId: string;
  let planId: string;

  beforeAll(() => {
    prisma = createPrismaService();
    repository = new PrismaBillingRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    customerId = (
      await prisma.customer.create({
        data: {
          id: generateId(ID_PREFIXES.customer),
          name: 'Ana',
          email: 'ana@example.com',
        },
      })
    ).id;
    planId = (
      await prisma.plan.create({
        data: {
          id: generateId(ID_PREFIXES.plan),
          name: 'Basic',
          amountCents: 1990,
          interval: 'monthly',
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const periodStart = new Date('2026-01-31T10:30:00.000Z');
  const periodEnd = new Date('2026-02-28T10:30:00.000Z');

  const newSubscription = (): NewSubscription => ({
    id: generateId(ID_PREFIXES.subscription),
    customerId,
    planId,
    paymentMethod: 'card',
    status: 'incomplete',
    cardToken: 'tok_success',
    billingAnchor: periodStart,
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
  });

  const firstChargeOf = (subscription: NewSubscription): NewCharge => ({
    id: generateId(ID_PREFIXES.charge),
    subscriptionId: subscription.id,
    amountCents: 1990,
    method: 'card',
    dueDate: periodStart,
    periodStart,
    periodEnd,
  });

  const outcomeRecord = (
    subscriptionId: string,
    chargeId: string,
    overrides: Partial<ChargeOutcomeRecord> = {},
  ): ChargeOutcomeRecord => ({
    charge: {
      id: chargeId,
      fromAnyOf: ['pending'],
      to: 'paid',
      gatewayChargeId: 'gch_1',
      paidAt: new Date('2026-01-31T10:30:01.000Z'),
    },
    attempt: {
      id: generateId(ID_PREFIXES.paymentAttempt),
      chargeId,
      gatewayChargeId: 'gch_1',
      result: 'succeeded',
      failureReason: null,
    },
    subscription: {
      id: subscriptionId,
      change: { fromAnyOf: ['incomplete'], to: 'active' },
    },
    ...overrides,
  });

  describe('createSubscriptionWithFirstCharge', () => {
    it('persists the subscription and its pending charge together', async () => {
      const subscription = newSubscription();
      const charge = firstChargeOf(subscription);

      const created = await repository.createSubscriptionWithFirstCharge(
        subscription,
        charge,
      );

      expect(created.subscription).toMatchObject({
        ...subscription,
        canceledAt: null,
      });
      expect(created.charge).toEqual({
        ...charge,
        status: 'pending',
        gatewayChargeId: null,
        attemptCount: 0,
        nextRetryAt: null,
        paidAt: null,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it('rolls the subscription back when the charge is rejected', async () => {
      const subscription = newSubscription();

      await expect(
        repository.createSubscriptionWithFirstCharge(subscription, {
          ...firstChargeOf(subscription),
          amountCents: 0,
        }),
      ).rejects.toThrow();

      expect(await prisma.subscription.count()).toBe(0);
      expect(await prisma.charge.count()).toBe(0);
    });
  });

  describe('recordChargeOutcome', () => {
    async function seedFirstCharge() {
      const subscription = newSubscription();
      const charge = firstChargeOf(subscription);
      await repository.createSubscriptionWithFirstCharge(subscription, charge);
      return { subscription, charge };
    }

    it('settles a paid charge, records the attempt and activates the subscription', async () => {
      const { subscription, charge } = await seedFirstCharge();
      const record = outcomeRecord(subscription.id, charge.id);

      const settled = await repository.recordChargeOutcome(record);

      expect(settled.charge).toMatchObject({
        status: 'paid',
        gatewayChargeId: 'gch_1',
        attemptCount: 1,
        paidAt: record.charge.paidAt,
      });
      expect(settled.subscription.status).toBe('active');
      expect(await prisma.paymentAttempt.findMany()).toEqual([
        {
          ...record.attempt,
          createdAt: expect.any(Date),
        },
      ]);
    });

    it('settles a declined charge as failed with the failure reason and no paidAt', async () => {
      const { subscription, charge } = await seedFirstCharge();

      const settled = await repository.recordChargeOutcome(
        outcomeRecord(subscription.id, charge.id, {
          charge: {
            id: charge.id,
            fromAnyOf: ['pending'],
            to: 'failed',
            gatewayChargeId: 'gch_1',
            paidAt: null,
          },
          attempt: {
            id: generateId(ID_PREFIXES.paymentAttempt),
            chargeId: charge.id,
            gatewayChargeId: 'gch_1',
            result: 'declined',
            failureReason: 'insufficient_funds',
          },
          subscription: {
            id: subscription.id,
            change: { fromAnyOf: ['incomplete'], to: 'past_due' },
          },
        }),
      );

      expect(settled.charge).toMatchObject({
        status: 'failed',
        attemptCount: 1,
        paidAt: null,
      });
      expect(settled.subscription.status).toBe('past_due');
      expect(await prisma.paymentAttempt.findFirst()).toMatchObject({
        result: 'declined',
        failureReason: 'insufficient_funds',
      });
    });

    it('rejects a charge that is no longer in the expected status and writes nothing', async () => {
      const { subscription, charge } = await seedFirstCharge();
      await repository.recordChargeOutcome(
        outcomeRecord(subscription.id, charge.id),
      );

      await expect(
        repository.recordChargeOutcome(
          outcomeRecord(subscription.id, charge.id, {
            attempt: {
              id: generateId(ID_PREFIXES.paymentAttempt),
              chargeId: charge.id,
              gatewayChargeId: 'gch_2',
              result: 'succeeded',
              failureReason: null,
            },
          }),
        ),
      ).rejects.toBeInstanceOf(ConflictError);

      expect(await prisma.paymentAttempt.count()).toBe(1);
      expect(
        (await prisma.charge.findUniqueOrThrow({ where: { id: charge.id } }))
          .attemptCount,
      ).toBe(1);
    });

    it('still records the charge and attempt when the subscription status moved meanwhile', async () => {
      const { subscription, charge } = await seedFirstCharge();
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'canceled', canceledAt: new Date() },
      });

      const settled = await repository.recordChargeOutcome(
        outcomeRecord(subscription.id, charge.id),
      );

      expect(settled.charge.status).toBe('paid');
      expect(settled.subscription.status).toBe('canceled');
      expect(await prisma.paymentAttempt.count()).toBe(1);
    });

    it('rolls everything back when the attempt cannot be stored', async () => {
      const { subscription, charge } = await seedFirstCharge();
      const record = outcomeRecord(subscription.id, charge.id);
      await prisma.paymentAttempt.create({
        data: { ...record.attempt, gatewayChargeId: 'gch_other' },
      });

      await expect(repository.recordChargeOutcome(record)).rejects.toThrow();

      expect(
        await prisma.charge.findUniqueOrThrow({ where: { id: charge.id } }),
      ).toMatchObject({ status: 'pending', attemptCount: 0 });
      expect(
        (
          await prisma.subscription.findUniqueOrThrow({
            where: { id: subscription.id },
          })
        ).status,
      ).toBe('incomplete');
    });

    it('lets only one of two concurrent settlements win', async () => {
      const { subscription, charge } = await seedFirstCharge();

      const results = await Promise.allSettled([
        repository.recordChargeOutcome(
          outcomeRecord(subscription.id, charge.id),
        ),
        repository.recordChargeOutcome(
          outcomeRecord(subscription.id, charge.id, {
            attempt: {
              id: generateId(ID_PREFIXES.paymentAttempt),
              chargeId: charge.id,
              gatewayChargeId: 'gch_2',
              result: 'succeeded',
              failureReason: null,
            },
          }),
        ),
      ]);

      expect(
        results.filter(({ status }) => status === 'fulfilled'),
      ).toHaveLength(1);
      expect(await prisma.paymentAttempt.count()).toBe(1);
    });
  });
});
