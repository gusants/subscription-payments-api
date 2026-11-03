import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SUBSCRIPTION_STATUSES } from '../../subscriptions/subscription-status.js';
import { chargeHistoryItemResponseSchema } from './charge-history-item-response.dto.js';

export const chargeRetryResponseSchema = z.object({
  charge: chargeHistoryItemResponseSchema,
  subscription: z.object({
    id: z.string(),
    status: z.enum(SUBSCRIPTION_STATUSES),
  }),
});

export type ChargeRetryResponse = z.infer<typeof chargeRetryResponseSchema>;

export class ChargeRetryResponseDto extends createZodDto(
  chargeRetryResponseSchema,
) {}
