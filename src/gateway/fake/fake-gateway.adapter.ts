import { Injectable } from '@nestjs/common';
import { Clock } from '../../shared/clock/index.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import {
  PaymentGateway,
  type CreateGatewayCharge,
  type CreateGatewayCustomer,
  type GatewayCharge,
  type GatewayCustomer,
  type GatewayFailureReason,
} from '../payment-gateway.port.js';
import {
  FakeGatewayStore,
  type StoredGatewayCharge,
} from './fake-gateway.store.js';

type ChargeOutcome =
  | { status: 'paid' }
  | { status: 'failed'; failureReason: GatewayFailureReason };

const PAID: ChargeOutcome = { status: 'paid' };

const declined = (failureReason: GatewayFailureReason): ChargeOutcome => ({
  status: 'failed',
  failureReason,
});

const FIRST_ATTEMPT = 1;

function decideOutcome(cardToken: string, attempt: number): ChargeOutcome {
  switch (cardToken) {
    case 'tok_success':
      return PAID;
    case 'tok_insufficient_funds':
      return declined('insufficient_funds');
    case 'tok_expired_card':
      return declined('expired_card');
    case 'tok_fail_then_success':
      return attempt === FIRST_ATTEMPT ? declined('insufficient_funds') : PAID;
    default:
      return declined('invalid_token');
  }
}

function toGatewayCharge(stored: StoredGatewayCharge): GatewayCharge {
  return {
    id: stored.id,
    customerId: stored.customerId,
    externalRef: stored.externalRef,
    amountCents: stored.amountCents,
    method: stored.method,
    status: stored.status,
    ...(stored.failureReason && { failureReason: stored.failureReason }),
    createdAt: new Date(stored.createdAt),
  };
}

@Injectable()
export class FakeGatewayAdapter extends PaymentGateway {
  constructor(
    private readonly store: FakeGatewayStore,
    private readonly clock: Clock,
  ) {
    super();
  }

  createCustomer(input: CreateGatewayCustomer): Promise<GatewayCustomer> {
    const customer = {
      id: generateId(ID_PREFIXES.gatewayCustomer),
      externalRef: input.externalRef,
      name: input.name,
      email: input.email,
      createdAt: this.clock.now().toISOString(),
    };
    return this.store.transaction((data) => {
      data.customers.push(customer);
      return { id: customer.id, externalRef: customer.externalRef };
    });
  }

  createCharge(input: CreateGatewayCharge): Promise<GatewayCharge> {
    const id = generateId(ID_PREFIXES.gatewayCharge);
    const createdAt = this.clock.now().toISOString();
    return this.store.transaction((data) => {
      if (!data.customers.some(({ id }) => id === input.gatewayCustomerId)) {
        throw new NotFoundError(
          `Gateway customer ${input.gatewayCustomerId} not found`,
        );
      }
      const previousAttempts = data.charges.filter(
        ({ externalRef }) => externalRef === input.externalRef,
      ).length;
      const outcome = decideOutcome(input.cardToken, previousAttempts + 1);
      const charge: StoredGatewayCharge = {
        id,
        customerId: input.gatewayCustomerId,
        externalRef: input.externalRef,
        amountCents: input.amountCents,
        method: input.method,
        cardToken: input.cardToken,
        createdAt,
        ...outcome,
      };
      data.charges.push(charge);
      return toGatewayCharge(charge);
    });
  }

  getCharge(gatewayChargeId: string): Promise<GatewayCharge> {
    return this.store.read((data) => {
      const charge = data.charges.find(({ id }) => id === gatewayChargeId);
      if (!charge) {
        throw new NotFoundError(`Gateway charge ${gatewayChargeId} not found`);
      }
      return toGatewayCharge(charge);
    });
  }
}
