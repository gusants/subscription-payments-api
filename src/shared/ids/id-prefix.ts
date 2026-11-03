export const ID_PREFIXES = {
  plan: 'plan_',
  customer: 'cus_',
  subscription: 'sub_',
  gatewayCustomer: 'gcus_',
  gatewayCharge: 'gch_',
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];
