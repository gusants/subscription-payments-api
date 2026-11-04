import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import type { DemoSeed } from './build-demo-seed.js';
import { SEED_ID_PREFIXES } from './demo-seed-ids.js';

const ownedBySeed = (prefix: string) => ({ startsWith: prefix });

const seedSubscriptions: Prisma.SubscriptionWhereInput = {
  id: ownedBySeed(SEED_ID_PREFIXES.subscription),
};

export async function applyDemoSeed(
  prisma: PrismaClient,
  seed: DemoSeed,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.paymentAttempt.deleteMany({
      where: { charge: { subscription: seedSubscriptions } },
    });
    await tx.charge.deleteMany({ where: { subscription: seedSubscriptions } });
    await tx.subscription.deleteMany({ where: seedSubscriptions });
    for (const { id, ...plan } of seed.plans) {
      await tx.plan.upsert({
        where: { id },
        create: { id, ...plan },
        update: plan,
      });
    }
    for (const { id, ...customer } of seed.customers) {
      await tx.customer.upsert({
        where: { id },
        create: { id, ...customer },
        update: customer,
      });
    }
    await tx.subscription.createMany({ data: seed.subscriptions });
    await tx.charge.createMany({ data: seed.charges });
    await tx.paymentAttempt.createMany({ data: seed.attempts });
  });
}
