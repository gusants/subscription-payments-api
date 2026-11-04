import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { envSchema } from '../shared/config/env.schema.js';
import { assertSeedAllowed } from './demo-seed/assert-seed-allowed.js';
import { applyDemoSeed } from './demo-seed/apply-demo-seed.js';
import { buildDemoSeed } from './demo-seed/build-demo-seed.js';

const SEED_ENV = envSchema.pick({
  NODE_ENV: true,
  DATABASE_URL: true,
  RETRY_INTERVAL_UNIT: true,
});

async function main(): Promise<void> {
  const { NODE_ENV, DATABASE_URL, RETRY_INTERVAL_UNIT } = SEED_ENV.parse(
    process.env,
  );
  assertSeedAllowed({
    nodeEnv: NODE_ENV,
    databaseUrl: DATABASE_URL,
    allowRemote: process.env.SEED_ALLOW_REMOTE === 'true',
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: DATABASE_URL }),
  });
  try {
    const seed = buildDemoSeed(new Date(), {
      retryUnit: RETRY_INTERVAL_UNIT,
    });
    await applyDemoSeed(prisma, seed);
    console.log(
      `Demo seed applied: ${seed.plans.length} plans, ${seed.customers.length} customers, ${seed.subscriptions.length} subscriptions, ${seed.charges.length} charges, ${seed.attempts.length} payment attempts`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
