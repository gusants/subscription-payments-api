import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const metricsOverviewResponseSchema = z.object({
  from: z.iso.datetime().meta({
    description:
      'Start of the requested period; bounds only the two period-scoped fields',
  }),
  to: z.iso.datetime().meta({
    description:
      'End of the requested period; bounds only the two period-scoped fields',
  }),
  monthlyRecurringRevenueCents: z.number().int().nonnegative().meta({
    description:
      'Current state, not filtered by the period: active subscriptions priced at each plan current amount, yearly plans divided by 12',
  }),
  activeSubscriptions: z.number().int().nonnegative().meta({
    description: 'Current state, not filtered by the period',
  }),
  pastDueSubscriptions: z.number().int().nonnegative().meta({
    description: 'Current state, not filtered by the period',
  }),
  delinquencyRate: z.number().min(0).max(1).nullable().meta({
    description:
      '(pastDue + canceledForPaymentFailure) / (active + pastDue + canceledForPaymentFailure). Mixes current counts with cancellations for payment failure whose canceled_at falls inside the period. Null when the denominator is 0',
  }),
  revenueByMonth: z
    .array(
      z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/),
        revenueCents: z.number().int().nonnegative(),
      }),
    )
    .meta({
      description:
        'Period-scoped: paid charges grouped by UTC month of paid_at inside the period. Charges paid after their subscription was canceled are excluded because the money is refund-due',
    }),
  subscriptionsByStatus: z
    .object({
      incomplete: z.number().int().nonnegative(),
      active: z.number().int().nonnegative(),
      past_due: z.number().int().nonnegative(),
      canceled: z.number().int().nonnegative(),
    })
    .meta({
      description: 'Current state, not filtered by the period',
    }),
});

export type MetricsOverviewResponse = z.infer<
  typeof metricsOverviewResponseSchema
>;

export class MetricsOverviewResponseDto extends createZodDto(
  metricsOverviewResponseSchema,
) {}
