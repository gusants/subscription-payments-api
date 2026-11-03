import { paginate, toSkipTake } from './paginate.js';
import { paginationQuerySchema } from './pagination.schema.js';

describe('paginationQuerySchema', () => {
  it('applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces strings', () => {
    expect(paginationQuerySchema.parse({ page: '3', limit: '50' })).toEqual({
      page: 3,
      limit: 50,
    });
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { limit: '0' },
    { limit: '101' },
    { limit: 'abc' },
  ])('rejects %j', (query) => {
    expect(paginationQuerySchema.safeParse(query).success).toBe(false);
  });
});

describe('toSkipTake', () => {
  it('computes the offset from page and limit', () => {
    expect(toSkipTake({ page: 3, limit: 10 })).toEqual({ skip: 20, take: 10 });
  });
});

describe('paginate', () => {
  it('builds data and meta', () => {
    expect(paginate(['a', 'b'], 45, { page: 2, limit: 20 })).toEqual({
      data: ['a', 'b'],
      meta: { page: 2, limit: 20, total: 45, totalPages: 3 },
    });
  });

  it('reports zero pages for an empty result', () => {
    expect(paginate([], 0, { page: 1, limit: 20 }).meta.totalPages).toBe(0);
  });
});
