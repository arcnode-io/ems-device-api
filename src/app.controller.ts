import { Controller, Get, Res } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import type { Response } from "express";
import axios from "axios";

/**
 * Main application controller handling root-level routes.
 */
@ApiTags("app")
@Controller()
export class AppController {
  /**
   * Health check endpoint for monitoring service availability.
   * @returns A health status response
   */
  @Get()
  @ApiOperation({ summary: "Health Check" })
  @ApiResponse({ status: 200, type: String })
  healthCheck(): string {
    return "ok";
  }

  /**
   * Test endpoint that calls external API.
   * @param res Express response object
   * @returns Promise of Express Response
   */
  @Get("foo")
  async getFoo(@Res() res: Response): Promise<Response> {
    const { data } = await axios.get<{ url: string }>(
      "https://httpbin.org/get",
    );
    return res.send(data.url);
  }
}
