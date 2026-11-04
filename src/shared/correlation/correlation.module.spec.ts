import { Controller, Get, Logger, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LoggerModule, Logger as PinoNestLogger } from 'nestjs-pino';
import { Writable } from 'node:stream';
import request from 'supertest';
import { buildPinoHttpOptions } from '../logging/pino-http-options.js';
import { currentCorrelationId } from './correlation-context.js';
import { CORRELATION_ID_HEADER } from './correlation-id.js';
import { CorrelationModule } from './correlation.module.js';

@Controller('echo')
class EchoController {
  private readonly logger = new Logger(EchoController.name);

  @Get()
  async echo(): Promise<{ correlationId: string | undefined }> {
    await new Promise((resolve) => setTimeout(resolve, 1));
    this.logger.log('handled echo');
    return { correlationId: currentCorrelationId() };
  }
}

class LineCollector extends Writable {
  readonly lines: Record<string, unknown>[] = [];

  override _write(chunk: Buffer, _encoding: string, done: () => void): void {
    this.lines.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
    done();
  }
}

describe('CorrelationModule', () => {
  let app: INestApplication;
  let logs: LineCollector;

  beforeAll(async () => {
    logs = new LineCollector();
    const moduleRef = await Test.createTestingModule({
      imports: [
        LoggerModule.forRoot({
          pinoHttp: [
            buildPinoHttpOptions({ nodeEnv: 'test', level: 'info' }),
            logs,
          ],
        }),
        CorrelationModule,
      ],
      controllers: [EchoController],
    }).compile();
    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.useLogger(app.get(PinoNestLogger));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const linesOf = (correlationId: string) =>
    logs.lines.filter((line) => line['correlationId'] === correlationId);

  it('reuses a valid incoming id in the response, the handler and every log line', async () => {
    const response = await request(app.getHttpServer())
      .get('/echo')
      .set(CORRELATION_ID_HEADER, 'client-journey-01')
      .expect(200);

    expect(response.headers[CORRELATION_ID_HEADER]).toBe('client-journey-01');
    expect(response.body).toEqual({ correlationId: 'client-journey-01' });
    expect(linesOf('client-journey-01').map((line) => line['msg'])).toEqual([
      'handled echo',
      'request completed',
    ]);
  });

  it('generates an id when the header is missing', async () => {
    const response = await request(app.getHttpServer())
      .get('/echo')
      .expect(200);

    const generated = response.headers[CORRELATION_ID_HEADER] as string;
    expect(generated).toMatch(/^cor_[0-9a-z]{26}$/);
    expect(response.body).toEqual({ correlationId: generated });
    expect(linesOf(generated)).toHaveLength(2);
  });

  it('discards a malformed id and never logs it', async () => {
    const injected = 'x", "level": 60, "msg": "forged';

    const response = await request(app.getHttpServer())
      .get('/echo')
      .set(CORRELATION_ID_HEADER, injected)
      .expect(200);

    const generated = response.headers[CORRELATION_ID_HEADER] as string;
    expect(generated).toMatch(/^cor_/);
    expect(linesOf(generated)).toHaveLength(2);
    expect(linesOf(injected)).toHaveLength(0);
  });

  it('answers unknown routes with an id as well', async () => {
    const response = await request(app.getHttpServer())
      .get('/nope')
      .expect(404);

    expect(response.headers[CORRELATION_ID_HEADER]).toMatch(/^cor_/);
  });

  it('keeps concurrent requests apart', async () => {
    const ids = ['parallel-journey-a', 'parallel-journey-b'];

    const responses = await Promise.all(
      ids.map((id) =>
        request(app.getHttpServer())
          .get('/echo')
          .set(CORRELATION_ID_HEADER, id),
      ),
    );

    expect(responses.map(({ body }) => body.correlationId)).toEqual(ids);
    for (const id of ids) expect(linesOf(id)).toHaveLength(2);
  });
});
