import { Module } from '@nestjs/common';
import { GatewayModule } from './gateway/gateway.module.js';
import { BillingQueueModule } from './modules/billing-queue/billing-queue.module.js';
import { BillingWorkersModule } from './modules/billing-queue/processors/billing-workers.module.js';
import { ChargesModule } from './modules/charges/charges.module.js';
import { CustomerSummaryModule } from './modules/customer-summary/customer-summary.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PlansModule } from './modules/plans/plans.module.js';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { LlmModule } from './llm/llm.module.js';
import { ClockModule } from './shared/clock/clock.module.js';
import { AppConfigModule } from './shared/config/app-config.module.js';
import { DatabaseModule } from './shared/database/database.module.js';
import { IdempotencyModule } from './shared/idempotency/idempotency.module.js';
import { HttpModule } from './shared/http/http.module.js';
import { LoggingModule } from './shared/logging/logging.module.js';
import { CorrelationModule } from './shared/correlation/correlation.module.js';
import { RedisModule } from './shared/redis/redis.module.js';
import { TracingModule } from './shared/tracing/tracing.module.js';

@Module({
  imports: [
    AppConfigModule,
    ClockModule,
    LoggingModule,
    CorrelationModule,
    TracingModule,
    DatabaseModule,
    RedisModule,
    IdempotencyModule,
    GatewayModule.register(),
    HttpModule,
    HealthModule,
    PlansModule,
    CustomersModule,
    LlmModule,
    CustomerSummaryModule,
    ChargesModule,
    SubscriptionsModule,
    WebhooksModule,
    BillingQueueModule.register(),
    BillingWorkersModule.register(),
  ],
})
export class AppModule {}
