import { z } from 'zod';
import { CHARGE_STATUSES } from '../charge-status.js';

export const chargeSummaryResponseSchema = z.object({
  id: z.string(),
  status: z.enum(CHARGE_STATUSES),
  amountCents: z.number().int(),
  failureReason: z
    .string()
    .optional()
    .meta({ description: 'Present only when the gateway declined the charge' }),
});

export type ChargeSummaryResponse = z.infer<typeof chargeSummaryResponseSchema>;
