import { NotFoundError } from '../../shared/errors/index.js';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { InMemoryCustomersRepository } from './testing/in-memory-customers.repository.js';

describe('CustomersController', () => {
  let controller: CustomersController;

  beforeEach(() => {
    controller = new CustomersController(
      new CustomersService(new InMemoryCustomersRepository()),
    );
  });

  const ana = { name: 'Ana', email: 'ana@example.com' };

  it('creates a customer and serializes it', async () => {
    const created = await controller.create(ana);

    expect(created).toMatchObject(ana);
    expect(typeof created.createdAt).toBe('string');
  });

  it('lists serialized customers with pagination meta', async () => {
    await controller.create(ana);

    const result = await controller.list({ page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });

  it('returns the customer detail', async () => {
    const { id } = await controller.create(ana);

    const detail = await controller.detail(id);

    expect(detail).toMatchObject({ id, subscriptions: [] });
  });

  it('propagates NotFoundError for an unknown customer', async () => {
    await expect(controller.detail('cus_missing')).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});
