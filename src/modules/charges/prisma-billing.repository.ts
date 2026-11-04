import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { NewSubscription } from '../subscriptions/subscription.js';
import { BillingRepository } from './billing.repository.js';
import type { ChargeStatus } from './charge-status.js';
import type {
  AttachedGatewayCharge,
  Charge,
  ChargeSettlementRecord,
  GatewayAttempt,
  NewCharge,
  RecordedOutcome,
  SubscriptionWithCharge,
} from './charge.js';
import { applyChargeOutcome } from './apply-charge-outcome.js';
import { toCharge } from './prisma-charge.mapper.js';

@Injectable()
export class PrismaBillingRepository extends BillingRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  createSubscriptionWithFirstCharge(
    subscription: NewSubscription,
    charge: NewCharge,
  ): Promise<SubscriptionWithCharge> {
    return this.prisma.$transaction(async (tx) => ({
      subscription: await tx.subscription.create({ data: subscription }),
      charge: toCharge(await tx.charge.create({ data: charge })),
    }));
  }

  async markChargePending(
    id: string,
    fromAnyOf: readonly ChargeStatus[],
    attempt: GatewayAttempt,
  ): Promise<Charge | null> {
    const { count } = await this.prisma.charge.updateMany({
      where: { id, status: { in: [...fromAnyOf] } },
      data: { status: 'pending', ...attempt },
    });
    return count === 0 ? null : this.findChargeOrThrow(id);
  }

  async takeAttemptLease(
    id: string,
    leaseExpiredBefore: Date,
    startedAt: Date,
  ): Promise<Charge | null> {
    const { count } = await this.prisma.charge.updateMany({
      where: {
        id,
        status: 'pending',
        OR: [
          { attemptStartedAt: null },
          { attemptStartedAt: { lt: leaseExpiredBefore } },
        ],
      },
      data: { attemptStartedAt: startedAt },
    });
    return count === 0 ? null : this.findChargeOrThrow(id);
  }

  async attachGatewayCharge(
    id: string,
    { gatewayChargeId, expiresAt, paymentInstructions }: AttachedGatewayCharge,
  ): Promise<Charge | null> {
    const { count } = await this.prisma.charge.updateMany({
      where: { id, status: 'pending' },
      data: {
        gatewayChargeId,
        expiresAt,
        ...(paymentInstructions && { paymentInstructions }),
      },
    });
    return count === 0 ? null : this.findChargeOrThrow(id);
  }

  recordChargeOutcome(
    record: ChargeSettlementRecord,
  ): Promise<RecordedOutcome> {
    return this.prisma.$transaction((tx) => applyChargeOutcome(tx, record));
  }

  private async findChargeOrThrow(id: string): Promise<Charge> {
    return toCharge(
      await this.prisma.charge.findUniqueOrThrow({ where: { id } }),
    );
  }
}
