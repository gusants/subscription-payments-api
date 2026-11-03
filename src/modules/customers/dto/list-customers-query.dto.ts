import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginationQuerySchema } from '../../../shared/pagination/index.js';
import { SUBSCRIPTION_STATUSES } from '../../subscriptions/subscription-status.js';

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).optional(),
  subscriptionStatus: z.enum(SUBSCRIPTION_STATUSES).optional(),
});

export class ListCustomersQueryDto extends createZodDto(
  listCustomersQuerySchema,
) {}
