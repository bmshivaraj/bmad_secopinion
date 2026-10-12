-- Store an optional Doctor preference privately on the draft without a cross-module foreign key.
ALTER TABLE "cases" ADD COLUMN "selected_doctor_id" TEXT;