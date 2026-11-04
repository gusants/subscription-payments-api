export abstract class DelayScheduler {
  abstract after(delayMs: number, task: () => Promise<void>): void;
}
