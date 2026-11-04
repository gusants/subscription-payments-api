import type { DefaultJobOptions, JobsOptions } from 'bullmq';
import type { RedisOptions } from 'ioredis';
import { FAIL_FAST_REDIS_OPTIONS } from '../../shared/redis/app-redis-client.js';

const COMPLETED_JOBS_KEPT = 1000;
const COMPLETED_JOBS_MAX_AGE_SECONDS = 24 * 60 * 60;

export const BULLMQ_REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
  enableOfflineQueue: true,
};

export const BULLMQ_PRODUCER_REDIS_OPTIONS: RedisOptions =
  FAIL_FAST_REDIS_OPTIONS;

export const ENQUEUE_TIMEOUT_MS = 2000;

export const TECHNICAL_RETRY_ATTEMPTS = 5;
export const TECHNICAL_RETRY_BACKOFF_MS = 5000;

export const CHARGE_RETRY_JOB_OPTIONS: JobsOptions = {
  attempts: TECHNICAL_RETRY_ATTEMPTS,
  backoff: { type: 'exponential', delay: TECHNICAL_RETRY_BACKOFF_MS },
};

export const BILLING_DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  removeOnComplete: {
    count: COMPLETED_JOBS_KEPT,
    age: COMPLETED_JOBS_MAX_AGE_SECONDS,
  },
  removeOnFail: false,
};
