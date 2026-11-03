import { InMemoryPlansRepository } from './testing/in-memory-plans.repository.js';
import { PlansService } from './plans.service.js';

describe('PlansService', () => {
  let repository: InMemoryPlansRepository;
  let service: PlansService;

  beforeEach(() => {
    repository = new InMemoryPlansRepository();
    service = new PlansService(repository);
  });

  const basic = {
    name: 'Basic',
    amountCents: 1990,
    interval: 'monthly',
  } as const;

  describe('create', () => {
    it('creates an active plan with a prefixed id', async () => {
      const plan = await service.create(basic);

      expect(plan).toMatchObject({ ...basic, active: true });
      expect(plan.id).toMatch(/^plan_[0-9a-z]{26}$/);
    });
  });

  describe('list', () => {
    it('paginates plans in creation order', async () => {
      const first = await service.create(basic);
      await service.create({ ...basic, name: 'Pro' });
      await service.create({ ...basic, name: 'Max' });

      const result = await service.list({ page: 1, limit: 2 });

      expect(result.data).toHaveLength(2);
      expect(result.data[0]!.id).toBe(first.id);
      expect(result.meta).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    });

    it('returns the remainder on the last page', async () => {
      await service.create(basic);
      await service.create({ ...basic, name: 'Pro' });

      const result = await service.list({ page: 2, limit: 1 });

      expect(result.data.map((plan) => plan.name)).toEqual(['Pro']);
    });

    it('filters by active flag', async () => {
      const retired = await service.create(basic);
      await service.create({ ...basic, name: 'Pro' });
      repository.deactivate(retired.id);

      const active = await service.list({ page: 1, limit: 20, active: true });
      const inactive = await service.list({
        page: 1,
        limit: 20,
        active: false,
      });

      expect(active.data.map((plan) => plan.name)).toEqual(['Pro']);
      expect(inactive.data.map((plan) => plan.name)).toEqual(['Basic']);
    });
  });
});
