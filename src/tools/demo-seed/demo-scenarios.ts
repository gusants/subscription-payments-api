import type {
  PaymentMethod,
  PlanInterval,
} from '../../generated/prisma/enums.js';

export interface DemoPlanSpec {
  slug: string;
  name: string;
  amountCents: number;
  interval: PlanInterval;
}

export type DemoEnding =
  'active' | 'pastDue' | 'canceledPaymentFailed' | 'canceledCustomerRequest';

export interface DemoCustomerSpec {
  slug: string;
  name: string;
  planSlug: string;
  method: PaymentMethod;
  periodsBeforeLatest: number;
  latestPeriodDaysAgo: number;
  lateRecoveredPeriods?: readonly number[];
  reissuedPeriods?: readonly number[];
  ending: DemoEnding;
}

export const DEMO_PLANS: readonly DemoPlanSpec[] = [
  { slug: 'starter', name: 'Starter', amountCents: 1990, interval: 'monthly' },
  { slug: 'pro', name: 'Pro', amountCents: 4990, interval: 'monthly' },
  {
    slug: 'pro-annual',
    name: 'Pro Annual',
    amountCents: 49_900,
    interval: 'yearly',
  },
];

export const DEMO_CUSTOMERS: readonly DemoCustomerSpec[] = [
  {
    slug: 'ana-souza',
    name: 'Ana Souza',
    planSlug: 'starter',
    method: 'card',
    periodsBeforeLatest: 7,
    latestPeriodDaysAgo: 3,
    lateRecoveredPeriods: [2],
    ending: 'active',
  },
  {
    slug: 'bruno-lima',
    name: 'Bruno Lima',
    planSlug: 'starter',
    method: 'card',
    periodsBeforeLatest: 5,
    latestPeriodDaysAgo: 10,
    ending: 'active',
  },
  {
    slug: 'carla-dias',
    name: 'Carla Dias',
    planSlug: 'pro',
    method: 'card',
    periodsBeforeLatest: 6,
    latestPeriodDaysAgo: 15,
    lateRecoveredPeriods: [1, 4],
    ending: 'active',
  },
  {
    slug: 'diego-alves',
    name: 'Diego Alves',
    planSlug: 'pro',
    method: 'pix',
    periodsBeforeLatest: 4,
    latestPeriodDaysAgo: 5,
    reissuedPeriods: [2],
    ending: 'active',
  },
  {
    slug: 'elisa-melo',
    name: 'Elisa Melo',
    planSlug: 'starter',
    method: 'pix',
    periodsBeforeLatest: 3,
    latestPeriodDaysAgo: 20,
    ending: 'active',
  },
  {
    slug: 'fabio-reis',
    name: 'Fabio Reis',
    planSlug: 'pro',
    method: 'card',
    periodsBeforeLatest: 8,
    latestPeriodDaysAgo: 0,
    lateRecoveredPeriods: [5],
    ending: 'active',
  },
  {
    slug: 'gabi-costa',
    name: 'Gabi Costa',
    planSlug: 'pro-annual',
    method: 'card',
    periodsBeforeLatest: 1,
    latestPeriodDaysAgo: 12,
    ending: 'active',
  },
  {
    slug: 'hugo-pires',
    name: 'Hugo Pires',
    planSlug: 'pro-annual',
    method: 'card',
    periodsBeforeLatest: 0,
    latestPeriodDaysAgo: 40,
    ending: 'active',
  },
  {
    slug: 'iris-nunes',
    name: 'Iris Nunes',
    planSlug: 'starter',
    method: 'card',
    periodsBeforeLatest: 9,
    latestPeriodDaysAgo: 7,
    ending: 'active',
  },
  {
    slug: 'joao-vieira',
    name: 'Joao Vieira',
    planSlug: 'pro',
    method: 'card',
    periodsBeforeLatest: 6,
    latestPeriodDaysAgo: 1,
    lateRecoveredPeriods: [2],
    ending: 'pastDue',
  },
  {
    slug: 'kaia-ramos',
    name: 'Kaia Ramos',
    planSlug: 'starter',
    method: 'card',
    periodsBeforeLatest: 4,
    latestPeriodDaysAgo: 2,
    ending: 'pastDue',
  },
  {
    slug: 'leo-matos',
    name: 'Leo Matos',
    planSlug: 'starter',
    method: 'card',
    periodsBeforeLatest: 3,
    latestPeriodDaysAgo: 0,
    ending: 'pastDue',
  },
  {
    slug: 'marta-cruz',
    name: 'Marta Cruz',
    planSlug: 'pro',
    method: 'card',
    periodsBeforeLatest: 5,
    latestPeriodDaysAgo: 33,
    lateRecoveredPeriods: [1],
    ending: 'canceledPaymentFailed',
  },
  {
    slug: 'nina-prado',
    name: 'Nina Prado',
    planSlug: 'starter',
    method: 'card',
    periodsBeforeLatest: 2,
    latestPeriodDaysAgo: 9,
    ending: 'canceledPaymentFailed',
  },
  {
    slug: 'otavio-sa',
    name: 'Otavio Sa',
    planSlug: 'pro',
    method: 'card',
    periodsBeforeLatest: 7,
    latestPeriodDaysAgo: 52,
    ending: 'canceledPaymentFailed',
  },
  {
    slug: 'paula-gomes',
    name: 'Paula Gomes',
    planSlug: 'starter',
    method: 'card',
    periodsBeforeLatest: 3,
    latestPeriodDaysAgo: 18,
    ending: 'canceledCustomerRequest',
  },
  {
    slug: 'rui-barros',
    name: 'Rui Barros',
    planSlug: 'pro',
    method: 'card',
    periodsBeforeLatest: 10,
    latestPeriodDaysAgo: 25,
    ending: 'canceledCustomerRequest',
  },
];
