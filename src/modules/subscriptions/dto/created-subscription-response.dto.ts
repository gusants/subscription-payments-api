import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { chargeSummaryResponseSchema } from '../../charges/dto/charge-summary-response.dto.js';
import { subscriptionResponseSchema } from './subscription-response.dto.js';

export const createdSubscriptionResponseSchema =
  subscriptionResponseSchema.extend({
    latestCharge: chargeSummaryResponseSchema.nullable().meta({
      description:
        'Outcome of the first charge. Null for pix and boleto, which are charged in a later phase',
    }),
  });

export type CreatedSubscriptionResponse = z.infer<
  typeof createdSubscriptionResponseSchema
>;

export class CreatedSubscriptionResponseDto extends createZodDto(
  createdSubscriptionResponseSchema,
) {}
