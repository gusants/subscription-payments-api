import { ID_PREFIXES } from '../../shared/ids/index.js';

const SEED_MARKER = 'seed_';

const seedId = (prefix: string, ...parts: (string | number)[]): string =>
  `${prefix}${SEED_MARKER}${parts.join('_')}`;

export const SEED_ID_PREFIXES = {
  plan: `${ID_PREFIXES.plan}${SEED_MARKER}`,
  customer: `${ID_PREFIXES.customer}${SEED_MARKER}`,
  subscription: `${ID_PREFIXES.subscription}${SEED_MARKER}`,
} as const;

export const seedIds = {
  plan: (slug: string) => seedId(ID_PREFIXES.plan, slug),
  customer: (slug: string) => seedId(ID_PREFIXES.customer, slug),
  gatewayCustomer: (slug: string) => seedId(ID_PREFIXES.gatewayCustomer, slug),
  subscription: (slug: string) => seedId(ID_PREFIXES.subscription, slug),
  charge: (slug: string, period: number, issue: number) =>
    seedId(ID_PREFIXES.charge, slug, period, issue),
  gatewayCharge: (slug: string, period: number, issue: number) =>
    seedId(ID_PREFIXES.gatewayCharge, slug, period, issue),
  attempt: (slug: string, period: number, issue: number, attempt: number) =>
    seedId(ID_PREFIXES.paymentAttempt, slug, period, issue, attempt),
  attemptGatewayCharge: (
    slug: string,
    period: number,
    issue: number,
    attempt: number,
  ) => seedId(ID_PREFIXES.gatewayCharge, slug, period, issue, 'a', attempt),
  correlation: (slug: string, period: number) =>
    seedId(ID_PREFIXES.correlation, slug, period),
};
