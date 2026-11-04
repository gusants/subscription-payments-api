import { Injectable } from '@nestjs/common';
import {
  isPrismaError,
  PRISMA_UNIQUE_CONSTRAINT_VIOLATION,
} from '../../shared/database/prisma-error-codes.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import type { NewSubscription } from '../subscriptions/subscription.js';
import { BillingRepository } from './billing.repository.js';
import type { ChargeStatus } from './charge-status.js';
import type {
  AttachedGatewayCharge,
  Charge,
  ChargeSettlementRecord,
  DunningExhaustion,
  GatewayAttempt,
  NewCharge,
  RecordedOutcome,
  SubscriptionWithCharge,
} from './charge.js';
import {
  applyChargeOutcome,
  changeSubscription,
} from './apply-charge-outcome.js';
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
    retryNumber: number,
  ): Promise<Charge | null> {
    const { count } = await this.prisma.charge.updateMany({
      where: {
        id,
        status: { in: [...fromAnyOf] },
        retryCount: retryNumber - 1,
      },
      data: { status: 'pending', retryCount: retryNumber, ...attempt },
    });
    return count === 0 ? null : this.findChargeOrThrow(id);
  }

  async createRetryCharge(charge: NewCharge): Promise<Charge | null> {
    try {
      return toCharge(await this.prisma.charge.create({ data: charge }));
    } catch (error) {
      if (isPrismaError(error, PRISMA_UNIQUE_CONSTRAINT_VIOLATION)) return null;
      throw error;
    }
  }

  recordDunningExhaustion({
    charge,
    subscription,
  }: DunningExhaustion): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (charge) {
        const { count } = await tx.charge.updateMany({
          where: { id: charge.id, status: { in: [...charge.fromAnyOf] } },
          data: { status: 'uncollectible' },
        });
        if (count === 0) return false;
      }
      const canceled = subscription.change
        ? await changeSubscription(tx, subscription.id, subscription.change)
        : null;
      return charge !== null || (canceled?.count ?? 0) > 0;
    });
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
