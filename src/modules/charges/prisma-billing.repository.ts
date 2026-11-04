import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { ConflictError } from '../../shared/errors/index.js';
import type {
  NewSubscription,
  StatusChange,
} from '../subscriptions/subscription.js';
import { BillingRepository } from './billing.repository.js';
import type { ChargeStatus } from './charge-status.js';
import type {
  AttachedGatewayCharge,
  Charge,
  ChargeOutcomeRecord,
  GatewayAttempt,
  NewCharge,
  RecordedOutcome,
  SubscriptionWithCharge,
} from './charge.js';
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

  recordChargeOutcome({
    charge,
    attempt,
    subscription,
  }: ChargeOutcomeRecord): Promise<RecordedOutcome> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.charge.updateMany({
        where: { id: charge.id, status: { in: [...charge.fromAnyOf] } },
        data: {
          status: charge.to,
          gatewayChargeId: charge.gatewayChargeId,
          paidAt: charge.paidAt,
          attemptCount: { increment: 1 },
        },
      });
      if (count === 0) {
        throw new ConflictError(
          `Charge ${charge.id} was modified concurrently`,
        );
      }
      await tx.paymentAttempt.create({ data: attempt });
      const changed = subscription.change
        ? await this.changeSubscription(
            tx,
            subscription.id,
            subscription.change,
          )
        : null;
      return {
        subscriptionChangeApplied: changed === null || changed.count > 0,
        subscription: await tx.subscription.findUniqueOrThrow({
          where: { id: subscription.id },
        }),
        charge: toCharge(
          await tx.charge.findUniqueOrThrow({ where: { id: charge.id } }),
        ),
      };
    });
  }

  private async findChargeOrThrow(id: string): Promise<Charge> {
    return toCharge(
      await this.prisma.charge.findUniqueOrThrow({ where: { id } }),
    );
  }

  private changeSubscription(
    tx: Prisma.TransactionClient,
    id: string,
    { fromAnyOf, to, canceledAt }: StatusChange,
  ): Prisma.PrismaPromise<Prisma.BatchPayload> {
    return tx.subscription.updateMany({
      where: { id, status: { in: [...fromAnyOf] } },
      data: { status: to, ...(canceledAt && { canceledAt }) },
    });
  }
}
