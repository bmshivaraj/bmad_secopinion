// Patients module's public service interface (AD-2 seam). Patients is a leaf
// module -- it never calls Cases, Payments, or Admin. Other modules may only
// read Patients data through functions exported from this file, never by
// importing repository.ts or domain/ directly. Implemented starting Story 1.2.
export const patientsService = {};
