import { Logger } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  paymentInstructionsSchema,
  type PaymentInstructions,
} from '../../gateway/payment-instructions.js';
import type { Charge } from './charge.js';

export type ChargeRow = Prisma.ChargeGetPayload<object>;

const logger = new Logger('PrismaChargeMapper');

function toPaymentInstructions(row: ChargeRow): PaymentInstructions | null {
  if (row.paymentInstructions === null) return null;
  const parsed = paymentInstructionsSchema.safeParse(row.paymentInstructions);
  if (!parsed.success) {
    logger.error(
      `Charge ${row.id} has stored payment instructions of an unknown shape; exposing none`,
      parsed.error.message,
    );
    return null;
  }
  return parsed.data;
}

export function toCharge(row: ChargeRow): Charge {
  return { ...row, paymentInstructions: toPaymentInstructions(row) };
}
