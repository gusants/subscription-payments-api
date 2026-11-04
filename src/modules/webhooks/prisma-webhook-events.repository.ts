import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../shared/database/prisma.service.js';
import { applyChargeOutcome, toCharge } from '../charges/index.js';
import type {
  IncomingWebhookEvent,
  WebhookDecider,
  WebhookIngestion,
  WebhookTarget,
} from './webhook-event.js';
import { WebhookEventsRepository } from './webhook-events.repository.js';

@Injectable()
export class PrismaWebhookEventsRepository extends WebhookEventsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  ingest(
    event: IncomingWebhookEvent,
    decide: WebhookDecider,
  ): Promise<WebhookIngestion> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.webhookEvent.createMany({
        data: {
          id: event.id,
          gatewayEventId: event.gatewayEventId,
          type: event.type,
          gatewayChargeId: event.gatewayChargeId,
          payload: event.payload,
          receivedAt: event.at,
        },
        skipDuplicates: true,
      });
      if (count === 0) return { kind: 'duplicate' };
      const decision = decide(await this.lockTarget(tx, event));
      if (decision.outcome === 'applied') {
        await applyChargeOutcome(tx, decision.settlement);
      }
      await tx.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: event.at, outcome: decision.outcome },
      });
      return { kind: 'processed', outcome: decision.outcome };
    });
  }

  private async lockTarget(
    tx: Prisma.TransactionClient,
    { chargeId, gatewayChargeId }: IncomingWebhookEvent,
  ): Promise<WebhookTarget | null> {
    const [locked] = await tx.$queryRaw<{ subscription_id: string }[]>`
      SELECT subscription_id FROM charges WHERE id = ${chargeId} FOR UPDATE`;
    if (!locked) return null;
    await tx.$queryRaw`
      SELECT id FROM subscriptions WHERE id = ${locked.subscription_id} FOR UPDATE`;
    const { subscription, ...charge } = await tx.charge.findUniqueOrThrow({
      where: { id: chargeId },
      include: { subscription: true },
    });
    return {
      charge: toCharge(charge),
      subscription,
      attemptRecorded:
        (await tx.paymentAttempt.count({ where: { gatewayChargeId } })) > 0,
    };
  }
}
