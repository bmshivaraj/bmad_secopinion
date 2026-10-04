// Patients module's own DB access (AD-2) -- no other module may query these tables directly.
import { prisma } from "../../shared/prisma-client";
import type { Patient } from "./domain";

export const patientsRepository = {
  async findByMobileNumber(mobileNumber: string): Promise<Patient | null> {
    return prisma.patient.findUnique({ where: { mobileNumber } });
  },

  async findById(patientId: string): Promise<Patient | null> {
    return prisma.patient.findUnique({ where: { id: patientId } });
  },

  async findByUsername(username: string): Promise<Patient | null> {
    return prisma.patient.findUnique({ where: { username } });
  },

  async setCredentials(patientId: string, username: string, passwordHash: string): Promise<boolean> {
    const result = await prisma.patient.updateMany({
      where: { id: patientId, passwordHash: null },
      data: { username, passwordHash },
    });
    return result.count === 1;
  },

  async create(mobileNumber: string): Promise<Patient> {
    return prisma.patient.create({ data: { mobileNumber, username: null, passwordHash: null } });
  },
};
