import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';

@Catch(ServiceUnavailableException)
export class HealthCheckExceptionFilter implements ExceptionFilter {
  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: ServiceUnavailableException, host: ArgumentsHost): void {
    this.httpAdapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      exception.getResponse(),
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
