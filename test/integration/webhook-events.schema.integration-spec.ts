import { PrismaService } from '../../src/shared/database/prisma.service.js';
import { generateId, ID_PREFIXES } from '../../src/shared/ids/index.js';
import { createPrismaService } from '../support/prisma-test-client.js';

describe('webhook_events schema (integration)', () => {
  let prisma: PrismaService;

  beforeAll(() => {
    prisma = createPrismaService();
  });

  beforeEach(async () => {
    await prisma.webhookEvent.deleteMany();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  const eventData = (overrides: Record<string, unknown> = {}) => ({
    id: generateId(ID_PREFIXES.webhookEvent),
    gatewayEventId: 'evt_1',
    type: 'charge.paid',
    gatewayChargeId: 'gch_1',
    payload: { id: 'evt_1', type: 'charge.paid' },
    ...overrides,
  });

  it('records a received event that is not processed yet', async () => {
    const event = await prisma.webhookEvent.create({ data: eventData() });

    expect(event).toMatchObject({
      gatewayEventId: 'evt_1',
      processedAt: null,
      outcome: null,
      payload: { id: 'evt_1', type: 'charge.paid' },
    });
    expect(event.receivedAt).toBeInstanceOf(Date);
  });

  it('rejects a second event with the same gateway event id', async () => {
    await prisma.webhookEvent.create({ data: eventData() });

    await expect(
      prisma.webhookEvent.create({ data: eventData() }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('accepts an event without a charge reference', async () => {
    await expect(
      prisma.webhookEvent.create({
        data: eventData({ gatewayChargeId: null }),
      }),
    ).resolves.toMatchObject({ gatewayChargeId: null });
  });

  it.each([
    'applied',
    'ignored_duplicate_state',
    'ignored_unknown_charge',
    'rejected_out_of_order',
    'requires_refund',
    'rejected_mismatch',
  ] as const)(
    'records the %s outcome with its processing time',
    async (outcome) => {
      const processedAt = new Date('2026-01-31T10:30:00.000Z');

      const event = await prisma.webhookEvent.create({
        data: eventData({ outcome, processedAt }),
      });

      expect(event).toMatchObject({ outcome, processedAt });
    },
  );

  it('rejects an unknown outcome', async () => {
    await expect(
      prisma.webhookEvent.create({
        data: eventData({
          outcome: 'shrugged',
          processedAt: new Date(),
        }),
      }),
    ).rejects.toThrow();
  });

  it('rejects an outcome without a processing time and the reverse', async () => {
    await expect(
      prisma.webhookEvent.create({ data: eventData({ outcome: 'applied' }) }),
    ).rejects.toThrow();
    await expect(
      prisma.webhookEvent.create({
        data: eventData({ gatewayEventId: 'evt_2', processedAt: new Date() }),
      }),
    ).rejects.toThrow();
  });

  it('indexes the charge lookup', async () => {
    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'webhook_events'`;

    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        'webhook_events_gateway_event_id_key',
        'webhook_events_gateway_charge_id_idx',
      ]),
    );
  });
});
