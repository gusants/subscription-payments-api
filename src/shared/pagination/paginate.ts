import type { Paginated, PaginationQuery } from './pagination.schema.js';

export function toSkipTake({ page, limit }: PaginationQuery) {
  return { skip: (page - 1) * limit, take: limit };
}

export function paginate<T>(
  data: T[],
  total: number,
  { page, limit }: PaginationQuery,
): Paginated<T> {
  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}
