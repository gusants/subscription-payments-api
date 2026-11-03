import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { AppConfigModule } from './shared/config/app-config.module.js';
import { DatabaseModule } from './shared/database/database.module.js';
import { HttpModule } from './shared/http/http.module.js';
import { LoggingModule } from './shared/logging/logging.module.js';
import { RedisModule } from './shared/redis/redis.module.js';

@Module({
  imports: [
    AppConfigModule,
    LoggingModule,
    DatabaseModule,
    RedisModule,
    HttpModule,
    HealthModule,
  ],
})
export class AppModule {}
