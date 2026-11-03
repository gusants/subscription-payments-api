import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { PrismaPlansRepository } from '../../src/modules/plans/prisma-plans.repository.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('PrismaPlansRepository (integration)', () => {
  let prisma: PrismaService;
  let repository: PrismaPlansRepository;

  beforeAll(() => {
    prisma = createPrismaService();
    repository = new PrismaPlansRepository(prisma);
  });

  beforeEach(async () => {
    await prisma.subscription.deleteMany();
    await prisma.plan.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const newPlan = (
    name: string,
    interval: 'monthly' | 'yearly' = 'monthly',
  ) => ({
    id: generateId(ID_PREFIXES.plan),
    name,
    amountCents: 1990,
    interval,
  });

  describe('create', () => {
    it('persists the plan with defaults and maps it to the domain type', async () => {
      const input = newPlan('Basic', 'yearly');

      const created = await repository.create(input);

      expect(created).toEqual({
        ...input,
        active: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
      expect(await prisma.plan.count()).toBe(1);
    });
  });

  describe('findById', () => {
    it('returns the stored plan', async () => {
      const created = await repository.create(newPlan('Basic'));

      expect(await repository.findById(created.id)).toEqual(created);
    });

    it('returns null for an unknown id', async () => {
      expect(await repository.findById('plan_missing')).toBeNull();
    });
  });

  describe('list', () => {
    it('returns the requested window ordered by id with the full total', async () => {
      await repository.create(newPlan('A'));
      const second = await repository.create(newPlan('B'));
      await repository.create(newPlan('C'));

      const page = await repository.list({}, { skip: 1, take: 1 });

      expect(page.items.map(({ id }) => id)).toEqual([second.id]);
      expect(page.total).toBe(3);
    });

    it('returns an empty window beyond the last page keeping the total', async () => {
      await repository.create(newPlan('A'));

      const page = await repository.list({}, { skip: 10, take: 5 });

      expect(page).toEqual({ items: [], total: 1 });
    });

    it('returns an empty page when there are no plans', async () => {
      expect(await repository.list({}, { skip: 0, take: 10 })).toEqual({
        items: [],
        total: 0,
      });
    });

    it.each([
      { active: true, expected: ['Kept'] },
      { active: false, expected: ['Retired'] },
      { active: undefined, expected: ['Kept', 'Retired'] },
    ])(
      'filters by active=$active with a matching total',
      async ({ active, expected }) => {
        await repository.create(newPlan('Kept'));
        const retired = await repository.create(newPlan('Retired'));
        await prisma.plan.update({
          where: { id: retired.id },
          data: { active: false },
        });

        const page = await repository.list({ active }, { skip: 0, take: 10 });

        expect(page.items.map(({ name }) => name)).toEqual(expected);
        expect(page.total).toBe(expected.length);
      },
    );
  });
});
