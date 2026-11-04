import { Global, Module, type DynamicModule } from '@nestjs/common';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsModule } from '../modules/subscriptions/subscriptions.module.js';
import type { Env } from '../shared/config/env.schema.js';
import { FakeExpirationSweeper } from './fake/fake-expiration-sweeper.js';
import {
  FAKE_CHARGE_EXPIRATION,
  FAKE_EXPIRATION_SWEEP,
  FAKE_WEBHOOK_OPTIONS,
  type FakeChargeExpiration,
  type FakeExpirationSweep,
  type FakeWebhookOptions,
} from './fake/fake-gateway-options.js';
import { FakeGatewaySimulator } from './fake/fake-gateway.simulator.js';
import { DelayScheduler } from './fake/webhook/delay-scheduler.js';
import { FakeWebhookDispatcher } from './fake/webhook/fake-webhook.dispatcher.js';
import { FetchWebhookTransport } from './fake/webhook/fetch-webhook-transport.js';
import { MathRandomSource } from './fake/webhook/math-random-source.js';
import { RandomSource } from './fake/webhook/random-source.js';
import { TimerDelayScheduler } from './fake/webhook/timer-delay-scheduler.js';
import { WebhookTransport } from './fake/webhook/webhook-transport.js';
import { FakeGatewayController } from './fake/fake-gateway.controller.js';
import { isFakeGatewayControllerEnabled } from './fake/fake-gateway-routes.js';
import { FakeGatewayAdapter } from './fake/fake-gateway.adapter.js';
import { FakeGatewayStore } from './fake/fake-gateway.store.js';
import { PaymentGateway } from './payment-gateway.port.js';

const MILLISECONDS_PER_SECOND = 1000;

@Global()
@Module({
  providers: [
    {
      provide: FakeGatewayStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new FakeGatewayStore(
          resolve(config.get('FAKE_GATEWAY_DATA_FILE', { infer: true })),
        ),
    },
    FakeGatewayAdapter,
    FakeGatewaySimulator,
    FakeExpirationSweeper,
    FakeWebhookDispatcher,
    { provide: WebhookTransport, useClass: FetchWebhookTransport },
    { provide: RandomSource, useClass: MathRandomSource },
    { provide: DelayScheduler, useClass: TimerDelayScheduler },
    {
      provide: FAKE_WEBHOOK_OPTIONS,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): FakeWebhookOptions => ({
        enabled: config.get('FAKE_GATEWAY_WEBHOOK_DISPATCH_ENABLED', {
          infer: true,
        }),
        url:
          config.get('FAKE_GATEWAY_WEBHOOK_URL', { infer: true }) ??
          `http://localhost:${config.get('PORT', { infer: true })}/webhooks/gateway`,
        secret: config.get('GATEWAY_WEBHOOK_SECRET', { infer: true }),
        delayMs: config.get('FAKE_GATEWAY_WEBHOOK_DELAY_MS', { infer: true }),
        duplicateRate: config.get('FAKE_GATEWAY_DUPLICATE_WEBHOOK_RATE', {
          infer: true,
        }),
      }),
    },
    {
      provide: FAKE_CHARGE_EXPIRATION,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): FakeChargeExpiration => ({
        pixMs:
          config.get('FAKE_GATEWAY_PIX_EXPIRATION_SECONDS', { infer: true }) *
          MILLISECONDS_PER_SECOND,
        boletoMs:
          config.get('FAKE_GATEWAY_BOLETO_EXPIRATION_SECONDS', {
            infer: true,
          }) * MILLISECONDS_PER_SECOND,
      }),
    },
    {
      provide: FAKE_EXPIRATION_SWEEP,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): FakeExpirationSweep => ({
        intervalMs: config.get('FAKE_GATEWAY_EXPIRATION_SWEEP_INTERVAL_MS', {
          infer: true,
        }),
      }),
    },
    {
      provide: PaymentGateway,
      inject: [ConfigService, FakeGatewayAdapter],
      useFactory: (
        config: ConfigService<Env, true>,
        fake: FakeGatewayAdapter,
      ): PaymentGateway => {
        const adapters: Record<Env['PAYMENT_GATEWAY'], PaymentGateway> = {
          fake,
        };
        return adapters[config.get('PAYMENT_GATEWAY', { infer: true })];
      },
    },
  ],
  exports: [PaymentGateway, FakeGatewayStore],
})
export class GatewayModule {
  static register(env: Record<string, unknown> = process.env): DynamicModule {
    return {
      module: GatewayModule,
      ...(isFakeGatewayControllerEnabled(env) && {
        imports: [SubscriptionsModule],
        controllers: [FakeGatewayController],
      }),
    };
  }
}
