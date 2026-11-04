import { Logger } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FixedClock } from '../../../shared/clock/testing/fixed-clock.js';
import {
  currentCorrelationId,
  runWithCorrelationId,
} from '../../../shared/correlation/index.js';
import { gatewayWebhookPayloadSchema } from '../../gateway-webhook-event.js';
import {
  buildFakeWebhookDispatcher,
  TEST_WEBHOOK_SECRET,
} from '../../testing/build-fake-webhook-dispatcher.js';
import type { RecordingWebhookTransport } from '../../testing/recording-webhook-transport.js';
import { SequenceRandomSource } from '../../testing/sequence-random-source.js';
import { SIGNATURE_HEADER, verify } from '../../webhook-signature.js';
import {
  FakeGatewayStore,
  type StoredGatewayEvent,
} from '../fake-gateway.store.js';

const now = new Date('2026-11-03T10:00:00.000Z');

describe('FakeWebhookDispatcher', () => {
  let directory: string;
  let store: FakeGatewayStore;
  let clock: FixedClock;
  let warn: ReturnType<typeof vi.spyOn>;

  const seed = async (): Promise<StoredGatewayEvent> => {
    const event: StoredGatewayEvent = {
      id: 'evt_1',
      type: 'charge.paid',
      chargeId: 'gch_1',
      externalRef: 'ch_1',
      occurredAt: '2026-11-03T09:59:00.000Z',
      deliveredAt: null,
      attempts: 0,
    };
    await store.transaction((data) => {
      data.charges.push({
        id: 'gch_1',
        customerId: 'gcus_1',
        externalRef: 'ch_1',
        amountCents: 4990,
        method: 'pix',
        idempotencyKey: 'ch_1:1',
        status: 'paid',
        createdAt: '2026-11-03T09:00:00.000Z',
        expiresAt: '2026-11-03T09:30:00.000Z',
        paymentInstructions: { type: 'pix', copyPaste: '000201' },
      });
      data.events.push(event);
    });
    return event;
  };

  const storedEvent = () => store.read((data) => data.events[0]!);

  const build = (
    options: Parameters<typeof buildFakeWebhookDispatcher>[0]['options'] = {},
    random?: SequenceRandomSource,
  ) => buildFakeWebhookDispatcher({ store, clock, options, random });

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'fake-webhooks-'));
    store = new FakeGatewayStore(join(directory, 'fake-gateway.json'));
    clock = new FixedClock(now);
    warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  it('schedules the first delivery after the configured delay and posts nothing before it runs', async () => {
    const event = await seed();
    const { dispatcher, scheduler, transport } = build({ delayMs: 750 });

    dispatcher.schedule([event]);

    expect(scheduler.delays).toEqual([750]);
    expect(transport.requests).toEqual([]);
  });

  it('does nothing when dispatch is disabled', async () => {
    const event = await seed();
    const { dispatcher, scheduler } = build({ enabled: false });

    dispatcher.schedule([event]);

    expect(scheduler.delays).toEqual([]);
  });

  describe('on module init', () => {
    const addEvent = (overrides: Partial<StoredGatewayEvent>) =>
      store.transaction((data) => {
        data.events.push({
          ...data.events[0]!,
          ...overrides,
        });
      });

    it('reschedules an undelivered event as its next attempt after the configured delay', async () => {
      await seed();
      await store.transaction((data) => {
        data.events[0]!.attempts = 2;
      });
      const { dispatcher, scheduler, transport } = build({ delayMs: 300 });

      await dispatcher.onModuleInit();

      expect(scheduler.delays).toEqual([300]);
      await scheduler.runNext();
      expect(transport.requests).toHaveLength(1);
      expect((await storedEvent()).attempts).toBe(3);
      expect((await storedEvent()).deliveredAt).not.toBeNull();
    });

    it('skips delivered events and events that exhausted their attempts', async () => {
      await seed();
      await addEvent({ id: 'evt_done', deliveredAt: now.toISOString() });
      await addEvent({ id: 'evt_gave_up', attempts: 4 });
      await store.transaction((data) => {
        data.events.splice(0, 1);
      });
      const { dispatcher, scheduler } = build();

      await dispatcher.onModuleInit();

      expect(scheduler.delays).toEqual([]);
    });

    it('schedules nothing when dispatch is disabled', async () => {
      await seed();
      const { dispatcher, scheduler } = build({ enabled: false });

      await dispatcher.onModuleInit();

      expect(scheduler.delays).toEqual([]);
    });

    it('does not fail the boot when the store cannot be read', async () => {
      vi.spyOn(store, 'read').mockRejectedValue(new Error('disk gone'));
      const { dispatcher, scheduler } = build();

      await expect(dispatcher.onModuleInit()).resolves.toBeUndefined();

      expect(scheduler.delays).toEqual([]);
    });
  });

  describe('delivery', () => {
    it('posts the JSON payload to the configured url with a signature over the raw body', async () => {
      const event = await seed();
      const { dispatcher, scheduler, transport } = build({
        url: 'http://api.test/webhooks/gateway',
      });
      dispatcher.schedule([event]);

      await scheduler.runNext();

      const [request] = transport.requests;
      expect(transport.requests).toHaveLength(1);
      expect(request?.url).toBe('http://api.test/webhooks/gateway');
      expect(request?.headers['content-type']).toBe('application/json');
      expect(
        verify(
          request!.body,
          request!.headers[SIGNATURE_HEADER]!,
          TEST_WEBHOOK_SECRET,
        ),
      ).toEqual({ valid: true, timestamp: now.getTime() / 1000 });
      expect(JSON.parse(request!.body)).toEqual({
        id: 'evt_1',
        type: 'charge.paid',
        createdAt: '2026-11-03T09:59:00.000Z',
        data: {
          charge: {
            id: 'gch_1',
            customerId: 'gcus_1',
            externalRef: 'ch_1',
            amountCents: 4990,
            method: 'pix',
            status: 'paid',
            createdAt: '2026-11-03T09:00:00.000Z',
            expiresAt: '2026-11-03T09:30:00.000Z',
            paymentInstructions: { type: 'pix', copyPaste: '000201' },
          },
        },
      });
      expect(
        gatewayWebhookPayloadSchema.safeParse(JSON.parse(request!.body))
          .success,
      ).toBe(true);
    });

    it('marks the event delivered with its attempt count on a 2xx answer', async () => {
      const event = await seed();
      const { dispatcher, scheduler } = build();
      dispatcher.schedule([event]);

      await scheduler.runNext();

      expect(await storedEvent()).toMatchObject({
        deliveredAt: now.toISOString(),
        attempts: 1,
      });
    });

    it('drops an event whose charge no longer exists', async () => {
      const event = await seed();
      await store.reset();
      const { dispatcher, scheduler, transport } = build();
      dispatcher.schedule([event]);

      await scheduler.runNext();

      expect(transport.requests).toEqual([]);
    });
  });

  describe('retries', () => {
    it.each([
      ['a non-2xx answer', 404],
      ['a network failure', new Error('ECONNREFUSED')],
    ])('resends once after %s with the same event id', async (_, failure) => {
      const event = await seed();
      const { dispatcher, scheduler, transport } = build();
      transport.respondWith(failure);
      dispatcher.schedule([event]);

      await scheduler.runNext();
      expect(await storedEvent()).toMatchObject({
        deliveredAt: null,
        attempts: 1,
      });
      await scheduler.runNext();

      expect(transport.requests.map(({ body }) => JSON.parse(body).id)).toEqual(
        ['evt_1', 'evt_1'],
      );
      expect(await storedEvent()).toMatchObject({
        deliveredAt: now.toISOString(),
        attempts: 2,
      });
    });

    it('backs off exponentially, resends three times and then gives up', async () => {
      const event = await seed();
      const { dispatcher, scheduler, transport } = build();
      transport.respondWith(500, 500, 500, 500);
      dispatcher.schedule([event]);
      const resendDelays: number[] = [];

      await scheduler.runNext();
      while (scheduler.delays.length > 0) {
        resendDelays.push(scheduler.delays[0]!);
        await scheduler.runNext();
      }

      expect(resendDelays).toEqual([1000, 2000, 4000]);
      expect(transport.requests).toHaveLength(4);
      expect(await storedEvent()).toMatchObject({
        deliveredAt: null,
        attempts: 4,
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('Gave up delivering webhook evt_1'),
      );
    });

    it('does not redeliver an event already delivered', async () => {
      const event = await seed();
      const { dispatcher, scheduler, transport } = build();
      dispatcher.schedule([event]);
      dispatcher.schedule([event]);

      await scheduler.runNext();
      await scheduler.runNext();

      expect(transport.requests).toHaveLength(1);
    });
  });

  describe('duplication', () => {
    it('sends the event once at rate 0', async () => {
      const event = await seed();
      const { dispatcher, scheduler, transport } = build({
        duplicateRate: 0,
      });
      dispatcher.schedule([event]);

      await scheduler.runNext();

      expect(transport.requests).toHaveLength(1);
    });

    it('sends the same event twice at rate 1, each time freshly signed', async () => {
      const event = await seed();
      const { dispatcher, scheduler, transport } = build({
        duplicateRate: 1,
      });
      dispatcher.schedule([event]);

      await scheduler.runNext();

      expect(transport.requests).toHaveLength(2);
      expect(transport.requests[1]?.body).toBe(transport.requests[0]?.body);
      expect(
        verify(
          transport.requests[1]!.body,
          transport.requests[1]!.headers[SIGNATURE_HEADER]!,
          TEST_WEBHOOK_SECRET,
        ).valid,
      ).toBe(true);
    });

    it.each([
      [0.49, 2],
      [0.5, 1],
    ])(
      'draws %s against a rate of 0.5 and sends %s time(s)',
      async (draw, sent) => {
        const event = await seed();
        const { dispatcher, scheduler, transport } = build(
          { duplicateRate: 0.5 },
          new SequenceRandomSource([draw]),
        );
        dispatcher.schedule([event]);

        await scheduler.runNext();

        expect(transport.requests).toHaveLength(sent);
      },
    );

    it('does not duplicate an attempt that failed', async () => {
      const event = await seed();
      const { dispatcher, scheduler, transport } = build({
        duplicateRate: 1,
      });
      transport.respondWith(500);
      dispatcher.schedule([event]);

      await scheduler.runNext();

      expect(transport.requests).toHaveLength(1);
    });
  });

  describe('correlation', () => {
    const correlationIdsOfPosts = (transport: RecordingWebhookTransport) => {
      const seen: (string | undefined)[] = [];
      const post = transport.post.bind(transport);
      vi.spyOn(transport, 'post').mockImplementation((request) => {
        seen.push(currentCorrelationId());
        return post(request);
      });
      return seen;
    };

    it('delivers and resends within the correlation id of the scheduling context', async () => {
      const event = await seed();
      const { dispatcher, scheduler, transport } = build();
      const seen = correlationIdsOfPosts(transport);
      transport.respondWith(500, 200);

      runWithCorrelationId('journey-0001', () => dispatcher.schedule([event]));
      await scheduler.runNext();
      await scheduler.runNext();

      expect(seen).toEqual(['journey-0001', 'journey-0001']);
    });

    it('delivers within a generated correlation id when scheduled outside any context', async () => {
      await seed();
      const { dispatcher, scheduler, transport } = build();
      const seen = correlationIdsOfPosts(transport);

      await dispatcher.onModuleInit();
      await scheduler.runNext();

      expect(seen).toEqual([expect.stringMatching(/^cor_/)]);
    });
  });
});
