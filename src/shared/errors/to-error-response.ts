import { HttpException, HttpStatus } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import {
  isPrismaError,
  PRISMA_FOREIGN_KEY_VIOLATION,
  PRISMA_UNIQUE_CONSTRAINT_VIOLATION,
} from '../database/prisma-error-codes.js';
import { ConflictError } from './conflict.error.js';
import type { ErrorResponse } from './error-response.js';
import { NotFoundError } from './not-found.error.js';
import { ServiceUnavailableError } from './service-unavailable.error.js';
import { UnprocessableError } from './unprocessable.error.js';

export function toErrorResponse(exception: unknown): ErrorResponse {
  if (exception instanceof ZodValidationException) {
    return fromValidation(exception);
  }
  if (exception instanceof HttpException) {
    return fromHttpException(exception);
  }
  if (exception instanceof NotFoundError) {
    return build(HttpStatus.NOT_FOUND, exception.message);
  }
  if (exception instanceof ConflictError) {
    return build(HttpStatus.CONFLICT, exception.message);
  }
  if (exception instanceof UnprocessableError) {
    return build(HttpStatus.UNPROCESSABLE_ENTITY, exception.message);
  }
  if (exception instanceof ServiceUnavailableError) {
    return build(HttpStatus.SERVICE_UNAVAILABLE, exception.message);
  }
  if (isPrismaError(exception, PRISMA_UNIQUE_CONSTRAINT_VIOLATION)) {
    return build(HttpStatus.CONFLICT, 'Resource already exists');
  }
  if (isPrismaError(exception, PRISMA_FOREIGN_KEY_VIOLATION)) {
    return build(HttpStatus.NOT_FOUND, 'Referenced resource not found');
  }
  return build(HttpStatus.INTERNAL_SERVER_ERROR, 'Internal server error');
}

function fromValidation(exception: ZodValidationException): ErrorResponse {
  const zodError = exception.getZodError();
  const details = zodError instanceof ZodError ? zodError.issues : undefined;
  return build(HttpStatus.BAD_REQUEST, 'Validation failed', details);
}

function fromHttpException(exception: HttpException): ErrorResponse {
  const status = exception.getStatus();
  const response = exception.getResponse();
  const message =
    typeof response === 'string' ? response : messageOf(response, exception);
  return build(status, message);
}

function messageOf(response: object, exception: HttpException): string {
  const message = 'message' in response ? response.message : undefined;
  if (Array.isArray(message)) {
    return message.join('; ');
  }
  return typeof message === 'string' ? message : exception.message;
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
