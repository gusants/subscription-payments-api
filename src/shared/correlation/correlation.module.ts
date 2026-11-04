import {
  Module,
  RequestMethod,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { CorrelationIdMiddleware } from './correlation-id.middleware.js';

const EVERY_ROUTE = { path: '{/*splat}', method: RequestMethod.ALL };

@Module({})
export class CorrelationModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes(EVERY_ROUTE);
  }
}
