import {
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Query,
  type INestApplication,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoggerModule, Logger as PinoNestLogger } from 'nestjs-pino';
import { Writable } from 'node:stream';
import { pino, type Logger as PinoLogger, type LoggerOptions } from 'pino';
import request from 'supertest';
import { CorrelationModule } from '../correlation/correlation.module.js';
import { buildPinoHttpOptions } from './pino-http-options.js';
import { REDACTED } from './redact-paths.js';

const CARD_TOKEN = 'tok_secret_4242';
const EMAIL = 'ana.secret@example.com';
const SIGNATURE = 't=1700000000,v1=deadbeefcafe';
const BEARER = 'Bearer very-secret';
const IDEMPOTENCY_KEY = 'idem-secret-key-1';
const SECRETS = [CARD_TOKEN, EMAIL, SIGNATURE, BEARER, IDEMPOTENCY_KEY];

class LineCollector extends Writable {
  readonly raw: string[] = [];

  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.raw.push(chunk.toString());
    done();
  }

  lines(): Record<string, unknown>[] {
    return this.raw.map((line) => JSON.parse(line) as Record<string, unknown>);
  }
}

const productionOptions = () =>
  buildPinoHttpOptions({ nodeEnv: 'production', level: 'info' });

describe('log redaction', () => {
  describe('of logged objects', () => {
    let logs: LineCollector;
    let logger: PinoLogger<never>;

    beforeEach(() => {
      logs = new LineCollector();
      logger = pino(productionOptions() as LoggerOptions, logs);
    });

    it.each([
      ['top level', { cardToken: CARD_TOKEN, email: EMAIL, token: CARD_TOKEN }],
      [
        'one level deep',
        { body: { cardToken: CARD_TOKEN }, customer: { email: EMAIL } },
      ],
      [
        'two levels deep',
        {
          req: {
            body: { cardToken: CARD_TOKEN },
            params: { token: CARD_TOKEN },
          },
          request: { customer: { email: EMAIL } },
        },
      ],
    ])('masks card tokens and e-mails %s', (_depth, fields) => {
      logger.info(fields, 'creating subscription');

      expect(logs.raw.join('')).not.toContain(CARD_TOKEN);
      expect(logs.raw.join('')).not.toContain(EMAIL);
      expect(logs.raw.join('')).toContain(REDACTED);
    });

    it('keeps the fields an investigation needs', () => {
      logger.info(
        { chargeId: 'ch_1', subscriptionId: 'sub_1', cardToken: CARD_TOKEN },
        'charge created',
      );

      expect(logs.lines()[0]).toMatchObject({
        chargeId: 'ch_1',
        subscriptionId: 'sub_1',
        cardToken: REDACTED,
        msg: 'charge created',
      });
    });
  });

  describe('of HTTP requests', () => {
    @Controller('subscriptions')
    class EchoSubscriptionsController {
      private readonly logger = new Logger(EchoSubscriptionsController.name);

      @Post()
      create(@Body() body: Record<string, unknown>): { ok: true } {
        this.logger.log({ msg: 'received subscription', body });
        return { ok: true };
      }

      @Get()
      list(@Query('search') search: string): { matches: number } {
        return { matches: search.length };
      }
    }

    let app: INestApplication;
    const logs = new LineCollector();

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          LoggerModule.forRoot({ pinoHttp: [productionOptions(), logs] }),
          CorrelationModule,
        ],
        controllers: [EchoSubscriptionsController],
      }).compile();
      app = moduleRef.createNestApplication({ bufferLogs: true });
      app.useLogger(app.get(PinoNestLogger));
      await app.init();
    });

    afterAll(async () => {
      await app.close();
    });

    it('never writes credentials, signatures, card tokens or e-mails', async () => {
      await request(app.getHttpServer())
        .post('/subscriptions')
        .set('authorization', BEARER)
        .set('cookie', 'session=secret')
        .set('x-gateway-signature', SIGNATURE)
        .set('idempotency-key', IDEMPOTENCY_KEY)
        .send({ cardToken: CARD_TOKEN, customer: { email: EMAIL } })
        .expect(201);

      const written = logs.raw.join('');
      for (const secret of SECRETS) expect(written).not.toContain(secret);
      expect(written).not.toContain('session=secret');
      const completed = logs
        .lines()
        .find(({ msg }) => msg === 'request completed') as {
        req: { headers: Record<string, string> };
      };
      expect(completed.req.headers).toMatchObject({
        authorization: REDACTED,
        cookie: REDACTED,
        'x-gateway-signature': REDACTED,
        'idempotency-key': REDACTED,
      });
    });

    it('never writes the values of a query string', async () => {
      logs.raw.length = 0;

      await request(app.getHttpServer())
        .get('/subscriptions')
        .query({ search: EMAIL, page: 2 })
        .expect(200);

      expect(logs.raw.join('')).not.toContain('ana.secret');
      const completed = logs
        .lines()
        .find(({ msg }) => msg === 'request completed') as {
        req: Record<string, unknown>;
      };
      expect(completed.req['url']).toBe(`/subscriptions?${REDACTED}`);
      expect(completed.req).not.toHaveProperty('query');
      expect(completed.req).toMatchObject({ method: 'GET', params: {} });
    });
  });
});
