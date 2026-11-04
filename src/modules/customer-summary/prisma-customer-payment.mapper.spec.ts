import {
  toCustomerPaymentRecord,
  type ChargeRow,
  type CustomerPaymentRows,
  type SubscriptionRow,
} from './prisma-customer-payment.mapper.js';

const at = (day: number, hour = 0) =>
  new Date(Date.UTC(2026, 2, day, hour, 0, 0));

function charge(overrides: Partial<ChargeRow> = {}): ChargeRow {
  return {
    status: 'paid',
    method: 'card',
    amountCents: 1990,
    dueDate: at(10),
    paidAt: at(11),
    updatedAt: at(11),
    attempts: [],
    ...overrides,
  };
}

function subscription(
  overrides: Partial<SubscriptionRow> = {},
): SubscriptionRow {
  return {
    createdAt: at(1),
    updatedAt: at(1),
    plan: { interval: 'monthly', amountCents: 1990 },
    charges: [],
    ...overrides,
  };
}

function customer(subscriptions: SubscriptionRow[]): CustomerPaymentRows {
  return { id: 'cus_1', createdAt: at(1), subscriptions };
}

describe('toCustomerPaymentRecord', () => {
  it('maps a customer without subscriptions to an empty record', () => {
    expect(toCustomerPaymentRecord(customer([]))).toEqual({
      customerId: 'cus_1',
      customerSince: at(1),
      plan: null,
      charges: [],
      attempts: [],
      activity: { lastActivityAt: null, chargeCount: 0, attemptCount: 0 },
    });
  });

  it('flattens the charges and attempts of every subscription', () => {
    const attempt = {
      result: 'declined',
      failureReason: null,
      createdAt: at(12),
    } as const;
    const record = toCustomerPaymentRecord(
      customer([
        subscription({ charges: [charge({ attempts: [attempt] })] }),
        subscription({ charges: [charge(), charge()] }),
      ]),
    );

    expect(record.charges).toHaveLength(3);
    expect(record.attempts).toEqual([{ result: 'declined' }]);
    expect(record.activity).toMatchObject({ chargeCount: 3, attemptCount: 1 });
  });

  it('uses the plan of the newest subscription', () => {
    const record = toCustomerPaymentRecord(
      customer([
        subscription({
          createdAt: at(5),
          plan: { interval: 'yearly', amountCents: 19900 },
        }),
        subscription({
          createdAt: at(2),
          plan: { interval: 'monthly', amountCents: 1990 },
        }),
      ]),
    );

    expect(record.plan).toEqual({ interval: 'yearly', amountCents: 19900 });
  });

  it('keeps only the context fields of a charge', () => {
    const [mapped] = toCustomerPaymentRecord(
      customer([subscription({ charges: [charge()] })]),
    ).charges;

    expect(mapped).toEqual({
      status: 'paid',
      method: 'card',
      amountCents: 1990,
      dueDate: at(10),
      paidAt: at(11),
      failureReason: null,
    });
  });

  it('reports the reason of the most recent failed attempt', () => {
    const [mapped] = toCustomerPaymentRecord(
      customer([
        subscription({
          charges: [
            charge({
              attempts: [
                {
                  result: 'declined',
                  failureReason: 'expired_card',
                  createdAt: at(12),
                },
                {
                  result: 'declined',
                  failureReason: 'insufficient_funds',
                  createdAt: at(15),
                },
                { result: 'succeeded', failureReason: null, createdAt: at(16) },
              ],
            }),
          ],
        }),
      ]),
    ).charges;

    expect(mapped?.failureReason).toBe('insufficient_funds');
  });

  it.each([
    ['a subscription change', customer([subscription({ updatedAt: at(20) })])],
    [
      'a charge update',
      customer([subscription({ charges: [charge({ updatedAt: at(21) })] })]),
    ],
    [
      'an attempt',
      customer([
        subscription({
          charges: [
            charge({
              attempts: [
                {
                  result: 'declined',
                  failureReason: 'invalid_token',
                  createdAt: at(22),
                },
              ],
            }),
          ],
        }),
      ]),
    ],
  ])('takes the last activity from %s', (_case, rows) => {
    const { lastActivityAt } = toCustomerPaymentRecord(rows).activity;

    expect(lastActivityAt?.getTime()).toBeGreaterThanOrEqual(at(20).getTime());
  });
});
