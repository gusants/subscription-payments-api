import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PAYMENT_METHODS } from '../subscription.js';
import { SUBSCRIPTION_STATUSES } from '../subscription-status.js';

export const subscriptionResponseSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  planId: z.string(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  status: z.enum(SUBSCRIPTION_STATUSES),
  billingAnchor: z.iso.datetime(),
  currentPeriodStart: z.iso.datetime(),
  currentPeriodEnd: z.iso.datetime(),
  canceledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export class SubscriptionResponseDto extends createZodDto(
  subscriptionResponseSchema,
) {}
