import { Module } from '@nestjs/common';
import { CustomersModule } from './modules/customers/customers.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PlansModule } from './modules/plans/plans.module.js';
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
    PlansModule,
    CustomersModule,
  ],
})
export class AppModule {}
