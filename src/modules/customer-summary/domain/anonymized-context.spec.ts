import {
  buildAnonymizedContext,
  latestPaymentMethod,
  type ContextCharge,
  type ContextSource,
} from './anonymized-context.js';

const metrics = {
  monthsAsCustomer: 8,
  totalPaidCents: 39920,
  failedAttempts: 3,
  averageDaysLate: 2.4,
  paymentSuccessRate: 0.85,
};

function charge(overrides: Partial<ContextCharge> = {}): ContextCharge {
  return {
    subscriptionId: 'sub_01hzx3k9q2m8v7w6y5t4r3e2d1',
    periodStart: new Date('2026-03-10T00:00:00.000Z'),
    status: 'paid',
    method: 'card',
    amountCents: 1990,
    dueDate: new Date('2026-03-10T12:00:00.000Z'),
    paidAt: new Date('2026-03-12T09:30:00.000Z'),
    failureReason: null,
    ...overrides,
  };
}

function source(overrides: Partial<ContextSource> = {}): ContextSource {
  return {
    plan: { interval: 'monthly', amountCents: 1990 },
    charges: [charge()],
    metrics,
    ...overrides,
  };
}

describe('buildAnonymizedContext', () => {
  it('carries the plan, the ready metrics and the timeline', () => {
    expect(buildAnonymizedContext(source())).toEqual({
      plan: { interval: 'monthly', amountCents: 1990 },
      metrics,
      paymentTimeline: [
        {
          periodStart: '2026-03-10',
          charges: [
            {
              dueDate: '2026-03-10',
              paidDate: '2026-03-12',
              status: 'paid',
              method: 'card',
              amountCents: 1990,
              failureReason: null,
            },
          ],
        },
      ],
    });
  });

  it('orders the timeline by period start, oldest first', () => {
    const context = buildAnonymizedContext(
      source({
        charges: [
          charge({ periodStart: new Date('2026-05-10T00:00:00.000Z') }),
          charge({ periodStart: new Date('2026-03-10T00:00:00.000Z') }),
          charge({ periodStart: new Date('2026-04-10T00:00:00.000Z') }),
        ],
      }),
    );

    expect(context.paymentTimeline.map((period) => period.periodStart)).toEqual(
      ['2026-03-10', '2026-04-10', '2026-05-10'],
    );
  });

  it('groups a reissued pix period into one entry with every charge in order', () => {
    const periodStart = new Date('2026-03-10T00:00:00.000Z');
    const context = buildAnonymizedContext(
      source({
        charges: [
          charge({
            periodStart,
            status: 'expired',
            method: 'pix',
            paidAt: null,
          }),
          charge({ periodStart, status: 'paid', method: 'pix' }),
          charge({ periodStart: new Date('2026-04-10T00:00:00.000Z') }),
        ],
      }),
    );

    expect(context.paymentTimeline).toHaveLength(2);
    expect(context.paymentTimeline[0]!.charges.map((c) => c.status)).toEqual([
      'expired',
      'paid',
    ]);
  });

  it('keeps the same period start of different subscriptions apart', () => {
    const context = buildAnonymizedContext(
      source({
        charges: [
          charge({ subscriptionId: 'sub_a' }),
          charge({ subscriptionId: 'sub_b' }),
        ],
      }),
    );

    expect(context.paymentTimeline).toHaveLength(2);
  });

  it('reports the method of the most recent charge', () => {
    const context = buildAnonymizedContext(
      source({
        charges: [
          charge({ method: 'card' }),
          charge({
            method: 'pix',
            periodStart: new Date('2026-04-10T00:00:00.000Z'),
          }),
        ],
      }),
    );

    expect(latestPaymentMethod(context)).toBe('pix');
  });

  it('has no latest method without charges', () => {
    expect(
      latestPaymentMethod(buildAnonymizedContext(source({ charges: [] }))),
    ).toBeNull();
  });

  it('does not reorder the caller charges', () => {
    const charges = [
      charge({ dueDate: new Date('2026-05-10T00:00:00.000Z') }),
      charge({ dueDate: new Date('2026-03-10T00:00:00.000Z') }),
    ];

    buildAnonymizedContext(source({ charges }));

    expect(charges[0]!.dueDate.toISOString()).toBe('2026-05-10T00:00:00.000Z');
  });

  it('records the failure reason of an unpaid charge', () => {
    const context = buildAnonymizedContext(
      source({
        charges: [
          charge({
            status: 'failed',
            paidAt: null,
            failureReason: 'insufficient_funds',
          }),
        ],
      }),
    );

    expect(context.paymentTimeline[0]!.charges[0]).toMatchObject({
      status: 'failed',
      paidDate: null,
      failureReason: 'insufficient_funds',
    });
  });

  it('handles a customer without charges or plan', () => {
    const context = buildAnonymizedContext(source({ charges: [], plan: null }));

    expect(context.paymentTimeline).toEqual([]);
    expect(context.plan).toBeNull();
  });

  describe('personal data never reaches the context', () => {
    const forbiddenValues = [
      'Maria da Silva',
      'maria@example.com',
      '123.456.789-09',
      'cus_01hzx3k9q2m8v7w6y5t4r3e2d1',
      'sub_01hzx3k9q2m8v7w6y5t4r3e2d1',
      'ch_01hzx3k9q2m8v7w6y5t4r3e2d1',
      'gch_9f8e7d6c',
      'gcus_9f8e7d6c',
      'tok_success',
      'Plano Premium Gold do João',
    ];

    function contaminatedSource(): ContextSource {
      const contaminatedCharge = {
        ...charge(),
        id: 'ch_01hzx3k9q2m8v7w6y5t4r3e2d1',
        subscriptionId: 'sub_01hzx3k9q2m8v7w6y5t4r3e2d1',
        gatewayChargeId: 'gch_9f8e7d6c',
        cardToken: 'tok_success',
      };
      const contaminated = {
        ...source(),
        plan: {
          interval: 'monthly',
          amountCents: 1990,
          name: 'Plano Premium Gold do João',
        },
        charges: [contaminatedCharge],
        name: 'Maria da Silva',
        email: 'maria@example.com',
        document: '123.456.789-09',
        gatewayCustomerId: 'gcus_9f8e7d6c',
      };
      return contaminated as ContextSource;
    }

    it.each(forbiddenValues)('does not contain %s', (forbidden) => {
      const serialized = JSON.stringify(
        buildAnonymizedContext(contaminatedSource()),
      );

      expect(serialized).not.toContain(forbidden);
    });

    it('does not derive any pseudonym from the customer id', () => {
      const serialized = JSON.stringify(
        buildAnonymizedContext({
          ...contaminatedSource(),
          customerId: 'cus_01hzx3k9q2m8v7w6y5t4r3e2d1',
        } as ContextSource),
      );

      expect(serialized).not.toMatch(/customer_[0-9a-f]{8}/);
      expect(serialized).not.toContain('Alias');
    });

    it('only exposes whitelisted keys', () => {
      const context = buildAnonymizedContext(contaminatedSource());

      expect(Object.keys(context).sort()).toEqual([
        'metrics',
        'paymentTimeline',
        'plan',
      ]);
      expect(Object.keys(context.plan!).sort()).toEqual([
        'amountCents',
        'interval',
      ]);
      expect(Object.keys(context.paymentTimeline[0]!).sort()).toEqual([
        'charges',
        'periodStart',
      ]);
      expect(
        Object.keys(context.paymentTimeline[0]!.charges[0]!).sort(),
      ).toEqual([
        'amountCents',
        'dueDate',
        'failureReason',
        'method',
        'paidDate',
        'status',
      ]);
    });

    it('contains no real id prefix anywhere in the payload', () => {
      const serialized = JSON.stringify(
        buildAnonymizedContext(contaminatedSource()),
      );

      expect(serialized).not.toMatch(/\b(cus|sub|ch|gch|gcus|plan|tok)_/);
    });
  });
});
