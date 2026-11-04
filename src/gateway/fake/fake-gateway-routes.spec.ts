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

  it('is enabled in production when the flag is explicitly true', () => {
    expect(
      isFakeGatewayControllerEnabled({
        NODE_ENV: 'production',
        PAYMENT_GATEWAY: 'fake',
        FAKE_GATEWAY_ROUTES_ENABLED: 'true',
      }),
    ).toBe(true);
  });

  it('is disabled outside production when the flag is explicitly false', () => {
    expect(
      isFakeGatewayControllerEnabled({
        NODE_ENV: 'development',
        FAKE_GATEWAY_ROUTES_ENABLED: 'false',
      }),
    ).toBe(false);
  });

  it('is disabled in production even when the gateway is left at its default', () => {
    expect(isFakeGatewayControllerEnabled({ NODE_ENV: 'production' })).toBe(
      false,
    );
  });
});
