import { toCustomerDetailResponse } from './customer-presenter.js';

describe('toCustomerDetailResponse', () => {
  it('serializes dates as ISO strings and exposes only public fields', () => {
    const response = toCustomerDetailResponse({
      id: 'cus_1',
      name: 'Ana',
      email: 'ana@example.com',
      gatewayCustomerId: 'gcus_secret',
      createdAt: new Date('2026-11-03T10:00:00.000Z'),
      updatedAt: new Date('2026-11-03T11:00:00.000Z'),
      subscriptions: [
        {
          id: 'sub_1',
          planId: 'plan_1',
          status: 'active',
          currentPeriodEnd: new Date('2026-12-03T00:00:00.000Z'),
        },
      ],
    });

    expect(response).toEqual({
      id: 'cus_1',
      name: 'Ana',
      email: 'ana@example.com',
      createdAt: '2026-11-03T10:00:00.000Z',
      updatedAt: '2026-11-03T11:00:00.000Z',
      subscriptions: [
        {
          id: 'sub_1',
          planId: 'plan_1',
          status: 'active',
          currentPeriodEnd: '2026-12-03T00:00:00.000Z',
        },
      ],
    });
  });
});
