import type { RenewalCandidate } from './charge.js';

export abstract class RenewalsRepository {
  abstract findDue(now: Date, limit: number): Promise<RenewalCandidate[]>;
}
