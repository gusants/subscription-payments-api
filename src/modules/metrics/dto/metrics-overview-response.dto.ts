import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const metricsOverviewResponseSchema = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  monthlyRecurringRevenueCents: z.number().int().nonnegative(),
  activeSubscriptions: z.number().int().nonnegative(),
  pastDueSubscriptions: z.number().int().nonnegative(),
  delinquencyRate: z.number().min(0).max(1).nullable(),
  revenueByMonth: z.array(
    z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      revenueCents: z.number().int().nonnegative(),
    }),
  ),
  subscriptionsByStatus: z.object({
    incomplete: z.number().int().nonnegative(),
    active: z.number().int().nonnegative(),
    past_due: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
  }),
});

export type MetricsOverviewResponse = z.infer<
  typeof metricsOverviewResponseSchema
>;

export class MetricsOverviewResponseDto extends createZodDto(
  metricsOverviewResponseSchema,
) {}
