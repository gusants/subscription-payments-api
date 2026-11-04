import type { Clock } from '../../shared/clock/index.js';
import type { FakeWebhookOptions } from '../fake/fake-gateway-options.js';
import type { FakeGatewayStore } from '../fake/fake-gateway.store.js';
import { FakeWebhookDispatcher } from '../fake/webhook/fake-webhook.dispatcher.js';
import { ManualDelayScheduler } from './manual-delay-scheduler.js';
import { RecordingWebhookTransport } from './recording-webhook-transport.js';
import { SequenceRandomSource } from './sequence-random-source.js';

export const TEST_WEBHOOK_SECRET = 'unit-test-webhook-secret-with-32-chars';

export const TEST_WEBHOOK_OPTIONS: FakeWebhookOptions = {
  enabled: true,
  url: 'http://localhost:3000/webhooks/gateway',
  secret: TEST_WEBHOOK_SECRET,
  delayMs: 500,
  duplicateRate: 0,
};

export interface FakeWebhookDispatcherParts {
  store: FakeGatewayStore;
  clock: Clock;
  options?: Partial<FakeWebhookOptions>;
  random?: SequenceRandomSource;
}

export function buildFakeWebhookDispatcher({
  store,
  clock,
  options = {},
  random = new SequenceRandomSource(),
}: FakeWebhookDispatcherParts) {
  const transport = new RecordingWebhookTransport();
  const scheduler = new ManualDelayScheduler();
  const dispatcher = new FakeWebhookDispatcher(
    store,
    transport,
    random,
    scheduler,
    clock,
    { ...TEST_WEBHOOK_OPTIONS, ...options },
  );
  return { dispatcher, transport, scheduler };
}
