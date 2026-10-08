ALTER TABLE "specialties" ADD COLUMN "normalized_name" TEXT;

UPDATE "specialties"
SET "normalized_name" = LOWER(BTRIM("name"));

ALTER TABLE "specialties" ALTER COLUMN "normalized_name" SET NOT NULL;

CREATE UNIQUE INDEX "specialties_normalized_name_key" ON "specialties"("normalized_name");