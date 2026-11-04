import { createHash } from 'node:crypto';
import type { PaymentInstructions } from '../payment-instructions.js';

const DIGITABLE_LINE_DIGITS = 47;
const BARCODE_DIGITS = 44;

function digitsFrom(seed: string, length: number): string {
  const hash = createHash('sha256').update(seed).digest('hex');
  return BigInt(`0x${hash}`).toString().padStart(length, '0').slice(0, length);
}

function formatDigitableLine(digits: string): string {
  return [
    `${digits.slice(0, 5)}.${digits.slice(5, 10)}`,
    `${digits.slice(10, 15)}.${digits.slice(15, 21)}`,
    `${digits.slice(21, 26)}.${digits.slice(26, 32)}`,
    digits.slice(32, 33),
    digits.slice(33),
  ].join(' ');
}

export function pixInstructions(gatewayChargeId: string): PaymentInstructions {
  return {
    type: 'pix',
    copyPaste: `00020126fake.gateway.pix/${gatewayChargeId}5204000053039865802BR`,
  };
}

export function boletoInstructions(
  gatewayChargeId: string,
): PaymentInstructions {
  return {
    type: 'boleto',
    digitableLine: formatDigitableLine(
      digitsFrom(`${gatewayChargeId}:line`, DIGITABLE_LINE_DIGITS),
    ),
    barcode: digitsFrom(`${gatewayChargeId}:barcode`, BARCODE_DIGITS),
  };
}
