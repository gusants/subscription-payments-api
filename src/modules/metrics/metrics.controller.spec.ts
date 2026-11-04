import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';
import { InMemoryMetricsRepository } from './testing/in-memory-metrics.repository.js';

describe('MetricsController', () => {
  let repository: InMemoryMetricsRepository;
  let controller: MetricsController;

  beforeEach(() => {
    repository = new InMemoryMetricsRepository();
    controller = new MetricsController(
      new MetricsService(
        repository,
        new FixedClock(new Date('2026-11-04T12:00:00.000Z')),
      ),
    );
  });

  it('answers the current month when no period is given', async () => {
    const response = await controller.overview({});

    expect(response).toMatchObject({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-11-30T23:59:59.999Z',
      delinquencyRate: null,
    });
  });

  it('forwards the requested period, treating a date-only to as inclusive', async () => {
    await controller.overview({ from: '2026-10-01', to: '2026-10-31' });

    expect(repository.requestedPeriods).toEqual([
      {
        from: new Date('2026-10-01T00:00:00.000Z'),
        to: new Date('2026-10-31T23:59:59.999Z'),
      },
    ]);
  });
});
