import jwt from "jsonwebtoken";

export type Role = "patient" | "doctor" | "admin";

/**
 * JWT auth-context shape (AD-7, AD-9): every session token carries exactly
 * these two claims. Role-based access is resolved at the route-handler
 * boundary, not inside module business logic.
 */
export interface AuthContext {
  userId: string;
  role: Role;
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET environment variable is not set");
  }
  return secret;
}

export function signAuthToken(context: AuthContext, expiresIn: jwt.SignOptions["expiresIn"] = "7d"): string {
  return jwt.sign(context, getJwtSecret(), { expiresIn });
}

export function verifyAuthToken(token: string): AuthContext {
  const payload = jwt.verify(token, getJwtSecret());

  if (typeof payload === "string" || typeof payload.userId !== "string" || typeof payload.role !== "string") {
    throw new Error("Invalid auth token payload");
  }

  return { userId: payload.userId, role: payload.role as Role };
}
