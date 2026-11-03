import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { ConflictError } from '../../shared/errors/index.js';
import type { NewSubscription } from '../subscriptions/subscription.js';
import { BillingRepository } from './billing.repository.js';
import type {
  ChargeOutcomeRecord,
  NewCharge,
  SubscriptionWithCharge,
} from './charge.js';

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
      charge: await tx.charge.create({ data: charge }),
    }));
  }

  recordChargeOutcome({
    charge,
    attempt,
    subscription,
  }: ChargeOutcomeRecord): Promise<SubscriptionWithCharge> {
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
      const { fromAnyOf, to, canceledAt } = subscription.change;
      await tx.subscription.updateMany({
        where: { id: subscription.id, status: { in: [...fromAnyOf] } },
        data: { status: to, ...(canceledAt && { canceledAt }) },
      });
      return {
        subscription: await tx.subscription.findUniqueOrThrow({
          where: { id: subscription.id },
        }),
        charge: await tx.charge.findUniqueOrThrow({ where: { id: charge.id } }),
      };
    });
  }
}
