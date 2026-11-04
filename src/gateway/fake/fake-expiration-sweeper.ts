import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { runWithinCorrelation } from '../../shared/correlation/index.js';
import {
  FAKE_EXPIRATION_SWEEP,
  type FakeExpirationSweep,
} from './fake-gateway-options.js';
import { FakeGatewaySimulator } from './fake-gateway.simulator.js';

@Injectable()
export class FakeExpirationSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FakeExpirationSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly simulator: FakeGatewaySimulator,
    @Inject(FAKE_EXPIRATION_SWEEP) private readonly sweep: FakeExpirationSweep,
  ) {}

  onModuleInit(): void {
    if (this.sweep.intervalMs <= 0) return;
    this.timer = setInterval(
      () => void runWithinCorrelation(() => this.run()),
      this.sweep.intervalMs,
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async run(): Promise<void> {
    try {
      await this.simulator.expireDue();
    } catch (error) {
      this.logger.error(
        'Fake gateway expiration sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
