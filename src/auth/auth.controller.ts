/**
 * Auth REST surface — login + role→broker-cred fetch.
 *
 * `/auth/login` is public. `/auth/mqtt-credentials` requires a valid
 * device-api-signed JWT (JwtAuthGuard).
 */

import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { AuthService } from "./auth.service";
import { JwtAuthGuard } from "./jwt-auth.guard";
import {
  LoginRequestSchema,
  type LoginRequest,
  type LoginResponse,
  type MqttCredentialsResponse,
} from "./auth.dto";
import {
  BROKER_CRED_MAP,
  type AuthedClaims,
  type BrokerCredMap,
} from "./auth.types";

const JWT_SECRET_ENV = "AUTH_JWT_SECRET";

/** REST surface for login + role-mapped broker credential fetch. */
@ApiTags("auth")
@Controller("auth")
export class AuthController {
  /**
   * Wires AuthService + the env-loaded broker credential map.
   * @param service Auth service handling bcrypt + JWT
   * @param brokerCreds Role-keyed broker cred map loaded from secrets
   */
  constructor(
    private readonly service: AuthService,
    @Inject(BROKER_CRED_MAP) private readonly brokerCreds: BrokerCredMap,
  ) {}

  /**
   * Verify human credentials against the seeded user store, return a
   * device-api-signed session JWT.
   * @param req Login payload
   * @returns Signed token (HS256, 12h)
   */
  @Post("login")
  @ApiOperation({ summary: "Authenticate human user; returns session JWT" })
  @ApiResponse({ status: 200, description: "Signed JWT" })
  @ApiResponse({ status: 401, description: "Invalid credentials" })
  async login(
    @Body(new ZodValidationPipe(LoginRequestSchema)) req: LoginRequest,
  ): Promise<LoginResponse> {
    return this.service.login(req, requireSecret());
  }

  /**
   * Return the broker File-RBAC credential for the authenticated role.
   * HMI calls this after login to connect mqtt.js. v2 keeps this endpoint
   * intact; only the upstream JWT issuer changes.
   * @param req Express request with claims attached by JwtAuthGuard
   * @returns Broker username, password, and (optional) url
   */
  @Get("mqtt-credentials")
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Fetch role-mapped MQTT broker credential" })
  @ApiResponse({ status: 200, description: "Broker credential" })
  @ApiResponse({ status: 401, description: "Invalid or expired token" })
  @ApiResponse({ status: 403, description: "Token valid but role unknown" })
  mqttCredentials(@Req() req: Request): MqttCredentialsResponse {
    const claims = (req as Request & { user?: AuthedClaims }).user;
    if (!claims) throw new ForbiddenException();
    const cred = this.brokerCreds[claims.role];
    if (!cred) throw new ForbiddenException();
    return { ...cred, url: "" };
  }
}

/**
 * Pull HS256 secret from env at request time so missing config fails loud at
 * the call site (not at module init, where startup logs are noisy).
 * @returns The signing secret
 * @throws Error if AUTH_JWT_SECRET is unset
 */
function requireSecret(): string {
  const secret = process.env[JWT_SECRET_ENV];
  if (!secret) throw new Error(`${JWT_SECRET_ENV} is required`);
  return secret;
}
