import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';
import { AppConfigModule } from './shared/config/app-config.module.js';
import { DatabaseModule } from './shared/database/database.module.js';
import { RedisModule } from './shared/redis/redis.module.js';

@Module({
  imports: [AppConfigModule, DatabaseModule, RedisModule, HealthModule],
})
export class AppModule {}
