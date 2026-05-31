/**
 * Bearer-token guard. v1 verifies HS256 with shared secret. v2 swaps the
 * inner verify for Keycloak JWKS without changing this file's exports.
 */

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import type { Request } from "express";
import { Role, type AuthedClaims } from "./auth.types";

const JWT_SECRET_ENV = "AUTH_JWT_SECRET";

/** Bearer-token guard: HS256 verify + role-claim sanity check. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  /**
   * Wires @nestjs/jwt verifier.
   * @param jwt JwtService instance (HS256 in v1, JWKS in v2)
   */
  constructor(private readonly jwt: JwtService) {}

  /**
   * Validate the bearer token, attach decoded claims to request.user, return true.
   * @param ctx Nest execution context
   * @returns true when the token is valid and the role is recognized
   * @throws UnauthorizedException on missing/invalid/expired/unknown-role token
   */
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = extractBearer(req);
    if (!token) throw new UnauthorizedException();
    const secret = process.env[JWT_SECRET_ENV];
    if (!secret) throw new Error(`${JWT_SECRET_ENV} is required`);
    let claims: AuthedClaims;
    try {
      claims = this.jwt.verify<AuthedClaims>(token, { secret });
    } catch {
      throw new UnauthorizedException();
    }
    if (!Role.safeParse(claims.role).success) {
      throw new UnauthorizedException();
    }
    (req as Request & { user?: AuthedClaims }).user = claims;
    return true;
  }
}

/**
 * Pull the bearer token out of the Authorization header.
 * @param req Express request
 * @returns The token string, or null if header is missing/malformed
 */
function extractBearer(req: Request): string | null {
  const header = req.headers["authorization"];
  if (!header || !header.toLowerCase().startsWith("bearer ")) return null;
  return header.slice(7).trim() || null;
}
