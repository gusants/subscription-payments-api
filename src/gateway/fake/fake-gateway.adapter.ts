import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../shared/clock/index.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { GatewayCustomerNotFoundError } from '../gateway-customer-not-found.error.js';
import { GatewayUnavailableError } from '../gateway-unavailable.error.js';
import { generateId, ID_PREFIXES } from '../../shared/ids/index.js';
import {
  PaymentGateway,
  type CreateGatewayCharge,
  type CreateGatewayCustomer,
  type GatewayCharge,
  type GatewayCustomer,
  type GatewayFailureReason,
} from '../payment-gateway.port.js';
import { appendChargeEvents } from './fake-gateway-events.js';
import { toGatewayCharge } from './fake-gateway-charge.mapper.js';
import {
  FAKE_CHARGE_EXPIRATION,
  type FakeChargeExpiration,
} from './fake-gateway-options.js';
import {
  FakeGatewayStore,
  type StoredGatewayCharge,
} from './fake-gateway.store.js';
import {
  boletoInstructions,
  pixInstructions,
} from './fake-payment-instructions.js';
import { FakeWebhookDispatcher } from './webhook/fake-webhook.dispatcher.js';

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

@Injectable()
export class FakeGatewayAdapter extends PaymentGateway {
  constructor(
    private readonly store: FakeGatewayStore,
    private readonly clock: Clock,
    @Inject(FAKE_CHARGE_EXPIRATION)
    private readonly expiration: FakeChargeExpiration,
    private readonly webhooks: FakeWebhookDispatcher,
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
    return this.guarded(() =>
      this.store.transaction((data) => {
        data.customers.push(customer);
        return { id: customer.id, externalRef: customer.externalRef };
      }),
    );
  }

  createCharge(input: CreateGatewayCharge): Promise<GatewayCharge> {
    const id = generateId(ID_PREFIXES.gatewayCharge);
    const createdAt = this.clock.now().toISOString();
    return this.guarded(async () => {
      const { charge, events } = await this.store.transaction((data) => {
        const existing = data.charges.find(
          ({ idempotencyKey }) => idempotencyKey === input.idempotencyKey,
        );
        if (existing) return { charge: toGatewayCharge(existing), events: [] };
        if (!data.customers.some(({ id }) => id === input.gatewayCustomerId)) {
          throw new GatewayCustomerNotFoundError(input.gatewayCustomerId);
        }
        const previousAttempts = data.charges.filter(
          ({ externalRef }) => externalRef === input.externalRef,
        ).length;
        const created = this.buildCharge(
          input,
          id,
          createdAt,
          previousAttempts + 1,
        );
        data.charges.push(created);
        return {
          charge: toGatewayCharge(created),
          events: appendChargeEvents(data, [created], this.clock.now()),
        };
      });
      this.webhooks.schedule(events);
      return charge;
    });
  }

  findChargeByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<GatewayCharge | null> {
    return this.guarded(() =>
      this.store.read((data) => {
        const charge = data.charges.find(
          (stored) => stored.idempotencyKey === idempotencyKey,
        );
        return charge ? toGatewayCharge(charge) : null;
      }),
    );
  }

  getCharge(gatewayChargeId: string): Promise<GatewayCharge> {
    return this.guarded(() =>
      this.store.read((data) => {
        const charge = data.charges.find(({ id }) => id === gatewayChargeId);
        if (!charge) {
          throw new NotFoundError(
            `Gateway charge ${gatewayChargeId} not found`,
          );
        }
        return toGatewayCharge(charge);
      }),
    );
  }

  private buildCharge(
    input: CreateGatewayCharge,
    id: string,
    createdAt: string,
    attempt: number,
  ): StoredGatewayCharge {
    const common = {
      id,
      customerId: input.gatewayCustomerId,
      externalRef: input.externalRef,
      amountCents: input.amountCents,
      idempotencyKey: input.idempotencyKey,
      createdAt,
    };
    switch (input.method) {
      case 'card': {
        const outcome = decideOutcome(input.cardToken, attempt);
        return {
          ...common,
          method: 'card',
          cardToken: input.cardToken,
          ...outcome,
          ...(outcome.status === 'paid' && { paidAt: createdAt }),
        };
      }
      case 'pix':
        return {
          ...common,
          method: 'pix',
          status: 'pending',
          expiresAt: this.expiresAt(this.expiration.pixMs),
          paymentInstructions: pixInstructions(id),
        };
      case 'boleto':
        return {
          ...common,
          method: 'boleto',
          status: 'pending',
          expiresAt: this.expiresAt(this.expiration.boletoMs),
          paymentInstructions: boletoInstructions(id),
        };
    }
  }

  private expiresAt(durationMs: number): string {
    return new Date(this.clock.now().getTime() + durationMs).toISOString();
  }

  private async guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (
        error instanceof GatewayCustomerNotFoundError ||
        error instanceof NotFoundError
      ) {
        throw error;
      }
      throw new GatewayUnavailableError('Fake gateway store failed', {
        cause: error,
      });
    }
  }
}
