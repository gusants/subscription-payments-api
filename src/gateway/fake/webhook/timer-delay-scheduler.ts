import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { DelayScheduler } from './delay-scheduler.js';

@Injectable()
export class TimerDelayScheduler
  extends DelayScheduler
  implements OnModuleDestroy
{
  private readonly pending = new Set<NodeJS.Timeout>();

  after(delayMs: number, task: () => Promise<void>): void {
    const timer = setTimeout(() => {
      this.pending.delete(timer);
      void task();
    }, delayMs);
    timer.unref();
    this.pending.add(timer);
  }

  onModuleDestroy(): void {
    for (const timer of this.pending) clearTimeout(timer);
    this.pending.clear();
  }
}
