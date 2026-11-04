import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { chargeSummaryResponseSchema } from '../../charges/dto/charge-summary-response.dto.js';
import { subscriptionResponseSchema } from './subscription-response.dto.js';

export const createdSubscriptionResponseSchema =
  subscriptionResponseSchema.extend({
    latestCharge: chargeSummaryResponseSchema.nullable().meta({
      description:
        'First charge of the subscription. Card charges settle immediately; pix and boleto stay pending and carry their expiry and payment instructions',
    }),
  });

export type CreatedSubscriptionResponse = z.infer<
  typeof createdSubscriptionResponseSchema
>;

export class CreatedSubscriptionResponseDto extends createZodDto(
  createdSubscriptionResponseSchema,
) {}
