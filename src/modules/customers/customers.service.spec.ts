import { ConflictError, NotFoundError } from '../../shared/errors/index.js';
import { CustomersService } from './customers.service.js';
import { InMemoryCustomersRepository } from './testing/in-memory-customers.repository.js';

describe('CustomersService', () => {
  let repository: InMemoryCustomersRepository;
  let service: CustomersService;

  beforeEach(() => {
    repository = new InMemoryCustomersRepository();
    service = new CustomersService(repository);
  });

  const ana = { name: 'Ana Souza', email: 'ana@example.com' };
  const bruno = { name: 'Bruno Lima', email: 'bruno@acme.io' };

  describe('create', () => {
    it('creates a customer with a prefixed id', async () => {
      const customer = await service.create(ana);

      expect(customer).toMatchObject(ana);
      expect(customer.id).toMatch(/^cus_[0-9a-z]{26}$/);
    });

    it('rejects a duplicate email with ConflictError', async () => {
      await service.create(ana);

      await expect(
        service.create({ name: 'Other', email: ana.email }),
      ).rejects.toBeInstanceOf(ConflictError);
    });
  });

  describe('list', () => {
    it('paginates customers in creation order', async () => {
      await service.create(ana);
      await service.create(bruno);

      const result = await service.list({ page: 2, limit: 1 });

      expect(result.data.map(({ name }) => name)).toEqual(['Bruno Lima']);
      expect(result.meta).toEqual({
        page: 2,
        limit: 1,
        total: 2,
        totalPages: 2,
      });
    });

    it.each([
      ['name, case-insensitive', 'SOUZA'],
      ['email, case-insensitive', 'ACME'],
    ])('searches by %s', async (_label, search) => {
      await service.create(ana);
      await service.create(bruno);

      const result = await service.list({ page: 1, limit: 20, search });

      expect(result.data).toHaveLength(1);
    });

    it('filters by subscription status', async () => {
      const withActive = await service.create(ana);
      const withCanceled = await service.create(bruno);
      repository.addSubscription(withActive.id, subscription('active'));
      repository.addSubscription(withCanceled.id, subscription('canceled'));

      const result = await service.list({
        page: 1,
        limit: 20,
        subscriptionStatus: 'active',
      });

      expect(result.data.map(({ id }) => id)).toEqual([withActive.id]);
    });
  });

  describe('getDetail', () => {
    it('returns the customer with its subscriptions', async () => {
      const customer = await service.create(ana);
      const active = subscription('active');
      repository.addSubscription(customer.id, active);

      const detail = await service.getDetail(customer.id);

      expect(detail.subscriptions).toEqual([active]);
    });

    it('throws NotFoundError for an unknown id', async () => {
      await expect(service.getDetail('cus_missing')).rejects.toBeInstanceOf(
        NotFoundError,
      );
    });
  });
});

function subscription(status: 'active' | 'canceled') {
  return {
    id: `sub_${status}`,
    planId: 'plan_1',
    status,
    currentPeriodEnd: new Date('2026-12-03T00:00:00.000Z'),
  };
}
