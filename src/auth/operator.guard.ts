/**
 * Role guard for write routes. Runs after JwtAuthGuard, which attached the
 * claims; a viewer token is valid but may not change anything.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import type { AuthedClaims } from "./auth.types";

/** Allows the request through only when the token's role is `operator`. */
@Injectable()
export class OperatorGuard implements CanActivate {
  /**
   * Check the role claim JwtAuthGuard attached to the request.
   * @param ctx Nest execution context
   * @returns true for an operator
   * @throws ForbiddenException for any other role, or no claims at all
   */
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { user?: AuthedClaims }>();
    if (req.user?.role !== "operator") {
      throw new ForbiddenException("operator role required");
    }
    return true;
  }
}
