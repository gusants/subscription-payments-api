import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Clock } from '../../../shared/clock/index.js';
import { toGatewayChargeJson } from '../../gateway-charge-json.js';
import type { GatewayWebhookPayload } from '../../gateway-webhook-event.js';
import { SIGNATURE_HEADER, sign } from '../../webhook-signature.js';
import { toGatewayCharge } from '../fake-gateway-charge.mapper.js';
import {
  FAKE_WEBHOOK_OPTIONS,
  type FakeWebhookOptions,
} from '../fake-gateway-options.js';
import {
  FakeGatewayStore,
  type StoredGatewayEvent,
} from '../fake-gateway.store.js';
import { DelayScheduler } from './delay-scheduler.js';
import { RandomSource } from './random-source.js';
import { WebhookTransport } from './webhook-transport.js';

const MAX_RESENDS = 3;
const MAX_ATTEMPTS = MAX_RESENDS + 1;
const RETRY_BASE_DELAY_MS = 1000;
const MILLISECONDS_PER_SECOND = 1000;

const isSuccess = (status: number): boolean => status >= 200 && status < 300;

const backoffAfter = (attempt: number): number =>
  RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);

@Injectable()
export class FakeWebhookDispatcher implements OnModuleInit {
  private readonly logger = new Logger(FakeWebhookDispatcher.name);

  constructor(
    private readonly store: FakeGatewayStore,
    private readonly transport: WebhookTransport,
    private readonly random: RandomSource,
    private readonly scheduler: DelayScheduler,
    private readonly clock: Clock,
    @Inject(FAKE_WEBHOOK_OPTIONS) private readonly options: FakeWebhookOptions,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.options.enabled) return;
    try {
      const undelivered = await this.store.read((data) =>
        data.events.filter(
          ({ deliveredAt, attempts }) =>
            deliveredAt === null && attempts < MAX_ATTEMPTS,
        ),
      );
      for (const { id, attempts } of undelivered) {
        this.scheduler.after(this.options.delayMs, () =>
          this.attempt(id, attempts + 1),
        );
      }
    } catch (error) {
      this.logger.error(
        'Could not reschedule undelivered webhooks',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  schedule(events: readonly StoredGatewayEvent[]): void {
    if (!this.options.enabled) return;
    for (const { id } of events) {
      this.scheduler.after(this.options.delayMs, () => this.attempt(id, 1));
    }
  }

  private async attempt(eventId: string, attempt: number): Promise<void> {
    try {
      const body = await this.bodyOf(eventId);
      if (body === null) return;
      const delivered = await this.send(body);
      await this.recordAttempt(eventId, attempt, delivered);
      if (delivered) {
        await this.maybeDuplicate(body);
      } else {
        this.retryOrGiveUp(eventId, attempt);
      }
    } catch (error) {
      this.logger.error(
        `Webhook delivery of ${eventId} failed unexpectedly`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private bodyOf(eventId: string): Promise<string | null> {
    return this.store.read((data) => {
      const event = data.events.find(({ id }) => id === eventId);
      const charge = data.charges.find(({ id }) => id === event?.chargeId);
      if (!event || !charge || event.deliveredAt) return null;
      const payload: GatewayWebhookPayload = {
        id: event.id,
        type: event.type,
        createdAt: event.occurredAt,
        data: { charge: toGatewayChargeJson(toGatewayCharge(charge)) },
      };
      return JSON.stringify(payload);
    });
  }

  private async send(body: string): Promise<boolean> {
    const timestamp = Math.floor(
      this.clock.now().getTime() / MILLISECONDS_PER_SECOND,
    );
    try {
      const status = await this.transport.post({
        url: this.options.url,
        body,
        headers: {
          'content-type': 'application/json',
          [SIGNATURE_HEADER]: sign(body, this.options.secret, timestamp),
        },
      });
      return isSuccess(status);
    } catch {
      return false;
    }
  }

  private recordAttempt(
    eventId: string,
    attempt: number,
    delivered: boolean,
  ): Promise<void> {
    const at = this.clock.now().toISOString();
    return this.store.transaction((data) => {
      const event = data.events.find(({ id }) => id === eventId);
      if (!event) return;
      event.attempts = attempt;
      if (delivered) event.deliveredAt = at;
    });
  }

  private async maybeDuplicate(body: string): Promise<void> {
    if (this.random.next() < this.options.duplicateRate) {
      await this.send(body);
    }
  }

  private retryOrGiveUp(eventId: string, attempt: number): void {
    if (attempt >= MAX_ATTEMPTS) {
      this.logger.warn(
        `Gave up delivering webhook ${eventId} after ${attempt} attempts`,
      );
      return;
    }
    this.scheduler.after(backoffAfter(attempt), () =>
      this.attempt(eventId, attempt + 1),
    );
  }
}
