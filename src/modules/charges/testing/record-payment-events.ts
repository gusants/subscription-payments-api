import { Logger } from '@nestjs/common';
import type { PaymentEvent } from '../payment-events.js';

const isPaymentEvent = (message: unknown): message is PaymentEvent =>
  typeof message === 'object' && message !== null && 'event' in message;

export function recordPaymentEvents(): PaymentEvent[] {
  const recorded: PaymentEvent[] = [];
  for (const level of ['log', 'warn', 'error'] as const) {
    vi.spyOn(Logger.prototype, level).mockImplementation((message) => {
      if (isPaymentEvent(message)) recorded.push(message);
    });
  }
  return recorded;
}

export const eventNames = (recorded: PaymentEvent[]): string[] =>
  recorded.map(({ event }) => event);
