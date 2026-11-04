import type { Prisma } from '../../generated/prisma/client.js';
import { ConflictError } from '../../shared/errors/index.js';
import type { StatusChange } from '../subscriptions/subscription.js';
import type {
  ChargeSettlement,
  ChargeSettlementRecord,
  RecordedOutcome,
} from './charge.js';
import { ChargeSettlementConflictError } from './charge-settlement-conflict.error.js';
import { toCharge } from './prisma-charge.mapper.js';

export function changeSubscription(
  tx: Prisma.TransactionClient,
  id: string,
  { fromAnyOf, to, canceledAt }: StatusChange,
): Prisma.PrismaPromise<Prisma.BatchPayload> {
  return tx.subscription.updateMany({
    where: { id, status: { in: [...fromAnyOf] } },
    data: { status: to, ...(canceledAt && { canceledAt }) },
  });
}

async function currentStateOfIdenticalSettlement(
  tx: Prisma.TransactionClient,
  expected: ChargeSettlement,
  subscriptionId: string,
): Promise<RecordedOutcome> {
  const current = await tx.charge.findUnique({ where: { id: expected.id } });
  const settledIdentically =
    current?.status === expected.to &&
    current.gatewayChargeId === expected.gatewayChargeId;
  if (!current) {
    throw new ConflictError(`Charge ${expected.id} was modified concurrently`, {
      transient: true,
    });
  }
  if (!settledIdentically) {
    throw new ChargeSettlementConflictError(
      current.id,
      current.status,
      current.gatewayChargeId,
    );
  }
  return {
    subscriptionChangeApplied: true,
    subscription: await tx.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    }),
    charge: toCharge(current),
  };
}

export async function applyChargeOutcome(
  tx: Prisma.TransactionClient,
  { charge, attempt, subscription }: ChargeSettlementRecord,
): Promise<RecordedOutcome> {
  const { count } = await tx.charge.updateMany({
    where: { id: charge.id, status: { in: [...charge.fromAnyOf] } },
    data: {
      status: charge.to,
      gatewayChargeId: charge.gatewayChargeId ?? undefined,
      paidAt: charge.paidAt,
      ...(attempt && { attemptCount: { increment: 1 } }),
    },
  });
  if (count === 0) {
    return currentStateOfIdenticalSettlement(tx, charge, subscription.id);
  }
  if (charge.firstFailedAt) {
    await tx.charge.updateMany({
      where: { id: charge.id, firstFailedAt: null },
      data: { firstFailedAt: charge.firstFailedAt },
    });
  }
  if (attempt) await tx.paymentAttempt.create({ data: attempt });
  if (subscription.period) {
    await tx.subscription.updateMany({
      where: {
        id: subscription.id,
        currentPeriodEnd: { lt: subscription.period.end },
      },
      data: {
        currentPeriodStart: subscription.period.start,
        currentPeriodEnd: subscription.period.end,
      },
    });
  }
  const changed = subscription.change
    ? await changeSubscription(tx, subscription.id, subscription.change)
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
}
