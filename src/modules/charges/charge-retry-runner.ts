import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '../../shared/errors/index.js';
import { ChargeProcessor } from './charge-processor.js';
import { ChargesRepository } from './charges.repository.js';
import { dunningRetryKind } from './domain/index.js';

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
      await (kind === 'resubmit'
        ? this.processor.retry(found.charge, attempt)
        : this.processor.reissue(found.charge, attempt));
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
}
