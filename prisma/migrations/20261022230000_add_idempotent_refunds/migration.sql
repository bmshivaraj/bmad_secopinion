CREATE TYPE "payment_refund_status" AS ENUM ('Pending', 'Failed', 'Uncertain', 'Succeeded');

ALTER TABLE "payment_attempts"
ADD COLUMN "refund_idempotency_key" TEXT,
ADD COLUMN "refund_status" "payment_refund_status",
ADD COLUMN "refund_transaction_id" TEXT,
ADD COLUMN "refund_provider_error" TEXT;

CREATE UNIQUE INDEX "payment_attempts_refund_idempotency_key_key"
ON "payment_attempts"("refund_idempotency_key");

CREATE TYPE "case_refund_decision" AS ENUM ('Approving', 'Rejected', 'Approved');

ALTER TABLE "cases"
ADD COLUMN "refund_decision" "case_refund_decision",
ADD COLUMN "refund_confirmed_at" TIMESTAMP(3);