// Patients module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type { Patient } from "./domain";

export const patientsRepository = {
  async findByMobileNumber(mobileNumber: string): Promise<Patient | null> {
    return prisma.patient.findUnique({ where: { mobileNumber } });
  },

  async create(mobileNumber: string): Promise<Patient> {
    return prisma.patient.create({ data: { mobileNumber, passwordHash: null } });
  },
};
