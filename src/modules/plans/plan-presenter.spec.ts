import type { Plan } from './plan.js';
import { toPlanResponse } from './plan-presenter.js';

describe('toPlanResponse', () => {
  it('serializes dates as ISO strings', () => {
    const plan: Plan = {
      id: 'plan_1',
      name: 'Basic',
      amountCents: 1990,
      interval: 'monthly',
      active: true,
      createdAt: new Date('2026-11-03T10:00:00.000Z'),
      updatedAt: new Date('2026-11-03T11:00:00.000Z'),
    };

    expect(toPlanResponse(plan)).toEqual({
      ...plan,
      createdAt: '2026-11-03T10:00:00.000Z',
      updatedAt: '2026-11-03T11:00:00.000Z',
    });
  });
});
