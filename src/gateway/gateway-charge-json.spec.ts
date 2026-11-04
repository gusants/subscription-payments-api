import {
  gatewayChargeJsonSchema,
  toGatewayChargeJson,
} from './gateway-charge-json.js';
import type { GatewayCharge } from './payment-gateway.port.js';

const card: GatewayCharge = {
  id: 'gch_1',
  customerId: 'gcus_1',
  externalRef: 'ch_1',
  amountCents: 1990,
  method: 'card',
  status: 'paid',
  createdAt: new Date('2026-01-31T10:30:00.000Z'),
};

describe('toGatewayChargeJson', () => {
  it('serializes dates as ISO strings and omits absent optionals', () => {
    expect(toGatewayChargeJson(card)).toEqual({
      ...card,
      createdAt: '2026-01-31T10:30:00.000Z',
    });
  });

  it('keeps the expiry and the payment instructions of a pending pix', () => {
    const pix: GatewayCharge = {
      ...card,
      method: 'pix',
      status: 'pending',
      expiresAt: new Date('2026-01-31T11:00:00.000Z'),
      paymentInstructions: { type: 'pix', copyPaste: '000201' },
    };

    const json = toGatewayChargeJson(pix);

    expect(json).toMatchObject({
      expiresAt: '2026-01-31T11:00:00.000Z',
      paymentInstructions: { type: 'pix', copyPaste: '000201' },
    });
    expect(gatewayChargeJsonSchema.parse(json)).toEqual(json);
  });
});
