import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../shared/clock/testing/fixed-clock.js';
import { NotFoundError } from '../../shared/errors/index.js';
import type {
  CreateGatewayCharge,
  GatewayCustomer,
} from '../payment-gateway.port.js';
import { FakeGatewayAdapter } from './fake-gateway.adapter.js';
import { FakeGatewayStore } from './fake-gateway.store.js';

const now = new Date('2026-11-03T10:00:00.000Z');

describe('FakeGatewayAdapter', () => {
  let directory: string;
  let filePath: string;
  let gateway: FakeGatewayAdapter;
  let customer: GatewayCustomer;

  const charge = (
    cardToken: string,
    externalRef = 'chg_1',
  ): CreateGatewayCharge => ({
    gatewayCustomerId: customer.id,
    amountCents: 4990,
    method: 'card',
    cardToken,
    externalRef,
  });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'fake-gateway-'));
    filePath = join(directory, 'data', 'fake-gateway.json');
    gateway = new FakeGatewayAdapter(
      new FakeGatewayStore(filePath),
      new FixedClock(now),
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

    it('rejects an unknown gateway customer', async () => {
      await expect(
        gateway.createCharge({
          ...charge('tok_success'),
          gatewayCustomerId: 'gcus_missing',
        }),
      ).rejects.toThrow(NotFoundError);
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
