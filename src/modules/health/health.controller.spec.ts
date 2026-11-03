import { Test } from '@nestjs/testing';
import { HealthIndicatorService, TerminusModule } from '@nestjs/terminus';
import { DatabaseHealthIndicator } from './database.health-indicator.js';
import { HealthController } from './health.controller.js';
import { RedisHealthIndicator } from './redis.health-indicator.js';

const indicators = new HealthIndicatorService();

function stubIndicator(key: string, isUp: boolean) {
  const indicator = indicators.check(key);
  return {
    isHealthy: () =>
      Promise.resolve(
        isUp ? indicator.up() : indicator.down({ message: 'unreachable' }),
      ),
  };
}

async function buildController(database: boolean, redis: boolean) {
  const moduleRef = await Test.createTestingModule({
    imports: [TerminusModule.forRoot({ logger: false })],
    controllers: [HealthController],
    providers: [
      {
        provide: DatabaseHealthIndicator,
        useValue: stubIndicator('database', database),
      },
      {
        provide: RedisHealthIndicator,
        useValue: stubIndicator('redis', redis),
      },
    ],
  }).compile();
  return moduleRef.get(HealthController);
}

describe('HealthController', () => {
  it('reports ok when every dependency is up', async () => {
    const controller = await buildController(true, true);

    await expect(controller.check()).resolves.toMatchObject({
      status: 'ok',
      info: { database: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('fails the check when a dependency is down', async () => {
    const controller = await buildController(true, false);

    await expect(controller.check()).rejects.toMatchObject({
      response: {
        status: 'error',
        error: { redis: { status: 'down', message: 'unreachable' } },
      },
    });
  });
});
