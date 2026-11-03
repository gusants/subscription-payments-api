import { isFakeGatewayControllerEnabled } from './fake-gateway-routes.js';

describe('isFakeGatewayControllerEnabled', () => {
  it.each(['development', 'test'])('is enabled in %s', (NODE_ENV) => {
    expect(
      isFakeGatewayControllerEnabled({ NODE_ENV, PAYMENT_GATEWAY: 'fake' }),
    ).toBe(true);
  });

  it('is enabled by default, as the defaults are development and fake', () => {
    expect(isFakeGatewayControllerEnabled({})).toBe(true);
  });

  it('is disabled in production', () => {
    expect(
      isFakeGatewayControllerEnabled({
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'fake',
      }),
    ).toBe(false);
  });

  it('is disabled in production even when the gateway is left at its default', () => {
    expect(isFakeGatewayControllerEnabled({ NODE_ENV: 'production' })).toBe(
      false,
    );
  });
});
