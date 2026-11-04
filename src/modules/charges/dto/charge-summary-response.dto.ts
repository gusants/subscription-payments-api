import { z } from 'zod';
import { paymentInstructionsSchema } from '../../../gateway/payment-instructions.js';
import { CHARGE_STATUSES } from '../charge-status.js';

export const chargeSummaryResponseSchema = z.object({
  id: z.string(),
  status: z.enum(CHARGE_STATUSES),
  amountCents: z.number().int(),
  failureReason: z
    .string()
    .optional()
    .meta({ description: 'Present only when the gateway declined the charge' }),
  expiresAt: z.iso.datetime().optional().meta({
    description: 'Present only on pix and boleto charges: when payment expires',
  }),
  paymentInstructions: paymentInstructionsSchema.optional().meta({
    description:
      'Present only on pix and boleto charges: what the customer pays with',
  }),
});

export type ChargeSummaryResponse = z.infer<typeof chargeSummaryResponseSchema>;
