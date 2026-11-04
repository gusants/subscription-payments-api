import { Injectable, Logger } from '@nestjs/common';
import { ServiceUnavailableError } from '../../../shared/errors/index.js';
import { BillingQueue } from '../billing-queue.port.js';

@Injectable()
export class DevRetriesService {
  private readonly logger = new Logger(DevRetriesService.name);

  constructor(private readonly queue: BillingQueue) {}

  async runNow(): Promise<number> {
    try {
      const promoted = await this.queue.promoteDelayedRetries();
      this.logger.log(`Promoted ${promoted} delayed charge retries`);
      return promoted;
    } catch (error) {
      this.logger.error(
        'Could not promote delayed charge retries',
        error instanceof Error ? error.stack : String(error),
      );
      throw new ServiceUnavailableError('Retry queue is unavailable');
    }
  }
}
