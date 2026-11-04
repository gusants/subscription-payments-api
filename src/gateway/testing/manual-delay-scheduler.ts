import { DelayScheduler } from '../fake/webhook/delay-scheduler.js';

interface ScheduledTask {
  delayMs: number;
  task: () => Promise<void>;
}

export class ManualDelayScheduler extends DelayScheduler {
  private queue: ScheduledTask[] = [];

  after(delayMs: number, task: () => Promise<void>): void {
    this.queue.push({ delayMs, task });
  }

  get delays(): number[] {
    return this.queue.map(({ delayMs }) => delayMs);
  }

  async runNext(): Promise<void> {
    await this.queue.shift()?.task();
  }

  clear(): void {
    this.queue = [];
  }
}
