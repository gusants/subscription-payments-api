export const ID_PREFIXES = {
  plan: 'plan_',
  customer: 'cus_',
  subscription: 'sub_',
  charge: 'ch_',
  paymentAttempt: 'pa_',
  gatewayCustomer: 'gcus_',
  gatewayCharge: 'gch_',
  gatewayEvent: 'evt_',
  webhookEvent: 'whe_',
  correlation: 'cor_',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];
