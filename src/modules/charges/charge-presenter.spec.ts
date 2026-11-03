import { toChargeSummaryResponse } from './charge-presenter.js';

describe('toChargeSummaryResponse', () => {
  it('exposes the failure reason of a declined charge', () => {
    expect(
      toChargeSummaryResponse({
        id: 'ch_1',
        status: 'failed',
        amountCents: 1990,
        failureReason: 'insufficient_funds',
      }),
    ).toEqual({
      id: 'ch_1',
      status: 'failed',
      amountCents: 1990,
      failureReason: 'insufficient_funds',
    });
  });

  it('omits the failure reason when there is none', () => {
    expect(
      toChargeSummaryResponse({
        id: 'ch_1',
        status: 'paid',
        amountCents: 1990,
        failureReason: null,
      }),
    ).toEqual({ id: 'ch_1', status: 'paid', amountCents: 1990 });
  });
});
