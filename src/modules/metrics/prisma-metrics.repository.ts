import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type {
  ActivePlanGroup,
  MetricsSnapshot,
  MonthlyRevenue,
  Period,
  SubscriptionStatusCount,
} from './domain/index.js';
import { MetricsRepository } from './metrics.repository.js';

interface RevenueRow {
  month: string;
  revenue_cents: bigint;
}

@Injectable()
export class PrismaMetricsRepository extends MetricsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async loadSnapshot(period: Period): Promise<MetricsSnapshot> {
    const [
      statusCounts,
      activePlans,
      paymentFailedCancellations,
      paidRevenueByMonth,
    ] = await Promise.all([
      this.countByStatus(),
      this.activePlanGroups(),
      this.countPaymentFailedCancellations(period),
      this.paidRevenueByMonth(period),
    ]);
    return {
      statusCounts,
      activePlans,
      paymentFailedCancellations,
      paidRevenueByMonth,
    };
  }

  private async countByStatus(): Promise<SubscriptionStatusCount[]> {
    const groups = await this.prisma.subscription.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return groups.map(({ status, _count }) => ({
      status,
      count: _count._all,
    }));
  }

  private async activePlanGroups(): Promise<ActivePlanGroup[]> {
    const plans = await this.prisma.plan.findMany({
      select: {
        interval: true,
        amountCents: true,
        _count: {
          select: { subscriptions: { where: { status: 'active' } } },
        },
      },
    });
    return plans
      .map(({ interval, amountCents, _count }) => ({
        interval,
        amountCents,
        subscriptions: _count.subscriptions,
      }))
      .filter(({ subscriptions }) => subscriptions > 0);
  }

  private countPaymentFailedCancellations({
    from,
    to,
  }: Period): Promise<number> {
    return this.prisma.subscription.count({
      where: {
        status: 'canceled',
        cancelReason: 'payment_failed',
        canceledAt: { gte: from, lte: to },
      },
    });
  }

  private async paidRevenueByMonth({
    from,
    to,
  }: Period): Promise<MonthlyRevenue[]> {
    const rows = await this.prisma.$queryRaw<RevenueRow[]>`
      SELECT
        to_char(paid_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
        SUM(amount_cents)::bigint AS revenue_cents
      FROM charges
      WHERE status = 'paid'
        AND paid_at >= ${from}::timestamptz
        AND paid_at <= ${to}::timestamptz
      GROUP BY 1
      ORDER BY 1`;
    return rows.map(({ month, revenue_cents }) => ({
      month,
      revenueCents: Number(revenue_cents),
    }));
  }
}
