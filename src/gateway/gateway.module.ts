import { Global, Module, type DynamicModule } from '@nestjs/common';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { SubscriptionsModule } from '../modules/subscriptions/subscriptions.module.js';
import type { Env } from '../shared/config/env.schema.js';
import { FakeExpirationSweeper } from './fake/fake-expiration-sweeper.js';
import {
  FAKE_CHARGE_EXPIRATION,
  FAKE_EXPIRATION_SWEEP,
  type FakeChargeExpiration,
  type FakeExpirationSweep,
} from './fake/fake-gateway-options.js';
import { FakeGatewaySimulator } from './fake/fake-gateway.simulator.js';
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
