import { PlansController } from './plans.controller.js';
import { PlansService } from './plans.service.js';
import { InMemoryPlansRepository } from './testing/in-memory-plans.repository.js';

describe('PlansController', () => {
  let controller: PlansController;

  beforeEach(() => {
    controller = new PlansController(
      new PlansService(new InMemoryPlansRepository()),
    );
  });

  it('creates a plan and serializes it', async () => {
    const created = await controller.create({
      name: 'Basic',
      amountCents: 1990,
      interval: 'monthly',
    });

    expect(created).toMatchObject({ name: 'Basic', active: true });
    expect(typeof created.createdAt).toBe('string');
  });

  it('lists serialized plans with pagination meta', async () => {
    await controller.create({
      name: 'Basic',
      amountCents: 1990,
      interval: 'monthly',
    });

    const result = await controller.list({ page: 1, limit: 20 });

    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });
});
