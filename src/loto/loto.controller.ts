import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import type { Request } from "express";
import { LotoService } from "./loto.service";
import {
  SetLockRequestSchema,
  type ActiveLocksResponse,
  type LockResponse,
  type SetLockRequest,
} from "./loto.dto";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { OperatorGuard } from "../auth/operator.guard";
import type { AuthedClaims } from "../auth/auth.types";

/**
 * REST surface for lockout/tagout. Reads are open, like `/asyncapi` and
 * `/topology/view` — the gateway holds no device-api credential and must read
 * this at boot. Writes take an operator token.
 */
@ApiTags("loto")
@Controller()
export class LotoController {
  /**
   * Wires the LOTO service.
   * @param service Lock state and beacon
   */
  constructor(private readonly service: LotoService) {}

  /**
   * Active locks and the expanded set of devices they inhibit.
   * @returns `{ locks, locked_devices }`
   */
  @Get("loto")
  @ApiOperation({ summary: "Active locks + every device they inhibit" })
  @ApiResponse({ status: 200 })
  active(): Promise<ActiveLocksResponse> {
    return this.service.active();
  }

  /**
   * Every lock row ever written for one device, newest first.
   * @param deviceId DTM device_id (required)
   * @returns Rows newest first
   */
  @Get("loto/history")
  @ApiOperation({ summary: "Lock history for one device, newest first" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 400, description: "device_id missing" })
  history(@Query("device_id") deviceId?: string): Promise<LockResponse[]> {
    const id = deviceId?.trim();
    if (!id) throw new BadRequestException("device_id is required");
    return this.service.history(id);
  }

  /**
   * Lock a device under the caller's name.
   * @param deviceId DTM device_id
   * @param body holder_name (required), permit_ref (optional)
   * @param req Express request with claims attached by JwtAuthGuard
   * @returns The new lock row
   */
  @Post("devices/:device_id/loto")
  @UseGuards(JwtAuthGuard, OperatorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Set a lock (operator)" })
  @ApiResponse({ status: 201, description: "Lock set" })
  @ApiResponse({ status: 400, description: "holder_name blank or too long" })
  @ApiResponse({ status: 401, description: "No valid token" })
  @ApiResponse({ status: 403, description: "Not an operator" })
  @ApiResponse({ status: 404, description: "Device not in the DTM" })
  @ApiResponse({ status: 409, description: "Holder already locks this device" })
  set(
    @Param("device_id") deviceId: string,
    @Body(new ZodValidationPipe(SetLockRequestSchema)) body: SetLockRequest,
    @Req() req: Request,
  ): Promise<LockResponse> {
    return this.service.set(deviceId, body, claims(req).role);
  }

  /**
   * Clear one lock. Other people's locks on the same device stay.
   * @param id Lock id
   * @param req Express request with claims attached by JwtAuthGuard
   * @returns The cleared row
   */
  @Delete("loto/:id")
  @UseGuards(JwtAuthGuard, OperatorGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Clear a lock (operator)" })
  @ApiResponse({ status: 200, description: "Lock cleared" })
  @ApiResponse({ status: 401, description: "No valid token" })
  @ApiResponse({ status: 403, description: "Not an operator" })
  @ApiResponse({ status: 404, description: "No such lock" })
  @ApiResponse({ status: 409, description: "Already cleared" })
  clear(
    @Param("id", ParseIntPipe) id: number,
    @Req() req: Request,
  ): Promise<LockResponse> {
    return this.service.clear(id, claims(req).role);
  }
}

/**
 * Claims JwtAuthGuard attached; the guard chain guarantees presence.
 * @param req Express request
 * @returns Decoded token claims
 */
function claims(req: Request): AuthedClaims {
  return (req as Request & { user: AuthedClaims }).user;
}
