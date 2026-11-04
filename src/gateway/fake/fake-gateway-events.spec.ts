import { appendChargeEvents } from './fake-gateway-events.js';
import type {
  FakeGatewayData,
  StoredGatewayCharge,
} from './fake-gateway.store.js';

const occurredAt = new Date('2026-11-03T10:00:00.000Z');

const chargeWith = (
  status: StoredGatewayCharge['status'],
): StoredGatewayCharge => ({
  id: 'gch_1',
  customerId: 'gcus_1',
  externalRef: 'ch_1',
  amountCents: 4990,
  method: 'pix',
  idempotencyKey: 'ch_1:1',
  status,
  createdAt: '2026-11-03T09:00:00.000Z',
});

describe('appendChargeEvents', () => {
  let data: FakeGatewayData;

  beforeEach(() => {
    data = { customers: [], charges: [], events: [] };
  });

  it.each([
    ['paid', 'charge.paid'],
    ['failed', 'charge.failed'],
    ['expired', 'charge.expired'],
  ] as const)('appends a %s charge as %s', (status, type) => {
    const events = appendChargeEvents(data, [chargeWith(status)], occurredAt);

    expect(events).toEqual([
      {
        id: expect.stringMatching(/^evt_[0-9a-z]{26}$/),
        type,
        chargeId: 'gch_1',
        externalRef: 'ch_1',
        occurredAt: '2026-11-03T10:00:00.000Z',
        deliveredAt: null,
        attempts: 0,
      },
    ]);
    expect(data.events).toEqual(events);
  });

  it('appends nothing for a pending charge', () => {
    expect(
      appendChargeEvents(data, [chargeWith('pending')], occurredAt),
    ).toEqual([]);
    expect(data.events).toEqual([]);
  });

  it('appends one event per settled charge and skips the pending ones', () => {
    const events = appendChargeEvents(
      data,
      [chargeWith('paid'), chargeWith('pending'), chargeWith('expired')],
      occurredAt,
    );

    expect(events.map(({ type }) => type)).toEqual([
      'charge.paid',
      'charge.expired',
    ]);
    expect(new Set(events.map(({ id }) => id)).size).toBe(2);
  });
});
