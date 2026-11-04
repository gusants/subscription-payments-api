import { PrismaCustomerSummaryRepository } from '../../src/modules/customer-summary/prisma-customer-summary.repository.js';
import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { createPrismaService } from '../support/prisma-test-client.js';
import {
  insertDeclinedAttempt,
  insertPaidCharge,
  seedCustomerWithPaidCharge,
} from '../support/seed-payment-history.js';

describe('PrismaCustomerSummaryRepository (integration)', () => {
  let prisma: PrismaService;
  let repository: PrismaCustomerSummaryRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repository = new PrismaCustomerSummaryRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('finds nothing for an unknown customer', async () => {
    await expect(
      repository.findPaymentRecord('cus_missing'),
    ).resolves.toBeNull();
  });

  it('returns an empty history for a customer with no subscription', async () => {
    const { id } = await prisma.customer.create({
      data: { id: 'cus_lonely', name: 'Lonely', email: 'lonely@example.com' },
    });

    const record = await repository.findPaymentRecord(id);

    expect(record).toMatchObject({
      customerId: id,
      plan: null,
      charges: [],
      attempts: [],
      activity: { lastActivityAt: null, chargeCount: 0, attemptCount: 0 },
    });
  });

  it('returns the charges, attempts and plan of the customer', async () => {
    const { customerId, chargeId } = await seedCustomerWithPaidCharge(prisma);
    await insertDeclinedAttempt(prisma, chargeId);

    const record = await repository.findPaymentRecord(customerId);

    expect(record).toMatchObject({
      customerSince: new Date('2025-09-20T00:00:00.000Z'),
      plan: { interval: 'monthly', amountCents: 1990 },
      charges: [
        {
          status: 'paid',
          method: 'card',
          amountCents: 1990,
          dueDate: new Date('2026-05-10T00:00:00.000Z'),
          paidAt: new Date('2026-05-12T00:00:00.000Z'),
          failureReason: 'insufficient_funds',
        },
      ],
      attempts: [{ result: 'declined' }],
      activity: { chargeCount: 1, attemptCount: 1 },
    });
  });

  it('does not expose personal data', async () => {
    const { customerId } = await seedCustomerWithPaidCharge(prisma);

    const record = await repository.findPaymentRecord(customerId);

    expect(JSON.stringify(record)).not.toMatch(/Ana Souza|@example\.com/);
  });

  it('moves the last event identity with every payment event', async () => {
    const { customerId, chargeId, subscriptionId } =
      await seedCustomerWithPaidCharge(prisma);
    const initial = await repository.findPaymentRecord(customerId);

    await insertDeclinedAttempt(prisma, chargeId);
    const afterAttempt = await repository.findPaymentRecord(customerId);
    await prisma.charge.update({
      where: { id: chargeId },
      data: { retryCount: 1 },
    });
    const afterChargeUpdate = await repository.findPaymentRecord(customerId);
    await prisma.subscription.update({
      where: { id: subscriptionId },
      data: { status: 'past_due' },
    });
    const afterStatusChange = await repository.findPaymentRecord(customerId);
    await insertPaidCharge(
      prisma,
      subscriptionId,
      new Date('2026-06-10T00:00:00.000Z'),
    );
    const afterNewCharge = await repository.findPaymentRecord(customerId);

    const activities = [
      initial,
      afterAttempt,
      afterChargeUpdate,
      afterStatusChange,
      afterNewCharge,
    ].map((record) => JSON.stringify(record?.activity));
    expect(new Set(activities).size).toBe(activities.length);
  });
});
