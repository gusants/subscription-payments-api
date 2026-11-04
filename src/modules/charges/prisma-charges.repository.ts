import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { PageWindow } from '../customers/customer.js';
import type {
  Charge,
  ChargePage,
  ChargeWithAttempts,
  ChargeWithSubscription,
} from './charge.js';
import type { DunningFollowUpCutoff } from './domain/dunning-recovery.js';
import { ChargesRepository } from './charges.repository.js';
import { toCharge } from './prisma-charge.mapper.js';

const withAttempts = {
  attempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ChargeInclude;

type StoredCharge = Prisma.ChargeGetPayload<{ include: typeof withAttempts }>;

const toChargeWithAttempts = ({
  attempts,
  ...charge
}: StoredCharge): ChargeWithAttempts => ({ ...toCharge(charge), attempts });

@Injectable()
export class PrismaChargesRepository extends ChargesRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findWithSubscription(
    id: string,
  ): Promise<ChargeWithSubscription | null> {
    const found = await this.prisma.charge.findUnique({
      where: { id },
      include: { subscription: true },
    });
    if (!found) return null;
    const { subscription, ...charge } = found;
    return { charge: toCharge(charge), subscription };
  }

  async findLiveByPeriod(
    subscriptionId: string,
    periodStart: Date,
  ): Promise<Charge | null> {
    const found = await this.prisma.charge.findFirst({
      where: { subscriptionId, periodStart, status: { not: 'expired' } },
    });
    return found && toCharge(found);
  }

  async findNewestByPeriod(
    subscriptionId: string,
    periodStart: Date,
  ): Promise<Charge | null> {
    const found = await this.prisma.charge.findFirst({
      where: { subscriptionId, periodStart },
      orderBy: [{ retryCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    return found && toCharge(found);
  }

  async findStalePendingCharges(
    attemptStartedBefore: Date,
    limit: number,
  ): Promise<Charge[]> {
    const found = await this.prisma.charge.findMany({
      where: {
        status: 'pending',
        AND: [
          { OR: [{ method: 'card' }, { gatewayChargeId: null }] },
          {
            OR: [
              { attemptStartedAt: { lt: attemptStartedBefore } },
              {
                attemptStartedAt: null,
                createdAt: { lt: attemptStartedBefore },
              },
            ],
          },
          {
            subscription: {
              OR: [
                { paymentMethod: { not: 'card' } },
                { cardToken: { not: null } },
              ],
            },
          },
        ],
      },
      orderBy: [
        { attemptStartedAt: { sort: 'asc', nulls: 'first' } },
        { id: 'asc' },
      ],
      take: limit,
    });
    return found.map(toCharge);
  }

  async findOverdueDunningFollowUps(
    cutoffs: readonly DunningFollowUpCutoff[],
    limit: number,
  ): Promise<ChargeWithSubscription[]> {
    const cutoffRows = Prisma.join(
      cutoffs.map(
        ({ retryCount, failedBefore }) =>
          Prisma.sql`(${retryCount}::int, ${failedBefore}::timestamptz)`,
      ),
    );
    const overdue = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT c.id
      FROM charges c
      JOIN subscriptions s ON s.id = c.subscription_id
      JOIN (VALUES ${cutoffRows}) AS cutoff(retry_count, failed_before)
        ON cutoff.retry_count = c.retry_count
       AND c.first_failed_at < cutoff.failed_before
      WHERE c.status IN ('failed', 'expired')
        AND s.status <> 'canceled'
        AND (s.payment_method <> 'card' OR COALESCE(s.card_token, '') <> '')
        AND NOT EXISTS (
          SELECT 1 FROM charges sibling
          WHERE sibling.subscription_id = c.subscription_id
            AND sibling.period_start = c.period_start
            AND sibling.id <> c.id
            AND (
              sibling.status <> 'expired'
              OR sibling.retry_count > c.retry_count
            )
        )
      ORDER BY c.first_failed_at ASC, c.id ASC
      LIMIT ${limit}`;
    const found = await this.prisma.charge.findMany({
      where: { id: { in: overdue.map(({ id }) => id) } },
      include: { subscription: true },
      orderBy: [{ firstFailedAt: 'asc' }, { id: 'asc' }],
    });
    return found.map(({ subscription, ...charge }) => ({
      charge: toCharge(charge),
      subscription,
    }));
  }

  async findWithAttempts(id: string): Promise<ChargeWithAttempts | null> {
    const found = await this.prisma.charge.findUnique({
      where: { id },
      include: withAttempts,
    });
    return found && toChargeWithAttempts(found);
  }

  async listByCustomer(
    customerId: string,
    { skip, take }: PageWindow,
  ): Promise<ChargePage> {
    const where = { subscription: { customerId } };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.charge.findMany({
        where,
        include: withAttempts,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.charge.count({ where }),
    ]);
    return { items: items.map(toChargeWithAttempts), total };
  }
}
