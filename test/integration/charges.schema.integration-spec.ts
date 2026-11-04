import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('charges schema (integration)', () => {
  let prisma: PrismaService;
  let subscriptionId: string;

  beforeAll(() => {
    prisma = createPrismaService();
  });

  beforeEach(async () => {
    await prisma.paymentAttempt.deleteMany();
    await prisma.charge.deleteMany();
    await prisma.subscription.deleteMany();
    await prisma.customer.deleteMany();
    await prisma.plan.deleteMany();
    const customer = await prisma.customer.create({
      data: {
        id: generateId(ID_PREFIXES.customer),
        name: 'Ana',
        email: 'ana@example.com',
      },
    });
    const plan = await prisma.plan.create({
      data: {
        id: generateId(ID_PREFIXES.plan),
        name: 'Basic',
        amountCents: 1990,
        interval: 'monthly',
      },
    });
    const subscription = await prisma.subscription.create({
      data: {
        id: generateId(ID_PREFIXES.subscription),
        customerId: customer.id,
        planId: plan.id,
        paymentMethod: 'card',
        billingAnchor: new Date('2026-01-31T00:00:00.000Z'),
        currentPeriodStart: new Date('2026-01-31T00:00:00.000Z'),
        currentPeriodEnd: new Date('2026-02-28T00:00:00.000Z'),
      },
    });
    subscriptionId = subscription.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const chargeData = (overrides: Record<string, unknown> = {}) => ({
    id: generateId(ID_PREFIXES.charge),
    subscriptionId,
    amountCents: 1990,
    method: 'card' as const,
    dueDate: new Date('2026-01-31T00:00:00.000Z'),
    periodStart: new Date('2026-01-31T00:00:00.000Z'),
    periodEnd: new Date('2026-02-28T00:00:00.000Z'),
    ...overrides,
  });

  it('starts a charge pending with no attempts and no gateway reference', async () => {
    const charge = await prisma.charge.create({ data: chargeData() });

    expect(charge).toMatchObject({
      status: 'pending',
      attemptCount: 0,
      gatewayChargeId: null,
      retryCount: 0,
      firstFailedAt: null,
      nextRetryAt: null,
      paidAt: null,
    });
  });

  it('rejects a second charge for the same subscription period', async () => {
    await prisma.charge.create({ data: chargeData() });

    await expect(
      prisma.charge.create({ data: chargeData() }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('accepts a charge for the next period of the same subscription', async () => {
    await prisma.charge.create({ data: chargeData() });

    await expect(
      prisma.charge.create({
        data: chargeData({
          periodStart: new Date('2026-02-28T00:00:00.000Z'),
          periodEnd: new Date('2026-03-31T00:00:00.000Z'),
        }),
      }),
    ).resolves.toBeDefined();
  });

  it.each([0, -1])('rejects amountCents %s at the database', async (amount) => {
    await expect(
      prisma.charge.create({ data: chargeData({ amountCents: amount }) }),
    ).rejects.toThrow();
  });

  it('rejects a duplicated gateway charge id but allows many nulls', async () => {
    await prisma.charge.create({
      data: chargeData({ gatewayChargeId: 'gch_1' }),
    });

    await expect(
      prisma.charge.create({
        data: chargeData({
          gatewayChargeId: 'gch_1',
          periodStart: new Date('2026-02-28T00:00:00.000Z'),
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('stores the expiry and payment instructions of an asynchronous charge', async () => {
    const instructions = { type: 'pix', copyPaste: '000201' };

    const charge = await prisma.charge.create({
      data: chargeData({
        method: 'pix',
        expiresAt: new Date('2026-02-01T00:00:00.000Z'),
        paymentInstructions: instructions,
      }),
    });

    expect(charge).toMatchObject({
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      paymentInstructions: instructions,
    });
  });

  it('leaves expiry and payment instructions null on a card charge', async () => {
    const charge = await prisma.charge.create({ data: chargeData() });

    expect(charge).toMatchObject({
      expiresAt: null,
      paymentInstructions: null,
    });
  });

  it('rejects a charge for an unknown subscription', async () => {
    await expect(
      prisma.charge.create({
        data: chargeData({ subscriptionId: 'sub_missing' }),
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('stores payment attempts against a charge', async () => {
    const charge = await prisma.charge.create({ data: chargeData() });

    const attempt = await prisma.paymentAttempt.create({
      data: {
        id: generateId(ID_PREFIXES.paymentAttempt),
        chargeId: charge.id,
        gatewayChargeId: 'gch_1',
        result: 'declined',
        failureReason: 'insufficient_funds',
      },
    });

    expect(attempt).toMatchObject({
      chargeId: charge.id,
      result: 'declined',
      failureReason: 'insufficient_funds',
    });
  });

  it('indexes the lookups used by listing and retry scheduling', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename IN ('charges', 'payment_attempts')`;

    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'charges_status_next_retry_at_idx',
        'charges_subscription_id_period_start_key',
        'charges_gateway_charge_id_key',
        'charges_gateway_attempt_key_key',
        'payment_attempts_charge_id_idx',
        'payment_attempts_gateway_charge_id_key',
      ]),
    );
    expect(indexes.map(({ indexname }) => indexname)).not.toContain(
      'charges_subscription_id_idx',
    );
  });

  it('keeps the period unique index partial so expired charges stay out of it', async () => {
    const [{ indexdef }] = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes
      WHERE indexname = 'charges_subscription_id_period_start_key'`;

    expect(indexdef).toMatch(/^CREATE UNIQUE INDEX/);
    expect(indexdef).toMatch(/\(subscription_id, period_start\)/);
    expect(indexdef).toMatch(/WHERE .*status <> 'expired'/);
  });

  it('rejects a duplicated gateway attempt key but allows many nulls', async () => {
    await prisma.charge.create({
      data: chargeData({ gatewayAttemptKey: 'ch_1:1' }),
    });

    await expect(
      prisma.charge.create({
        data: chargeData({
          gatewayAttemptKey: 'ch_1:1',
          periodStart: new Date('2026-02-28T00:00:00.000Z'),
        }),
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.charge.create({
        data: chargeData({
          periodStart: new Date('2026-03-31T00:00:00.000Z'),
        }),
      }),
    ).resolves.toBeDefined();
  });

  it('rejects two payment attempts for the same gateway charge', async () => {
    const charge = await prisma.charge.create({ data: chargeData() });
    const attempt = () =>
      prisma.paymentAttempt.create({
        data: {
          id: generateId(ID_PREFIXES.paymentAttempt),
          chargeId: charge.id,
          gatewayChargeId: 'gch_1',
          result: 'declined',
          failureReason: 'insufficient_funds',
        },
      });
    await attempt();

    await expect(attempt()).rejects.toMatchObject({ code: 'P2002' });
  });

  it('rejects a failure reason outside the enum at the database', async () => {
    const charge = await prisma.charge.create({ data: chargeData() });

    await expect(
      prisma.$executeRaw`
        INSERT INTO payment_attempts (id, charge_id, gateway_charge_id, result, failure_reason)
        VALUES ('pa_x', ${charge.id}, 'gch_x', 'declined', 'cosmic_rays')`,
    ).rejects.toThrow();
  });

  it('stores every timestamp column with time zone', async () => {
    const columns = await prisma.$queryRaw<{ data_type: string }[]>`
      SELECT DISTINCT data_type FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name IN ('charges', 'payment_attempts')
        AND data_type LIKE 'timestamp%'`;

    expect(columns).toEqual([{ data_type: 'timestamp with time zone' }]);
  });

  it('rejects a second live charge for the same period but ignores expired ones', async () => {
    const expired = await prisma.charge.create({
      data: chargeData({ status: 'expired' }),
    });
    await prisma.charge.create({ data: chargeData({ status: 'expired' }) });
    await prisma.charge.create({ data: chargeData() });

    await expect(
      prisma.charge.create({ data: chargeData({ status: 'failed' }) }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(expired.retryCount).toBe(0);
    expect(expired.firstFailedAt).toBeNull();
  });
});
