import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { MetricsService } from './metrics.service.js';
import { InMemoryMetricsRepository } from './testing/in-memory-metrics.repository.js';

describe('MetricsService', () => {
  let repository: InMemoryMetricsRepository;
  let service: MetricsService;

  beforeEach(() => {
    repository = new InMemoryMetricsRepository();
    service = new MetricsService(
      repository,
      new FixedClock(new Date('2026-11-04T12:00:00.000Z')),
    );
  });

  it('defaults to the current UTC month', async () => {
    const overview = await service.getOverview(null);

    expect(overview.period).toEqual({
      from: new Date('2026-11-01T00:00:00.000Z'),
      to: new Date('2026-11-30T23:59:59.999Z'),
    });
    expect(repository.requestedPeriods).toEqual([overview.period]);
  });

  it('uses the requested period when given', async () => {
    const period = {
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-03-31T23:59:59.999Z'),
    };

    const overview = await service.getOverview(period);

    expect(overview.period).toBe(period);
    expect(overview.revenueByMonth.map(({ month }) => month)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
    ]);
  });
});
