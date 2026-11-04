import type { Prisma } from '../../generated/prisma/client.js';
import { paymentInstructionsSchema } from '../../gateway/payment-instructions.js';
import type { Charge } from './charge.js';

export type ChargeRow = Prisma.ChargeGetPayload<object>;

export function toCharge(row: ChargeRow): Charge {
  return {
    ...row,
    paymentInstructions:
      row.paymentInstructions === null
        ? null
        : paymentInstructionsSchema.parse(row.paymentInstructions),
  };
}
