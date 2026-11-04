import { ChargeRetriesProcessor } from './charge-retries.processor.js';
import { ChargeRetriesWorker } from './charge-retries.worker.js';
import { ChargeReconciliationProcessor } from './charge-reconciliation.processor.js';
import { ChargeReconciliationWorker } from './charge-reconciliation.worker.js';
import { SubscriptionRenewalsProcessor } from './subscription-renewals.processor.js';
import { SubscriptionRenewalsWorker } from './subscription-renewals.worker.js';
import { BillingQueueConnection } from '../billing-queue-connection.js';
import { BillingWorkersModule } from './billing-workers.module.js';

describe('BillingWorkersModule', () => {
  it('registers the retry, renewal and reconciliation workers by default', () => {
    const { providers } = BillingWorkersModule.register({});

    expect(providers).toEqual(
      expect.arrayContaining([
        BillingQueueConnection,
        ChargeRetriesProcessor,
        ChargeRetriesWorker,
        SubscriptionRenewalsProcessor,
        SubscriptionRenewalsWorker,
        ChargeReconciliationProcessor,
        ChargeReconciliationWorker,
      ]),
    );
  });

  it('registers nothing when WORKERS_ENABLED is false', () => {
    const { providers, imports } = BillingWorkersModule.register({
      WORKERS_ENABLED: 'false',
    });

    expect(providers).toEqual([]);
    expect(imports).toEqual([]);
  });
});
