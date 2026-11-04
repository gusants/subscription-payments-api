import {
  Body,
  Controller,
  HttpCode,
  Module,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Response } from 'express';
import request from 'supertest';
import { createZodDto, ZodResponse } from 'nestjs-zod';
import { z } from 'zod';
import { Logger } from '@nestjs/common';
import { ConflictError } from '../errors/conflict.error.js';
import { NotFoundError } from '../errors/not-found.error.js';
import { UnprocessableError } from '../errors/unprocessable.error.js';
import { HttpModule } from '../http/http.module.js';
import { IDEMPOTENCY_LOCK_HEARTBEAT_MS } from './idempotency.constants.js';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { describeIdempotencyKey } from './idempotency-key.js';
import { IdempotencyStore } from './idempotency.store.js';
import { Idempotent } from './idempotent.decorator.js';
import { InMemoryIdempotencyStore } from './testing/in-memory-idempotency.store.js';

const HEARTBEAT_MS = 15;

class WidgetBody extends createZodDto(z.object({ name: z.string().min(1) })) {}
class WidgetResponse extends createZodDto(
  z.object({ id: z.string(), name: z.string() }),
) {}

const probe = {
  executions: 0,
  release: undefined as (() => void) | undefined,
  started: undefined as (() => void) | undefined,
};

@Controller('widgets')
class WidgetsController {
  @Post()
  @Idempotent()
  @ZodResponse({ status: 201, type: WidgetResponse })
  create(@Body() body: WidgetBody) {
    probe.executions += 1;
    return { id: `w_${probe.executions}`, name: body.name, secret: 'leak' };
  }

  @Post(':id/act')
  @Idempotent()
  @HttpCode(200)
  async act(@Param('id') id: string) {
    probe.executions += 1;
    if (id === 'missing') throw new NotFoundError('Widget missing not found');
    if (id === 'busy') throw new ConflictError('Widget is busy');
    if (id === 'rejected') throw new UnprocessableError('Widget is rejected');
    if (id === 'flaky') {
      throw new ConflictError('Widget is flaky', { transient: true });
    }
    if (id === 'unready') {
      throw new UnprocessableError('Widget is not ready', { transient: true });
    }
    if (id === 'boom') throw new Error('database exploded');
    if (id === 'slow') {
      probe.started?.();
      await new Promise<void>((resolve) => {
        probe.release = resolve;
      });
    }
    return { id, executions: probe.executions };
  }

  @Post(':id/accept')
  @Idempotent()
  @HttpCode(200)
  accept(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    probe.executions += 1;
    res.status(202);
    return { id, executions: probe.executions };
  }

  @Post('plain')
  @HttpCode(200)
  plain() {
    probe.executions += 1;
    return { executions: probe.executions };
  }
}

describe('IdempotencyInterceptor', () => {
  let store: InMemoryIdempotencyStore;
  let app: Awaited<ReturnType<typeof createApp>>;

  async function createApp() {
    @Module({
      providers: [
        { provide: IdempotencyStore, useValue: store },
        { provide: IDEMPOTENCY_LOCK_HEARTBEAT_MS, useValue: HEARTBEAT_MS },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
      ],
    })
    class IdempotencyTestModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [IdempotencyTestModule, HttpModule],
      controllers: [WidgetsController],
    }).compile();
    const nest = moduleRef.createNestApplication();
    await nest.init();
    return nest;
  }

  let errorLog: ReturnType<typeof vi.spyOn>;
  let warnLog: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    errorLog = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnLog = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    store = new InMemoryIdempotencyStore();
    probe.executions = 0;
    app = await createApp();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
  });

  const expectNoLoggedKey = () => {
    const logged = JSON.stringify(errorLog.mock.calls);
    expect(logged).not.toContain('k1');
    expect(logged).not.toContain('idempotency:');
  };

  const post = (path: string, key?: string) => {
    const req = request(app.getHttpServer()).post(path);
    return key === undefined ? req : req.set('Idempotency-Key', key);
  };

  it('passes through without the header and stores nothing', async () => {
    await post('/widgets').send({ name: 'a' }).expect(201);
    await post('/widgets').send({ name: 'a' }).expect(201);

    expect(probe.executions).toBe(2);
    expect(store.entries.size).toBe(0);
  });

  it('replays the stored 2xx status code, not the route default', async () => {
    const first = await post('/widgets/w_1/accept', 'k').expect(202);
    const second = await post('/widgets/w_1/accept', 'k').expect(202);

    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(probe.executions).toBe(1);
  });

  it('leaves routes without @Idempotent() alone even with the header', async () => {
    await post('/widgets/plain', 'k').expect(200);
    await post('/widgets/plain', 'k').expect(200);

    expect(probe.executions).toBe(2);
    expect(store.entries.size).toBe(0);
  });

  it('stores the serialized body and the real status, then replays without running the handler', async () => {
    const first = await post('/widgets', 'k1').send({ name: 'a' }).expect(201);
    const second = await post('/widgets', 'k1').send({ name: 'a' }).expect(201);

    expect(first.body).toEqual({ id: 'w_1', name: 'a' });
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(probe.executions).toBe(1);
  });

  it('treats the body as the same regardless of key order', async () => {
    const first = await post('/widgets/x/act', 'k2').send({ a: 1, b: 2 });
    const second = await post('/widgets/x/act', 'k2').send({ b: 2, a: 1 });

    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(probe.executions).toBe(1);
  });

  it('answers 422 for the same key with a different body and does not run the handler', async () => {
    await post('/widgets', 'k1').send({ name: 'a' }).expect(201);

    const response = await post('/widgets', 'k1')
      .send({ name: 'b' })
      .expect(422);

    expect(response.body).toEqual({
      statusCode: 422,
      error: 'Unprocessable Entity',
      message: 'Idempotency-Key was already used with a different request',
    });
    expect(probe.executions).toBe(1);
  });

  it('answers 409 while the first request is in flight and replays once it completes', async () => {
    const started = new Promise<void>((resolve) => {
      probe.started = resolve;
    });
    const firstRequest = post('/widgets/slow/act', 'k1')
      .send({})
      .then((response) => response);
    await started;

    const concurrent = await post('/widgets/slow/act', 'k1')
      .send({})
      .expect(409);
    probe.release?.();
    const first = await firstRequest;
    const replay = await post('/widgets/slow/act', 'k1').send({});

    expect(concurrent.body.message).toBe(
      'A request with this Idempotency-Key is still being processed',
    );
    expect(first.status).toBe(200);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(probe.executions).toBe(1);
  });

  it.each([
    ['missing', 404, 'Not Found', 'Widget missing not found'],
    ['busy', 409, 'Conflict', 'Widget is busy'],
    ['rejected', 422, 'Unprocessable Entity', 'Widget is rejected'],
  ])(
    'stores the %s rejection and replays the exact error body',
    async (id, statusCode, error, message) => {
      const first = await post(`/widgets/${id}/act`, 'k1')
        .send({})
        .expect(statusCode);
      const second = await post(`/widgets/${id}/act`, 'k1')
        .send({})
        .expect(statusCode);

      expect(first.body).toEqual({ statusCode, error, message });
      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(probe.executions).toBe(1);
    },
  );

  it('releases the lock on a 5xx so the same key can run again', async () => {
    await post('/widgets/boom/act', 'k1').send({}).expect(500);
    expect(store.entries.size).toBe(0);

    await post('/widgets/boom/act', 'k1').send({}).expect(500);

    expect(probe.executions).toBe(2);
  });

  it('does not store a validation 400, so a corrected body can reuse the key', async () => {
    await post('/widgets', 'k1').send({ name: '' }).expect(400);
    expect(store.entries.size).toBe(0);

    await post('/widgets', 'k1').send({ name: 'a' }).expect(201);

    expect(probe.executions).toBe(1);
  });

  it.each(['', 'x'.repeat(256), 'café'])(
    'answers 400 for the invalid key %j without running the handler',
    async (key) => {
      const response = await post('/widgets', key)
        .send({ name: 'a' })
        .expect(400);

      expect(response.body.message).toBe(
        'Idempotency-Key must be 1 to 255 printable ASCII characters',
      );
      expect(probe.executions).toBe(0);
    },
  );

  it('scopes the same key by resolved path', async () => {
    const first = await post('/widgets/a/act', 'k1').send({}).expect(200);
    const second = await post('/widgets/b/act', 'k1').send({}).expect(200);

    expect(first.body.id).toBe('a');
    expect(second.body.id).toBe('b');
    expect(second.headers['idempotent-replayed']).toBeUndefined();
    expect([...store.entries.keys()]).toEqual([
      'idempotency:POST:/widgets/a/act:k1',
      'idempotency:POST:/widgets/b/act:k1',
    ]);
  });

  it('answers 503 without running the handler when the store fails to acquire', async () => {
    store.failingOperations.add('acquire');

    const response = await post('/widgets', 'k1')
      .send({ name: 'a' })
      .expect(503);

    expect(response.body.message).toBe('Idempotency store unavailable');
    expect(probe.executions).toBe(0);
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining(
        `Could not acquire idempotency lock for ${describeIdempotencyKey('POST', '/widgets', 'k1')}`,
      ),
      expect.any(String),
    );
    expectNoLoggedKey();
  });

  it('still answers the real response when the store fails to record it', async () => {
    store.failingOperations.add('complete');

    const response = await post('/widgets', 'k1')
      .send({ name: 'a' })
      .expect(201);

    expect(response.body).toEqual({ id: 'w_1', name: 'a' });
  });

  it('still answers the original error when the store fails to release', async () => {
    store.failingOperations.add('release');

    await post('/widgets/boom/act', 'k1').send({}).expect(500);
  });

  describe.each([
    ['a transient conflict', 'flaky', 409],
    ['a transient unprocessable', 'unready', 422],
  ])('%s', (_name, id, statusCode) => {
    it('answers the error but releases the key instead of storing it', async () => {
      const first = await post(`/widgets/${id}/act`, 'k1')
        .send({})
        .expect(statusCode);
      expect(store.entries.size).toBe(0);

      const second = await post(`/widgets/${id}/act`, 'k1')
        .send({})
        .expect(statusCode);

      expect(second.body).toEqual(first.body);
      expect(second.headers['idempotent-replayed']).toBeUndefined();
      expect(probe.executions).toBe(2);
    });
  });

  describe('lock heartbeat', () => {
    const SLOW_HANDLER_MS = 150;

    const runSlowRequest = async (
      whileRunning: () => void | Promise<void> = () => undefined,
    ) => {
      const started = new Promise<void>((resolve) => {
        probe.started = resolve;
      });
      const pending = post('/widgets/slow/act', 'k1')
        .send({})
        .then((response) => response);
      await started;
      await whileRunning();
      await new Promise((resolve) => setTimeout(resolve, SLOW_HANDLER_MS));
      probe.release?.();
      return pending;
    };

    it('extends the lock while the handler runs and stops once it finished', async () => {
      let extensionsAtFinish = 0;

      const response = await runSlowRequest();
      extensionsAtFinish = store.extensions;
      await new Promise((resolve) => setTimeout(resolve, HEARTBEAT_MS * 4));

      expect(response.status).toBe(200);
      expect(extensionsAtFinish).toBeGreaterThanOrEqual(3);
      expect(store.extensions).toBe(extensionsAtFinish);
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('logs an error naming the key when the lock is lost while the handler runs, and when completing it', async () => {
      const response = await runSlowRequest(() => {
        store.entries.clear();
      });

      expect(response.status).toBe(200);
      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(
          describeIdempotencyKey('POST', '/widgets/slow/act', 'k1'),
        ),
      );
      expect(errorLog).toHaveBeenCalledTimes(2);
      expectNoLoggedKey();
    });

    it('keeps heartbeating after a failed extension and does not fail the request', async () => {
      store.failTimes('extendLock', 2);

      const response = await runSlowRequest();

      expect(response.status).toBe(200);
      expect(store.extensions).toBeGreaterThanOrEqual(1);
      expect(warnLog).toHaveBeenCalledWith(
        `Could not extend idempotency lock for ${describeIdempotencyKey('POST', '/widgets/slow/act', 'k1')}: in-memory store extendLock failed`,
      );
      expect(JSON.stringify(warnLog.mock.calls)).not.toContain('k1');
    });
  });

  describe('settling the record', () => {
    it('retries a failing complete and stores the response without logging an error', async () => {
      store.failTimes('complete', 2);

      await post('/widgets', 'k1').send({ name: 'a' }).expect(201);
      const replay = await post('/widgets', 'k1').send({ name: 'a' });

      expect(replay.headers['idempotent-replayed']).toBe('true');
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('logs an error naming the key once complete keeps failing', async () => {
      store.failingOperations.add('complete');

      await post('/widgets', 'k1').send({ name: 'a' }).expect(201);

      expect(errorLog).toHaveBeenCalledWith(
        expect.stringContaining(
          describeIdempotencyKey('POST', '/widgets', 'k1'),
        ),
        expect.any(String),
      );
      expectNoLoggedKey();
    });
  });
});
