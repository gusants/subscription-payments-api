import { Queue } from 'bullmq';
import { inject } from 'vitest';
import {
  BILLING_QUEUE_NAMES,
  BILLING_QUEUE_PREFIX,
} from '../../src/modules/billing-queue/billing-queue.constants.js';

async function obliterate(name: string): Promise<void> {
  const queue = new Queue(name, {
    prefix: BILLING_QUEUE_PREFIX,
    connection: { host: inject('redisHost'), port: inject('redisPort') },
  });
  try {
    await queue.obliterate({ force: true });
  } finally {
    await queue.close();
  }
}

beforeAll(async () => {
  await Promise.all(BILLING_QUEUE_NAMES.map(obliterate));
});
