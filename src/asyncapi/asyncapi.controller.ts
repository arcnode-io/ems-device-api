import {
  Controller,
  Get,
  Header,
  NotFoundException,
  Res,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import type { Response } from "express";
import { AsyncapiService } from "./asyncapi.service";

/** Three views over the generated AsyncAPI v3 spec — JSON, YAML, HTML. */
@ApiTags("asyncapi")
@Controller("asyncapi")
export class AsyncapiController {
  /**
   * Wires the AsyncapiService dependency.
   * @param service AsyncAPI spec generator + renderer
   */
  constructor(private readonly service: AsyncapiService) {}

  /**
   * Return the AsyncAPI v3 spec as JSON. Default for machine consumers
   * (gateway/HMI codegen pipelines).
   * @returns The AsyncAPI spec as a plain object
   * @throws NotFoundException when no DTM has been submitted yet
   */
  @Get()
  @ApiOperation({ summary: "Get AsyncAPI spec (JSON)" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: "No DTM has been submitted yet" })
  async getJson(): Promise<Record<string, unknown>> {
    const spec = await this.service.generateSpec();
    if (!spec) throw new NotFoundException("no DTM has been submitted yet");
    return spec;
  }

  /**
   * Return the AsyncAPI v3 spec as YAML.
   * @param res Express response — written directly so we control content-type
   * @throws NotFoundException when no DTM has been submitted yet
   */
  @Get("yaml")
  @Header("Content-Type", "application/yaml")
  @ApiOperation({ summary: "Get AsyncAPI spec (YAML)" })
  async getYaml(@Res() res: Response): Promise<void> {
    const body = await this.service.generateYaml();
    if (!body) throw new NotFoundException("no DTM has been submitted yet");
    res.send(body);
  }

  /**
   * Return a self-contained HTML page rendering the spec for human readers.
   * @param res Express response — written directly so we control content-type
   * @throws NotFoundException when no DTM has been submitted yet
   */
  @Get("docs")
  @Header("Content-Type", "text/html; charset=utf-8")
  @ApiOperation({ summary: "Render AsyncAPI spec as HTML" })
  async getDocs(@Res() res: Response): Promise<void> {
    const body = await this.service.generateHtml();
    if (!body) throw new NotFoundException("no DTM has been submitted yet");
    res.send(body);
  }
}
