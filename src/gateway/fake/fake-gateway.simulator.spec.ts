import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { ConflictError, NotFoundError } from '../../shared/errors/index.js';
import type { GatewayCharge } from '../payment-gateway.port.js';
import { buildFakeWebhookDispatcher } from '../testing/build-fake-webhook-dispatcher.js';
import type { ManualDelayScheduler } from '../testing/manual-delay-scheduler.js';
import { FakeGatewayAdapter } from './fake-gateway.adapter.js';
import { FakeGatewaySimulator } from './fake-gateway.simulator.js';
import { FakeGatewayStore } from './fake-gateway.store.js';

const start = new Date('2026-11-03T10:00:00.000Z');
const expiration = { pixMs: 30 * 60_000, boletoMs: 3 * 24 * 3_600_000 };

describe('FakeGatewaySimulator', () => {
  let directory: string;
  let clock: FixedClock;
  let store: FakeGatewayStore;
  let scheduler: ManualDelayScheduler;
  let gateway: FakeGatewayAdapter;
  let simulator: FakeGatewaySimulator;
  let gatewayCustomerId: string;
  let keySequence: number;

  const createCharge = (
    method: 'card' | 'pix' | 'boleto',
    externalRef: string,
  ): Promise<GatewayCharge> => {
    const base = {
      gatewayCustomerId,
      amountCents: 4990,
      externalRef,
      idempotencyKey: `key_${(keySequence += 1)}`,
    };
    return gateway.createCharge(
      method === 'card'
        ? { ...base, method, cardToken: 'tok_success' }
        : { ...base, method },
    );
  };

  beforeEach(async () => {
    keySequence = 0;
    directory = await mkdtemp(join(tmpdir(), 'fake-gateway-'));
    store = new FakeGatewayStore(join(directory, 'fake-gateway.json'));
    clock = new FixedClock(start);
    const { dispatcher, scheduler: manual } = buildFakeWebhookDispatcher({
      store,
      clock,
    });
    scheduler = manual;
    gateway = new FakeGatewayAdapter(store, clock, expiration, dispatcher);
    simulator = new FakeGatewaySimulator(store, clock, dispatcher);
    ({ id: gatewayCustomerId } = await gateway.createCustomer({
      externalRef: 'cus_1',
      name: 'Ana',
      email: 'ana@example.com',
    }));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe('pay', () => {
    it.each(['pix', 'boleto'] as const)(
      'pays a pending %s charge looked up by our charge id',
      async (method) => {
        const created = await createCharge(method, 'ch_1');

        const paid = await simulator.pay('ch_1');

        expect(paid).toEqual({ ...created, status: 'paid', paidAt: start });
        expect(await gateway.getCharge(created.id)).toEqual(paid);
      },
    );

    it('answers conflict when the charge is already paid', async () => {
      await createCharge('pix', 'ch_1');
      await simulator.pay('ch_1');

      await expect(simulator.pay('ch_1')).rejects.toThrow(ConflictError);
    });

    it('answers conflict when the charge already expired', async () => {
      await createCharge('pix', 'ch_1');
      await simulator.expire('ch_1');

      await expect(simulator.pay('ch_1')).rejects.toThrow(ConflictError);
    });

    it('answers conflict for a card charge', async () => {
      await createCharge('card', 'ch_1');

      await expect(simulator.pay('ch_1')).rejects.toThrow(ConflictError);
    });

    it('does not know an unknown charge', async () => {
      await expect(simulator.pay('ch_missing')).rejects.toThrow(NotFoundError);
    });
  });

  describe('expire', () => {
    it('expires a pending boleto charge', async () => {
      const created = await createCharge('boleto', 'ch_1');

      const expired = await simulator.expire('ch_1');

      expect(expired).toEqual({ ...created, status: 'expired' });
      expect(await gateway.getCharge(created.id)).toEqual(expired);
    });

    it('answers conflict when the charge is already paid', async () => {
      await createCharge('boleto', 'ch_1');
      await simulator.pay('ch_1');

      await expect(simulator.expire('ch_1')).rejects.toThrow(ConflictError);
    });

    it('does not know an unknown charge', async () => {
      await expect(simulator.expire('ch_missing')).rejects.toThrow(
        NotFoundError,
      );
    });
  });

  describe('webhook events', () => {
    const eventTypes = async () =>
      (await store.read((data) => data.events)).map(({ type }) => type);

    it('appends a charge.paid event and schedules its delivery when paid', async () => {
      const created = await createCharge('pix', 'ch_1');
      scheduler.clear();

      await simulator.pay('ch_1');

      expect(await store.read((data) => data.events)).toEqual([
        {
          id: expect.stringMatching(/^evt_/),
          type: 'charge.paid',
          chargeId: created.id,
          externalRef: 'ch_1',
          occurredAt: start.toISOString(),
          deliveredAt: null,
          attempts: 0,
        },
      ]);
      expect(scheduler.delays).toEqual([500]);
    });

    it('appends a charge.expired event when expired by hand', async () => {
      await createCharge('boleto', 'ch_1');

      await simulator.expire('ch_1');

      expect(await eventTypes()).toEqual(['charge.expired']);
    });

    it('appends one charge.expired event per charge the sweep expires', async () => {
      await createCharge('pix', 'ch_1');
      await createCharge('pix', 'ch_2');
      scheduler.clear();
      clock.set(new Date(start.getTime() + expiration.pixMs));

      await simulator.expireDue();

      expect(await eventTypes()).toEqual(['charge.expired', 'charge.expired']);
      expect(scheduler.delays).toEqual([500, 500]);
    });

    it('appends nothing when a transition is refused', async () => {
      await createCharge('pix', 'ch_1');
      await simulator.pay('ch_1');

      await expect(simulator.expire('ch_1')).rejects.toThrow(ConflictError);

      expect(await eventTypes()).toEqual(['charge.paid']);
    });
  });

  describe('expireDue', () => {
    it('expires nothing before the expiry', async () => {
      await createCharge('pix', 'ch_1');
      clock.set(new Date(start.getTime() + expiration.pixMs - 1));

      expect(await simulator.expireDue()).toEqual([]);
    });

    it('expires a pending charge once its expiry is reached', async () => {
      const created = await createCharge('pix', 'ch_1');
      clock.set(new Date(start.getTime() + expiration.pixMs));

      const expired = await simulator.expireDue();

      expect(expired).toEqual([{ ...created, status: 'expired' }]);
      expect(await gateway.getCharge(created.id)).toMatchObject({
        status: 'expired',
      });
    });

    it('expires only what is due, leaving later boletos and settled charges alone', async () => {
      const pix = await createCharge('pix', 'ch_1');
      const boleto = await createCharge('boleto', 'ch_2');
      const paidPix = await createCharge('pix', 'ch_3');
      await simulator.pay('ch_3');
      const card = await createCharge('card', 'ch_4');
      clock.set(new Date(start.getTime() + expiration.pixMs));

      const expired = await simulator.expireDue();

      expect(expired.map(({ id }) => id)).toEqual([pix.id]);
      expect(await gateway.getCharge(boleto.id)).toMatchObject({
        status: 'pending',
      });
      expect(await gateway.getCharge(paidPix.id)).toMatchObject({
        status: 'paid',
      });
      expect(await gateway.getCharge(card.id)).toMatchObject({
        status: 'paid',
      });
    });

    it('does not expire the same charge twice', async () => {
      await createCharge('pix', 'ch_1');
      clock.set(new Date(start.getTime() + expiration.pixMs));
      await simulator.expireDue();

      expect(await simulator.expireDue()).toEqual([]);
    });
  });
});
