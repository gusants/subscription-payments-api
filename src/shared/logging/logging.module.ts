import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.schema.js';
import {
  LOG_DESTINATION,
  LogDestinationModule,
  type LogDestination,
} from './log-destination.js';
import { buildPinoHttpOptions } from './pino-http-options.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      imports: [LogDestinationModule],
      inject: [ConfigService, LOG_DESTINATION],
      useFactory: (
        config: ConfigService<Env, true>,
        destination: LogDestination,
      ) => {
        const options = buildPinoHttpOptions({
          nodeEnv: config.get('NODE_ENV', { infer: true }),
          level: config.get('LOG_LEVEL', { infer: true }),
        });
        return { pinoHttp: destination ? [options, destination] : options };
      },
    }),
  ],
})
export class LoggingModule {}
