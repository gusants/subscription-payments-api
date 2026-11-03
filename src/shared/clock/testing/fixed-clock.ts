import { Clock } from '../clock.js';

export class FixedClock extends Clock {
  constructor(private current: Date) {
    super();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(instant: Date): void {
    this.current = instant;
  }
}
