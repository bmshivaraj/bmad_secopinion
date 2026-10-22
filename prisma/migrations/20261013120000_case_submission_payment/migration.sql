ALTER TYPE "case_status" ADD VALUE 'Submitted';
ALTER TYPE "case_status" ADD VALUE 'UnderReview';
ALTER TYPE "case_status" ADD VALUE 'MoreInfoRequested';
ALTER TYPE "case_status" ADD VALUE 'OpinionGiven';
ALTER TYPE "case_status" ADD VALUE 'Closed';
ALTER TYPE "case_status" ADD VALUE 'RefundPending';
ALTER TYPE "case_status" ADD VALUE 'Refunded';

CREATE TYPE "urgency_tier" AS ENUM ('Standard', 'Urgent');
CREATE TYPE "payment_attempt_status" AS ENUM ('Pending', 'Failed', 'Succeeded');

ALTER TABLE "cases"
ADD COLUMN "urgency_tier" "urgency_tier",
ADD COLUMN "charged_amount" DECIMAL(10,2),
ADD COLUMN "doctor_id" TEXT;

CREATE TABLE "payment_attempts" (
    "id" TEXT NOT NULL,
    "case_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "urgency_tier" "urgency_tier" NOT NULL,
    "charged_amount" DECIMAL(10,2) NOT NULL,
    "selected_doctor_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "transaction_id" TEXT,
    "status" "payment_attempt_status" NOT NULL DEFAULT 'Pending',
    "provider_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_attempts_case_id_key" ON "payment_attempts"("case_id");
CREATE UNIQUE INDEX "payment_attempts_idempotency_key_key" ON "payment_attempts"("idempotency_key");