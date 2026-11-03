import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const identifiers = {
  customerId: z.string().trim().min(1),
  planId: z.string().trim().min(1),
};

const cardSubscriptionSchema = z.object({
  ...identifiers,
  paymentMethod: z.literal('card'),
  cardToken: z.string().trim().min(1).max(255).meta({
    description:
      'Gateway card token, charged immediately for the first period. Never returned by the API',
  }),
});

const invoiceSubscriptionSchema = z
  .object({
    ...identifiers,
    paymentMethod: z.enum(['pix', 'boleto']),
  })
  .meta({
    description:
      'Pix and boleto create the subscription as incomplete without a charge; any cardToken sent is ignored',
  });

export const createSubscriptionSchema = z.discriminatedUnion('paymentMethod', [
  cardSubscriptionSchema,
  invoiceSubscriptionSchema,
]);

export type CreateSubscriptionBody = z.infer<typeof createSubscriptionSchema>;

export const CreateSubscriptionDto = Object.defineProperty(
  createZodDto(createSubscriptionSchema),
  'name',
  { value: 'CreateSubscriptionDto' },
);
