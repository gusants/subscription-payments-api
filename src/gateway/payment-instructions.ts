import { z } from 'zod';

export const paymentInstructionsSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('pix'),
    copyPaste: z.string(),
  }),
  z.object({
    type: z.literal('boleto'),
    digitableLine: z.string(),
    barcode: z.string().optional(),
  }),
]);

export type PaymentInstructions = z.infer<typeof paymentInstructionsSchema>;
