import { Module } from '@nestjs/common';
import type { DestinationStream } from 'pino';

export const LOG_DESTINATION = Symbol('LOG_DESTINATION');

export type LogDestination = DestinationStream | undefined;

@Module({
  providers: [{ provide: LOG_DESTINATION, useValue: undefined }],
  exports: [LOG_DESTINATION],
})
export class LogDestinationModule {}
