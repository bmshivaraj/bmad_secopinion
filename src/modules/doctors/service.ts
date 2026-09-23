// Doctors module's public service interface (AD-2 seam). Doctors is a leaf
// module -- it never calls Cases, Payments, or Admin. Other modules may only
// read Doctors data through functions exported from this file, never by
// importing repository.ts or domain/ directly. Implemented starting Epic 2.
export const doctorsService = {};
