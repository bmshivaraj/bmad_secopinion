ALTER TABLE "cases"
ADD COLUMN "specialty_id" TEXT,
ADD COLUMN "submitted_at" TIMESTAMP(3),
ADD COLUMN "sla_pause_history" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN "assignment_lock_version" INTEGER NOT NULL DEFAULT 0;

UPDATE "cases"
SET "submitted_at" = "updated_at"
WHERE "status" <> 'Draft' AND "submitted_at" IS NULL;

CREATE INDEX "cases_specialty_id_status_urgency_tier_submitted_at_idx"
ON "cases"("specialty_id", "status", "urgency_tier", "submitted_at");

CREATE INDEX "cases_doctor_id_status_idx"
ON "cases"("doctor_id", "status");