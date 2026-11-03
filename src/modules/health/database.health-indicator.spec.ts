import { HealthIndicatorService } from '@nestjs/terminus';
import type { PrismaService } from '../../shared/database/prisma.service.js';
import { DatabaseHealthIndicator } from './database.health-indicator.js';

function buildIndicator(queryRaw: () => Promise<unknown>) {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return new DatabaseHealthIndicator(prisma, new HealthIndicatorService());
}

describe('DatabaseHealthIndicator', () => {
  it('reports up when the database answers', async () => {
    const indicator = buildIndicator(() =>
      Promise.resolve([{ '?column?': 1 }]),
    );

    await expect(indicator.isHealthy('database')).resolves.toEqual({
      database: { status: 'up' },
    });
  });

  it('reports down with the failure reason when the database is unreachable', async () => {
    const indicator = buildIndicator(() =>
      Promise.reject(new Error('connection refused')),
    );

    await expect(indicator.isHealthy('database')).resolves.toEqual({
      database: { status: 'down', message: 'connection refused' },
    });
  });
});
