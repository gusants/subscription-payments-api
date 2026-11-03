import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  HttpException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ZodValidationException } from 'nestjs-zod';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { ConflictError } from './conflict.error.js';
import { NotFoundError } from './not-found.error.js';
import { UnprocessableError } from './unprocessable.error.js';

describe('AllExceptionsFilter', () => {
  const response = { marker: 'response' };
  const reply = vi.fn();
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  const filter = new AllExceptionsFilter({
    httpAdapter: { reply },
  } as unknown as HttpAdapterHost);

  beforeEach(() => {
    reply.mockReset();
    vi.spyOn(filter['logger'], 'error').mockImplementation(() => undefined);
  });

  function replied() {
    const [target, body, status] = reply.mock.calls[0]!;
    expect(target).toBe(response);
    return { body, status };
  }

  it('maps NotFoundError to 404', () => {
    filter.catch(new NotFoundError('Plan not found'), host);

    expect(replied()).toEqual({
      status: 404,
      body: { statusCode: 404, error: 'Not Found', message: 'Plan not found' },
    });
  });

  it('maps ConflictError to 409', () => {
    filter.catch(new ConflictError('Already active'), host);

    expect(replied()).toEqual({
      status: 409,
      body: { statusCode: 409, error: 'Conflict', message: 'Already active' },
    });
  });

  it('maps UnprocessableError to 422', () => {
    filter.catch(new UnprocessableError('Plan is inactive'), host);

    expect(replied()).toEqual({
      status: 422,
      body: {
        statusCode: 422,
        error: 'Unprocessable Entity',
        message: 'Plan is inactive',
      },
    });
  });

  it('maps Prisma unique constraint violations to 409', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('dup', {
      code: 'P2002',
      clientVersion: 'test',
    });

    filter.catch(exception, host);

    expect(replied().status).toBe(409);
    expect(replied().body).toMatchObject({ error: 'Conflict' });
  });

  it('maps Prisma foreign key violations to 404', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('fk', {
      code: 'P2003',
      clientVersion: 'test',
    });

    filter.catch(exception, host);

    expect(replied()).toEqual({
      status: 404,
      body: {
        statusCode: 404,
        error: 'Not Found',
        message: 'Referenced resource not found',
      },
    });
  });

  it('does not map other Prisma errors to 409', () => {
    const exception = new Prisma.PrismaClientKnownRequestError('x', {
      code: 'P2025',
      clientVersion: 'test',
    });

    filter.catch(exception, host);

    expect(replied().status).toBe(500);
  });

  it('maps zod validation failures to 400 with issue details', () => {
    const result = z.object({ name: z.string() }).safeParse({});

    filter.catch(new ZodValidationException(result.error), host);

    const { status, body } = replied();
    expect(status).toBe(400);
    expect(body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Validation failed',
      details: [expect.objectContaining({ path: ['name'] })],
    });
  });

  it('keeps the status of Nest HttpExceptions in the standard shape', () => {
    filter.catch(new ForbiddenException('nope'), host);

    expect(replied()).toEqual({
      status: 403,
      body: { statusCode: 403, error: 'Forbidden', message: 'nope' },
    });
  });

  it('joins array messages from Nest HttpExceptions', () => {
    filter.catch(new BadRequestException(['a', 'b']), host);

    expect(replied().body.message).toBe('a; b');
  });

  it('uses plain string responses of HttpExceptions as the message', () => {
    filter.catch(new HttpException('plain', 499), host);

    expect(replied().body).toEqual({
      statusCode: 499,
      error: 'Error',
      message: 'plain',
    });
  });

  it('falls back to the exception message for object responses without one', () => {
    filter.catch(new HttpException({ foo: 'bar' }, 403), host);

    expect(replied().body.message).toBe('Http Exception');
  });

  it('hides unknown errors behind a generic 500', () => {
    filter.catch(new Error('secret'), host);

    expect(replied()).toEqual({
      status: 500,
      body: {
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'Internal server error',
      },
    });
  });
});
