import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { RenewalCandidate } from './charge.js';
import { RenewalsRepository } from './renewals.repository.js';

@Injectable()
export class PrismaRenewalsRepository extends RenewalsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findDue(now: Date, limit: number): Promise<RenewalCandidate[]> {
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT s.id
      FROM subscriptions s
      WHERE s.status = 'active'
        AND s.current_period_end <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM charges c
          WHERE c.subscription_id = s.id
            AND c.period_start = s.current_period_end
        )
      ORDER BY s.current_period_end ASC, s.id ASC
      LIMIT ${limit}`;
    const found = await this.prisma.subscription.findMany({
      where: { id: { in: due.map(({ id }) => id) } },
      include: { plan: { select: { amountCents: true, interval: true } } },
      orderBy: [{ currentPeriodEnd: 'asc' }, { id: 'asc' }],
    });
    return found.map(({ plan, ...subscription }) => ({ subscription, plan }));
  }
}
