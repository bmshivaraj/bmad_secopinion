ALTER TABLE "patients" ADD COLUMN "username" TEXT;

CREATE UNIQUE INDEX "patients_username_key" ON "patients"("username");