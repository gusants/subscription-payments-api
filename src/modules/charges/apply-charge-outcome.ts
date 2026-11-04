import type { Prisma } from '../../generated/prisma/client.js';
import { ConflictError } from '../../shared/errors/index.js';
import type { StatusChange } from '../subscriptions/subscription.js';
import type { ChargeSettlementRecord, RecordedOutcome } from './charge.js';
import { toCharge } from './prisma-charge.mapper.js';

function changeSubscription(
  tx: Prisma.TransactionClient,
  id: string,
  { fromAnyOf, to, canceledAt }: StatusChange,
): Prisma.PrismaPromise<Prisma.BatchPayload> {
  return tx.subscription.updateMany({
    where: { id, status: { in: [...fromAnyOf] } },
    data: { status: to, ...(canceledAt && { canceledAt }) },
  });
}

export async function applyChargeOutcome(
  tx: Prisma.TransactionClient,
  { charge, attempt, subscription }: ChargeSettlementRecord,
): Promise<RecordedOutcome> {
  const { count } = await tx.charge.updateMany({
    where: { id: charge.id, status: { in: [...charge.fromAnyOf] } },
    data: {
      status: charge.to,
      gatewayChargeId: charge.gatewayChargeId,
      paidAt: charge.paidAt,
      ...(attempt && { attemptCount: { increment: 1 } }),
    },
  });
  if (count === 0) {
    throw new ConflictError(`Charge ${charge.id} was modified concurrently`);
  }
  if (attempt) await tx.paymentAttempt.create({ data: attempt });
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
