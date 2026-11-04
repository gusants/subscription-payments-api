import { ChargeRetriesProcessor } from './charge-retries.processor.js';
import { BillingWorkersModule } from './billing-workers.module.js';

describe('BillingWorkersModule', () => {
  it('registers the retry processor by default', () => {
    const { providers } = BillingWorkersModule.register({});

    expect(providers).toEqual([ChargeRetriesProcessor]);
  });

  it('registers nothing when WORKERS_ENABLED is false', () => {
    const { providers, imports } = BillingWorkersModule.register({
      WORKERS_ENABLED: 'false',
    });

    expect(providers).toEqual([]);
    expect(imports).toEqual([]);
  });
});
