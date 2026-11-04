import type { RenewalCandidate } from '../charge.js';
import { RenewalsRepository } from '../renewals.repository.js';
import type { InMemoryBillingRepository } from './in-memory-billing.repository.js';

export class InMemoryRenewalsRepository extends RenewalsRepository {
  private readonly candidates: RenewalCandidate[] = [];

  constructor(private readonly billing: InMemoryBillingRepository) {
    super();
  }

  track(candidate: RenewalCandidate): void {
    this.candidates.push(candidate);
  }

  findDue(now: Date, limit: number): Promise<RenewalCandidate[]> {
    const charges = this.billing.charges();
    const due = this.candidates
      .filter(
        ({ subscription }) =>
          subscription.status === 'active' &&
          subscription.currentPeriodEnd <= now &&
          !charges.some(
            (charge) =>
              charge.subscriptionId === subscription.id &&
              charge.periodStart.getTime() ===
                subscription.currentPeriodEnd.getTime(),
          ),
      )
      .slice(0, limit);
    return Promise.resolve(due);
  }
}
