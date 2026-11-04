import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { MetricsSnapshot, Period } from './domain/index.js';
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
      statusGroups,
      activePlanRows,
      paymentFailedCancellations,
      revenueRows,
    ] = await this.prisma.$transaction(
      [
        this.countByStatus(),
        this.activePlanGroups(),
        this.countPaymentFailedCancellations(period),
        this.paidRevenueByMonth(period),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    return {
      statusCounts: statusGroups.map(({ status, _count }) => ({
        status,
        count: _count._all,
      })),
      activePlans: activePlanRows
        .map(({ interval, amountCents, _count }) => ({
          interval,
          amountCents,
          subscriptions: _count.subscriptions,
        }))
        .filter(({ subscriptions }) => subscriptions > 0),
      paymentFailedCancellations,
      paidRevenueByMonth: revenueRows.map(({ month, revenue_cents }) => ({
        month,
        revenueCents: Number(revenue_cents),
      })),
    };
  }

  private countByStatus() {
    return this.prisma.subscription.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
  }

  private activePlanGroups() {
    return this.prisma.plan.findMany({
      select: {
        interval: true,
        amountCents: true,
        _count: {
          select: { subscriptions: { where: { status: 'active' } } },
        },
      },
    });
  }

  private countPaymentFailedCancellations({ from, to }: Period) {
    return this.prisma.subscription.count({
      where: {
        status: 'canceled',
        cancelReason: 'payment_failed',
        canceledAt: { gte: from, lte: to },
      },
    });
  }

  private paidRevenueByMonth({ from, to }: Period) {
    return this.prisma.$queryRaw<RevenueRow[]>`
      SELECT
        to_char(c.paid_at AT TIME ZONE 'UTC', 'YYYY-MM') AS month,
        SUM(c.amount_cents)::bigint AS revenue_cents
      FROM charges c
      JOIN subscriptions s ON s.id = c.subscription_id
      WHERE c.status = 'paid'
        AND c.paid_at >= ${from}::timestamptz
        AND c.paid_at <= ${to}::timestamptz
        AND NOT (s.status = 'canceled' AND c.paid_at > s.canceled_at)
      GROUP BY 1
      ORDER BY 1`;
  }
}
