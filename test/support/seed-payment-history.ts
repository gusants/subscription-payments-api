import type { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';

export interface SeededCustomer {
  customerId: string;
  subscriptionId: string;
  chargeId: string;
}

export async function seedCustomerWithPaidCharge(
  prisma: PrismaService,
): Promise<SeededCustomer> {
  const customer = await prisma.customer.create({
    data: {
      id: generateId(ID_PREFIXES.customer),
      name: 'Ana Souza',
      email: `ana-${generateId(ID_PREFIXES.customer)}@example.com`,
      createdAt: new Date('2025-09-20T00:00:00.000Z'),
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
      status: 'active',
      billingAnchor: new Date('2025-09-20T00:00:00.000Z'),
      currentPeriodStart: new Date('2026-05-20T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-06-20T00:00:00.000Z'),
    },
  });
  const charge = await insertPaidCharge(prisma, subscription.id);
  return {
    customerId: customer.id,
    subscriptionId: subscription.id,
    chargeId: charge.id,
  };
}

export function insertPaidCharge(
  prisma: PrismaService,
  subscriptionId: string,
  periodStart = new Date('2026-05-10T00:00:00.000Z'),
) {
  return prisma.charge.create({
    data: {
      id: generateId(ID_PREFIXES.charge),
      subscriptionId,
      amountCents: 1990,
      method: 'card',
      status: 'paid',
      dueDate: new Date('2026-05-10T00:00:00.000Z'),
      paidAt: new Date('2026-05-12T00:00:00.000Z'),
      periodStart,
      periodEnd: new Date('2026-06-10T00:00:00.000Z'),
    },
  });
}

export function insertDeclinedAttempt(prisma: PrismaService, chargeId: string) {
  return prisma.paymentAttempt.create({
    data: {
      id: generateId(ID_PREFIXES.paymentAttempt),
      chargeId,
      gatewayChargeId: generateId(ID_PREFIXES.gatewayCharge),
      result: 'declined',
      failureReason: 'insufficient_funds',
    },
  });
}
