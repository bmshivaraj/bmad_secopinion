CREATE TYPE "guardian_relationship" AS ENUM ('parent', 'legal_guardian', 'other_authorized_guardian');

ALTER TABLE "patients"
ADD COLUMN "is_minor" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "is_guardian_registered" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "minor_name" TEXT,
ADD COLUMN "guardian_relationship" "guardian_relationship";