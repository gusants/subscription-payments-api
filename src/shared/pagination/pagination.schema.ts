import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
export const MAX_PAGE = 10_000;

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(DEFAULT_PAGE),
  limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
});

export class PaginationQueryDto extends createZodDto(paginationQuerySchema) {}

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int(),
  limit: z.number().int(),
  total: z.number().int(),
  totalPages: z.number().int(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

export interface Paginated<T> {
  data: T[];
  meta: PaginationMeta;
}

export function paginatedResponseSchema<T extends z.ZodType>(item: T) {
  return z.object({ data: z.array(item), meta: paginationMetaSchema });
}
