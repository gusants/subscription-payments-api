import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { PAYMENT_BEHAVIORS, RISK_LEVELS } from '../domain/index.js';

export const customerSummaryMetricsSchema = z.object({
  monthsAsCustomer: z.number().int().nonnegative(),
  totalPaidCents: z.number().int().nonnegative(),
  failedAttempts: z.number().int().nonnegative(),
  averageDaysLate: z.number().nonnegative().nullable(),
  paymentSuccessRate: z.number().min(0).max(1).nullable(),
});

export const customerSummaryResponseSchema = z.object({
  customerId: z.string(),
  source: z.enum(['llm', 'fallback']),
  promptVersion: z.string(),
  generatedAt: z.iso.datetime(),
  metrics: customerSummaryMetricsSchema,
  summary: z.string(),
  paymentBehavior: z.enum(PAYMENT_BEHAVIORS),
  riskLevel: z.enum(RISK_LEVELS),
  suggestedAction: z.string(),
});

export type CustomerSummaryResponse = z.infer<
  typeof customerSummaryResponseSchema
>;

export class CustomerSummaryResponseDto extends createZodDto(
  customerSummaryResponseSchema,
) {}
