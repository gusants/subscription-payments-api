import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PAYMENT_METHODS } from '../subscription.js';

export const createSubscriptionSchema = z.object({
  customerId: z.string().trim().min(1),
  planId: z.string().trim().min(1),
  paymentMethod: z.enum(PAYMENT_METHODS),
});

export class CreateSubscriptionDto extends createZodDto(
  createSubscriptionSchema,
) {}
