/**
 * Auth role taxonomy + token claim shape.
 *
 * v1 has two roles seeded at deploy time (no registration). v2 (Keycloak)
 * replaces the User Store + login flow but keeps the claim shape so the
 * mqtt-credentials guard is untouched.
 */

import { z } from "zod";

export const Role = z.enum(["operator", "viewer"]);
export type RoleType = z.infer<typeof Role>;

/** Decoded JWT claims attached to the request by JwtAuthGuard. */
export interface AuthedClaims {
  sub: string;
  role: RoleType;
  iat: number;
  exp: number;
}

/** Role-keyed bcrypt-hash map injected into AuthService for login verification. */
export type UserStore = Partial<Record<RoleType, string>>;

/** DI tokens. */
export const USER_STORE = "AUTH_USER_STORE";
export const BROKER_CRED_MAP = "AUTH_BROKER_CRED_MAP";

/** Per-role broker credential returned by /auth/mqtt-credentials. */
export interface BrokerCred {
  username: string;
  password: string;
}
export type BrokerCredMap = Record<RoleType, BrokerCred>;
