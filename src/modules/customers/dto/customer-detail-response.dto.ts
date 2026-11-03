import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SUBSCRIPTION_STATUSES } from '../../subscriptions/subscription-status.js';
import { customerResponseSchema } from './customer-response.dto.js';

export const subscriptionSummarySchema = z.object({
  id: z.string(),
  planId: z.string(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  currentPeriodEnd: z.iso.datetime(),
});

export const customerDetailResponseSchema = customerResponseSchema.extend({
  subscriptions: z.array(subscriptionSummarySchema),
});

export type CustomerDetailResponse = z.infer<
  typeof customerDetailResponseSchema
>;

export class CustomerDetailResponseDto extends createZodDto(
  customerDetailResponseSchema,
) {}
