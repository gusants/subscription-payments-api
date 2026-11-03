import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PAYMENT_METHODS } from '../../subscriptions/subscription.js';
import { CHARGE_STATUSES, PAYMENT_ATTEMPT_RESULTS } from '../charge-status.js';

export const paymentAttemptResponseSchema = z.object({
  id: z.string(),
  result: z.enum(PAYMENT_ATTEMPT_RESULTS),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});

export const chargeHistoryItemResponseSchema = z.object({
  id: z.string(),
  subscriptionId: z.string(),
  amountCents: z.number().int(),
  method: z.enum(PAYMENT_METHODS),
  status: z.enum(CHARGE_STATUSES),
  attemptCount: z.number().int(),
  dueDate: z.iso.datetime(),
  periodStart: z.iso.datetime(),
  periodEnd: z.iso.datetime(),
  paidAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  attempts: z
    .array(paymentAttemptResponseSchema)
    .meta({ description: 'Gateway attempts, oldest first' }),
});

export type ChargeHistoryItemResponse = z.infer<
  typeof chargeHistoryItemResponseSchema
>;

export class ChargeHistoryItemResponseDto extends createZodDto(
  chargeHistoryItemResponseSchema,
) {}
