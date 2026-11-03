import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { ConflictError } from './conflict.error.js';
import type { ErrorResponse } from './error-response.js';
import { NotFoundError } from './not-found.error.js';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const body = this.toErrorResponse(exception);
    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception);
    }
    const { httpAdapter } = this.httpAdapterHost;
    httpAdapter.reply(host.switchToHttp().getResponse(), body, body.statusCode);
  }

  private toErrorResponse(exception: unknown): ErrorResponse {
    if (exception instanceof ZodValidationException) {
      return this.fromValidation(exception);
    }
    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }
    if (exception instanceof NotFoundError) {
      return build(HttpStatus.NOT_FOUND, exception.message);
    }
    if (exception instanceof ConflictError) {
      return build(HttpStatus.CONFLICT, exception.message);
    }
    if (isUniqueConstraintViolation(exception)) {
      return build(HttpStatus.CONFLICT, 'Resource already exists');
    }
    return build(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
  }

  private fromValidation(exception: ZodValidationException): ErrorResponse {
    const zodError = exception.getZodError();
    const details = zodError instanceof ZodError ? zodError.issues : undefined;
    return build(HttpStatus.BAD_REQUEST, 'Validation failed', details);
  }

  private fromHttpException(exception: HttpException): ErrorResponse {
    const status = exception.getStatus();
    const response = exception.getResponse();
    const message =
      typeof response === 'string' ? response : messageOf(response, exception);
    return build(status, message);
  }
}

function messageOf(response: object, exception: HttpException): string {
  const message = 'message' in response ? response.message : undefined;
  if (Array.isArray(message)) {
    return message.join('; ');
  }
  return typeof message === 'string' ? message : exception.message;
}

function isUniqueConstraintViolation(exception: unknown): boolean {
  return (
    exception instanceof Prisma.PrismaClientKnownRequestError &&
    exception.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
  );
}

function build(
  statusCode: number,
  message: string,
  details?: unknown[],
): ErrorResponse {
  const error = HttpStatus[statusCode]?.toString() ?? 'Error';
  return {
    statusCode,
    error: error
      .toLowerCase()
      .split('_')
      .map((word) => word[0]!.toUpperCase() + word.slice(1))
      .join(' '),
    message,
    ...(details ? { details } : {}),
  };
}
