import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { APP_OPTIONS } from './shared/http/app-options.js';
import { setupSwagger } from './shared/http/setup-swagger.js';
import type { Env } from './shared/config/env.schema.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    ...APP_OPTIONS,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  setupSwagger(app);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();
