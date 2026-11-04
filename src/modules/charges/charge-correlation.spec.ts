import {
  currentCorrelationId,
  runWithCorrelationId,
} from '../../shared/correlation/index.js';
import { runWithinChargeCorrelation } from './charge-correlation.js';

describe('runWithinChargeCorrelation', () => {
  it('switches to the correlation id of the charge', () => {
    const seen = runWithCorrelationId('cor_outer_context', () =>
      runWithinChargeCorrelation(
        { correlationId: 'cor_charge_journey' },
        currentCorrelationId,
      ),
    );

    expect(seen).toBe('cor_charge_journey');
  });

  it('keeps the current id for a charge created before correlation ids existed', () => {
    const seen = runWithCorrelationId('cor_outer_context', () =>
      runWithinChargeCorrelation({ correlationId: null }, currentCorrelationId),
    );

    expect(seen).toBe('cor_outer_context');
  });

  it('generates an id for such a charge outside any context', () => {
    expect(
      runWithinChargeCorrelation({ correlationId: null }, currentCorrelationId),
    ).toMatch(/^cor_/);
  });
});
