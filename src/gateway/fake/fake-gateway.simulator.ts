import { Injectable } from '@nestjs/common';
import { Clock } from '../../shared/clock/index.js';
import { ConflictError, NotFoundError } from '../../shared/errors/index.js';
import type { GatewayCharge } from '../payment-gateway.port.js';
import { appendChargeEvents } from './fake-gateway-events.js';
import { toGatewayCharge } from './fake-gateway-charge.mapper.js';
import {
  FakeGatewayStore,
  type FakeGatewayData,
  type StoredGatewayCharge,
} from './fake-gateway.store.js';
import { FakeWebhookDispatcher } from './webhook/fake-webhook.dispatcher.js';

type AsynchronousStatus = Extract<
  StoredGatewayCharge['status'],
  'paid' | 'expired'
>;

function findInvoiceCharge(
  data: FakeGatewayData,
  externalRef: string,
): StoredGatewayCharge {
  const charge = data.charges.findLast(
    (stored) => stored.externalRef === externalRef,
  );
  if (!charge) {
    throw new NotFoundError(`Gateway charge for ${externalRef} not found`);
  }
  if (charge.method === 'card') {
    throw new ConflictError(`Charge ${externalRef} is paid by card`);
  }
  return charge;
}

@Injectable()
export class FakeGatewaySimulator {
  constructor(
    private readonly store: FakeGatewayStore,
    private readonly clock: Clock,
    private readonly webhooks: FakeWebhookDispatcher,
  ) {}

  pay(externalRef: string): Promise<GatewayCharge> {
    return this.settlePending(externalRef, 'paid');
  }

  expire(externalRef: string): Promise<GatewayCharge> {
    return this.settlePending(externalRef, 'expired');
  }

  async expireDue(): Promise<GatewayCharge[]> {
    const at = this.clock.now();
    const { charges, events } = await this.store.transaction((data) => {
      const due = data.charges.filter(
        (charge) =>
          charge.status === 'pending' &&
          charge.expiresAt !== undefined &&
          new Date(charge.expiresAt).getTime() <= at.getTime(),
      );
      for (const charge of due) charge.status = 'expired';
      return {
        charges: due.map(toGatewayCharge),
        events: appendChargeEvents(data, due, at),
      };
    });
    this.webhooks.schedule(events);
    return charges;
  }

  private async settlePending(
    externalRef: string,
    status: AsynchronousStatus,
  ): Promise<GatewayCharge> {
    const at = this.clock.now();
    const { charge, events } = await this.store.transaction((data) => {
      const found = findInvoiceCharge(data, externalRef);
      if (found.status !== 'pending') {
        throw new ConflictError(
          `Charge ${externalRef} is ${found.status}, not pending`,
        );
      }
      found.status = status;
      if (status === 'paid') found.paidAt = at.toISOString();
      return {
        charge: toGatewayCharge(found),
        events: appendChargeEvents(data, [found], at),
      };
    });
    this.webhooks.schedule(events);
    return charge;
  }
}
