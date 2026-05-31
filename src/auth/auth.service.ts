/**
 * Auth service — bcrypt password verification + HS256 JWT signing.
 *
 * v1 user store is two-entry Partial<Record<role, bcryptHash>> seeded from
 * env at module init. v2 (Keycloak) removes this service entirely; the JWT
 * verify path on the guard swaps HS256→JWKS at the JwtModule registration.
 */

import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as bcrypt from "bcrypt";
import {
  Role,
  USER_STORE,
  type AuthedClaims,
  type RoleType,
  type UserStore,
} from "./auth.types";
import type { LoginRequest, LoginResponse } from "./auth.dto";

const TOKEN_TTL_SECONDS = 12 * 60 * 60;

/** Verifies human passwords against the seeded store and signs HS256 JWTs. */
@Injectable()
export class AuthService {
  /**
   * Wires the env-loaded user store and the @nestjs/jwt service.
   * @param store Role-keyed bcrypt-hash map
   * @param jwt @nestjs/jwt service (HS256 in v1)
   */
  constructor(
    @Inject(USER_STORE) private readonly store: UserStore,
    private readonly jwt: JwtService,
  ) {}

  /**
   * Verify username/password against the seeded user store, return a signed JWT.
   * Generic UnauthorizedException for any failure mode — never leak which field.
   * @param req Login payload
   * @param secret HS256 signing secret (passed by caller so config + auth are decoupled)
   * @returns Signed JWT response
   */
  async login(req: LoginRequest, secret: string): Promise<LoginResponse> {
    const parsedRole = Role.safeParse(req.username);
    if (!parsedRole.success) throw new UnauthorizedException();
    const role = parsedRole.data;
    const hash = this.store[role];
    if (!hash) throw new UnauthorizedException();
    const ok = await bcrypt.compare(req.password, hash);
    if (!ok) throw new UnauthorizedException();
    const token = this.signToken(role, secret);
    return { token };
  }

  /**
   * Sign HS256 JWT with role claim. Centralized so the guard, login flow, and
   * future test fixtures all share one TTL + claim contract.
   * @param role The role to bake into the token
   * @param secret HS256 signing secret
   * @returns Compact JWT string
   */
  signToken(role: RoleType, secret: string): string {
    const claims: Omit<AuthedClaims, "iat" | "exp"> = {
      sub: role,
      role,
    };
    return this.jwt.sign(claims, {
      secret,
      expiresIn: TOKEN_TTL_SECONDS,
    });
  }
}
