import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

process.env['WORKERS_ENABLED'] = 'true';

async function bootstrap() {
  const { AppModule } = await import('./app.module.js');
  const context = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  context.useLogger(context.get(Logger));
  context.enableShutdownHooks();
}
await bootstrap();
