import { Global, Module, type DynamicModule } from '@nestjs/common';
import { resolve } from 'node:path';
import { ConfigService } from '@nestjs/config';
import { Clock, SystemClock } from '../shared/clock/index.js';
import type { Env } from '../shared/config/env.schema.js';
import { FakeGatewayController } from './fake/fake-gateway.controller.js';
import { isFakeGatewayControllerEnabled } from './fake/fake-gateway-routes.js';
import { FakeGatewayAdapter } from './fake/fake-gateway.adapter.js';
import { FakeGatewayStore } from './fake/fake-gateway.store.js';
import { PaymentGateway } from './payment-gateway.port.js';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    {
      provide: FakeGatewayStore,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        new FakeGatewayStore(
          resolve(config.get('FAKE_GATEWAY_DATA_FILE', { infer: true })),
        ),
    },
    FakeGatewayAdapter,
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
      controllers: isFakeGatewayControllerEnabled(env)
        ? [FakeGatewayController]
        : [],
    };
  }
}
