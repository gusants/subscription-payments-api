import { Injectable } from '@nestjs/common';
import { Clock } from '../../shared/clock/index.js';
import { ConflictError, NotFoundError } from '../../shared/errors/index.js';
import type { GatewayCharge } from '../payment-gateway.port.js';
import { toGatewayCharge } from './fake-gateway-charge.mapper.js';
import {
  FakeGatewayStore,
  type FakeGatewayData,
  type StoredGatewayCharge,
} from './fake-gateway.store.js';

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
  ) {}

  pay(externalRef: string): Promise<GatewayCharge> {
    return this.settlePending(externalRef, 'paid');
  }

  expire(externalRef: string): Promise<GatewayCharge> {
    return this.settlePending(externalRef, 'expired');
  }

  expireDue(): Promise<GatewayCharge[]> {
    const now = this.clock.now().getTime();
    return this.store.transaction((data) => {
      const due = data.charges.filter(
        (charge) =>
          charge.status === 'pending' &&
          charge.expiresAt !== undefined &&
          new Date(charge.expiresAt).getTime() <= now,
      );
      for (const charge of due) charge.status = 'expired';
      return due.map(toGatewayCharge);
    });
  }

  private settlePending(
    externalRef: string,
    status: AsynchronousStatus,
  ): Promise<GatewayCharge> {
    return this.store.transaction((data) => {
      const charge = findInvoiceCharge(data, externalRef);
      if (charge.status !== 'pending') {
        throw new ConflictError(
          `Charge ${externalRef} is ${charge.status}, not pending`,
        );
      }
      charge.status = status;
      return toGatewayCharge(charge);
    });
  }
}
