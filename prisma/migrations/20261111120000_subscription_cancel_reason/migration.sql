-- CreateEnum
CREATE TYPE "cancel_reason" AS ENUM ('payment_failed', 'customer_request', 'initial_payment_expired');

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "cancel_reason" "cancel_reason";
