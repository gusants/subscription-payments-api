import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '../../shared/errors/index.js';
import type { Charge } from './charge.js';
import { ChargeProcessor, type ProcessedCharge } from './charge-processor.js';
import { ChargesRepository } from './charges.repository.js';
import { dunningRetryKind, type DunningRetryKind } from './domain/index.js';

export interface DunningRetryRequest {
  chargeId: string;
  attempt: number;
}

@Injectable()
export class ChargeRetryRunner {
  private readonly logger = new Logger(ChargeRetryRunner.name);

  constructor(
    private readonly charges: ChargesRepository,
    private readonly processor: ChargeProcessor,
  ) {}

  async run({ chargeId, attempt }: DunningRetryRequest): Promise<void> {
    const found = await this.charges.findWithSubscription(chargeId);
    if (!found) {
      this.logger.warn(
        `Retry ${attempt} skipped: charge ${chargeId} not found`,
      );
      return;
    }
    const kind = dunningRetryKind(found.charge, attempt);
    if (!kind) {
      this.logger.log(
        `Retry ${attempt} of charge ${chargeId} skipped: charge is ${found.charge.status} with ${found.charge.retryCount} retries made`,
      );
      return;
    }
    try {
      const processed = await this.start(kind, found.charge, attempt);
      if (processed.technicalFailure) throw processed.technicalFailure;
    } catch (error) {
      if (error instanceof DomainError && !error.transient) {
        this.logger.warn(
          `Retry ${attempt} of charge ${chargeId} skipped: ${error.message}`,
        );
        return;
      }
      throw error;
    }
  }

  private start(
    kind: DunningRetryKind,
    charge: Charge,
    attempt: number,
  ): Promise<ProcessedCharge> {
    switch (kind) {
      case 'resubmit':
        return this.processor.retry(charge, attempt);
      case 'reissue':
        return this.processor.reissue(charge, attempt);
      case 'resume':
        return this.processor.resume(charge);
    }
  }
}
