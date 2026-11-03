import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/pagination/index.js';

export const listPlansQuerySchema = paginationQuerySchema.extend({
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export class ListPlansQueryDto extends createZodDto(listPlansQuerySchema) {}
