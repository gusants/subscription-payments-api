import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { NotFoundError } from '../../shared/errors/index.js';
import { GatewayCustomerNotFoundError } from '../gateway-customer-not-found.error.js';
import { GatewayUnavailableError } from '../gateway-unavailable.error.js';
import type {
  CreateGatewayCharge,
  GatewayCustomer,
} from '../payment-gateway.port.js';
import { FakeGatewayAdapter } from './fake-gateway.adapter.js';
import { FakeGatewayStore } from './fake-gateway.store.js';

const now = new Date('2026-11-03T10:00:00.000Z');
const expiration = { pixMs: 30 * 60_000, boletoMs: 3 * 24 * 3_600_000 };

describe('FakeGatewayAdapter', () => {
  let directory: string;
  let filePath: string;
  let gateway: FakeGatewayAdapter;
  let customer: GatewayCustomer;
  let keySequence: number;

  const charge = (
    cardToken: string,
    externalRef = 'chg_1',
    idempotencyKey = `key_${(keySequence += 1)}`,
  ): CreateGatewayCharge => ({
    gatewayCustomerId: customer.id,
    amountCents: 4990,
    method: 'card',
    cardToken,
    externalRef,
    idempotencyKey,
  });

  beforeEach(async () => {
    keySequence = 0;
    directory = await mkdtemp(join(tmpdir(), 'fake-gateway-'));
    filePath = join(directory, 'data', 'fake-gateway.json');
    gateway = new FakeGatewayAdapter(
      new FakeGatewayStore(filePath),
      new FixedClock(now),
      expiration,
    );
    customer = await gateway.createCustomer({
      externalRef: 'cus_1',
      name: 'Ana',
      email: 'ana@example.com',
    });
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  describe('createCustomer', () => {
    it('returns a prefixed id and the external ref', () => {
      expect(customer).toEqual({
        id: expect.stringMatching(/^gcus_[0-9a-z]{26}$/),
        externalRef: 'cus_1',
      });
    });
  });

  describe('createCharge', () => {
    it('approves tok_success', async () => {
      const result = await gateway.createCharge(charge('tok_success'));

      expect(result).toEqual({
        id: expect.stringMatching(/^gch_[0-9a-z]{26}$/),
        customerId: customer.id,
        externalRef: 'chg_1',
        amountCents: 4990,
        method: 'card',
        status: 'paid',
        createdAt: now,
      });
    });

    it.each([
      ['tok_insufficient_funds', 'insufficient_funds'],
      ['tok_expired_card', 'expired_card'],
      ['tok_unknown', 'invalid_token'],
    ])('declines %s with %s', async (token, failureReason) => {
      const result = await gateway.createCharge(charge(token));

      expect(result).toMatchObject({ status: 'failed', failureReason });
    });

    it('declines tok_fail_then_success on the first attempt and approves the next ones', async () => {
      const statuses = [];
      for (let attempt = 0; attempt < 3; attempt++) {
        statuses.push(
          (await gateway.createCharge(charge('tok_fail_then_success'))).status,
        );
      }

      expect(statuses).toEqual(['failed', 'paid', 'paid']);
    });

    it('counts attempts independently per external ref', async () => {
      await gateway.createCharge(charge('tok_fail_then_success', 'chg_1'));
      await gateway.createCharge(charge('tok_fail_then_success', 'chg_1'));

      const other = await gateway.createCharge(
        charge('tok_fail_then_success', 'chg_2'),
      );

      expect(other.status).toBe('failed');
    });

    it('creates a new gateway charge for each attempt of the same external ref', async () => {
      const first = await gateway.createCharge(charge('tok_success'));
      const second = await gateway.createCharge(charge('tok_success'));

      expect(second.id).not.toBe(first.id);
    });

    it('rejects an unknown gateway customer with a customer-not-found error', async () => {
      await expect(
        gateway.createCharge({
          ...charge('tok_success'),
          gatewayCustomerId: 'gcus_missing',
        }),
      ).rejects.toThrow(GatewayCustomerNotFoundError);
    });

    it('returns the same gateway charge when the idempotency key is repeated', async () => {
      const first = await gateway.createCharge(
        charge('tok_success', 'chg_1', 'chg_1:1'),
      );
      const second = await gateway.createCharge(
        charge('tok_success', 'chg_1', 'chg_1:1'),
      );

      expect(second).toEqual(first);
      const stored = JSON.parse(await readFile(filePath, 'utf8')) as {
        charges: unknown[];
      };
      expect(stored.charges).toHaveLength(1);
    });

    it('keeps the outcome of tok_fail_then_success when the same key is re-sent', async () => {
      const key = 'chg_1:1';
      const statuses = [];
      for (let resend = 0; resend < 3; resend++) {
        statuses.push(
          (
            await gateway.createCharge(
              charge('tok_fail_then_success', 'chg_1', key),
            )
          ).status,
        );
      }
      const nextAttempt = await gateway.createCharge(
        charge('tok_fail_then_success', 'chg_1', 'chg_1:2'),
      );

      expect(statuses).toEqual(['failed', 'failed', 'failed']);
      expect(nextAttempt.status).toBe('paid');
    });

    it('answers a repeated key even after the gateway customer is gone', async () => {
      const first = await gateway.createCharge(
        charge('tok_success', 'chg_1', 'chg_1:1'),
      );

      await expect(
        gateway.createCharge({
          ...charge('tok_success', 'chg_1', 'chg_1:1'),
          gatewayCustomerId: 'gcus_missing',
        }),
      ).resolves.toEqual(first);
    });

    it('reports a store failure as gateway unavailable', async () => {
      await writeFile(filePath, '{ not json');

      await expect(
        gateway.createCharge(charge('tok_success')),
      ).rejects.toBeInstanceOf(GatewayUnavailableError);
    });

    it('does not store anything for a rejected charge', async () => {
      await gateway
        .createCharge({
          ...charge('tok_success'),
          gatewayCustomerId: 'gcus_missing',
        })
        .catch(() => undefined);

      const stored = JSON.parse(await readFile(filePath, 'utf8')) as {
        charges: unknown[];
      };
      expect(stored.charges).toEqual([]);
    });

    it('records 50 parallel charges', async () => {
      await Promise.all(
        Array.from({ length: 50 }, (_, index) =>
          gateway.createCharge(charge('tok_success', `chg_${index}`)),
        ),
      );

      const stored = JSON.parse(await readFile(filePath, 'utf8')) as {
        charges: unknown[];
      };
      expect(stored.charges).toHaveLength(50);
    });
  });

  describe('findChargeByIdempotencyKey', () => {
    it('returns the charge created with that key', async () => {
      const created = await gateway.createCharge(
        charge('tok_success', 'chg_1', 'chg_1:1'),
      );

      expect(await gateway.findChargeByIdempotencyKey('chg_1:1')).toEqual(
        created,
      );
    });

    it('returns null when no charge used that key', async () => {
      expect(await gateway.findChargeByIdempotencyKey('chg_9:1')).toBeNull();
    });

    it('reports a store failure as gateway unavailable', async () => {
      await writeFile(filePath, '{ not json');

      await expect(
        gateway.findChargeByIdempotencyKey('chg_1:1'),
      ).rejects.toBeInstanceOf(GatewayUnavailableError);
    });
  });

  describe('pix and boleto', () => {
    const invoice = (
      method: 'pix' | 'boleto',
      externalRef = 'chg_1',
      idempotencyKey = `key_${(keySequence += 1)}`,
    ): CreateGatewayCharge => ({
      gatewayCustomerId: customer.id,
      amountCents: 4990,
      method,
      externalRef,
      idempotencyKey,
    });

    it('creates a pix charge pending with copy-and-paste instructions and an expiry', async () => {
      const created = await gateway.createCharge(invoice('pix'));

      expect(created).toEqual({
        id: expect.stringMatching(/^gch_[0-9a-z]{26}$/),
        customerId: customer.id,
        externalRef: 'chg_1',
        amountCents: 4990,
        method: 'pix',
        status: 'pending',
        createdAt: now,
        expiresAt: new Date('2026-11-03T10:30:00.000Z'),
        paymentInstructions: {
          type: 'pix',
          copyPaste: expect.stringContaining(created.id),
        },
      });
    });

    it('creates a boleto charge pending with a digitable line, a barcode and a longer expiry', async () => {
      const created = await gateway.createCharge(invoice('boleto'));

      expect(created).toMatchObject({
        method: 'boleto',
        status: 'pending',
        expiresAt: new Date('2026-11-06T10:00:00.000Z'),
        paymentInstructions: {
          type: 'boleto',
          digitableLine: expect.stringMatching(
            /^\d{5}\.\d{5} \d{5}\.\d{6} \d{5}\.\d{6} \d \d{14}$/,
          ),
          barcode: expect.stringMatching(/^\d{44}$/),
        },
      });
    });

    it('gives each charge its own instructions', async () => {
      const first = await gateway.createCharge(invoice('boleto', 'chg_1'));
      const second = await gateway.createCharge(invoice('boleto', 'chg_2'));

      expect(first.paymentInstructions).not.toEqual(second.paymentInstructions);
    });

    it('returns the same charge for the same idempotency key', async () => {
      const first = await gateway.createCharge(invoice('pix', 'chg_1', 'k'));
      const second = await gateway.createCharge(invoice('pix', 'chg_1', 'k'));

      expect(second).toEqual(first);
      expect(await gateway.findChargeByIdempotencyKey('k')).toEqual(first);
    });

    it('reads a pending charge back with its instructions', async () => {
      const created = await gateway.createCharge(invoice('pix'));

      expect(await gateway.getCharge(created.id)).toEqual(created);
    });
  });

  describe('getCharge', () => {
    it('returns a previously created charge', async () => {
      const created = await gateway.createCharge(
        charge('tok_insufficient_funds'),
      );

      expect(await gateway.getCharge(created.id)).toEqual(created);
    });

    it('reads charges persisted by another adapter instance', async () => {
      const created = await gateway.createCharge(charge('tok_success'));
      const other = new FakeGatewayAdapter(
        new FakeGatewayStore(filePath),
        new FixedClock(now),
        expiration,
      );

      expect(await other.getCharge(created.id)).toEqual(created);
    });

    it('throws not found for an unknown charge', async () => {
      await expect(gateway.getCharge('gch_missing')).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
