import {
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Post,
  Res,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import type { Response } from "express";
import { Dtm, type DtmType } from "./dtm.schema";
import { TopologyService } from "./topology.service";
import type { DtmView } from "./topology.view";

/** REST surface for the Device Topology Manifest. */
@ApiTags("topology")
@Controller("topology")
export class TopologyController {
  /**
   * Wires the TopologyService dependency.
   * @param service Service handling DTM persistence and retrieval
   */
  constructor(private readonly service: TopologyService) {}

  /**
   * Accept a DTM, validate it against the Zod schema, persist it.
   * platform-api calls this on delivery and on release rollout.
   * @param dtm Validated Device Topology Manifest body
   * @returns Acknowledgement on successful persistence
   */
  @Post()
  @ApiOperation({ summary: "Submit DTM" })
  @ApiResponse({ status: 201 })
  @ApiResponse({
    status: 400,
    description: "DTM failed schema or catalog validation",
  })
  async submit(
    @Body(new ZodValidationPipe(Dtm)) dtm: DtmType,
  ): Promise<{ ok: true }> {
    this.service.validateAgainstCatalog(dtm);
    await this.service.save(dtm);
    return { ok: true };
  }

  /**
   * Return the most-recently submitted DTM (full, including gateway-only fields).
   * Consumed by platform-api and internal commissioning tooling. NOT consumed by HMI.
   * @returns The latest DTM body
   * @throws NotFoundException when no DTM has been submitted yet
   */
  @Get()
  @ApiOperation({ summary: "Get latest DTM (full — gateway/internal use)" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: "No DTM has been submitted yet" })
  async getLatest(): Promise<DtmType> {
    const dtm = await this.service.getLatest();
    if (!dtm) throw new NotFoundException("no DTM has been submitted yet");
    return dtm;
  }

  /**
   * Return the sanitized DTM projection per system_adr §22 — consumed by HMI.
   * Strips gateway-only fields (`connection.*`, per-measurement `binding`,
   * per-command `binding`/`fanout`). Inlines per-template measurement metadata.
   * @returns The latest DTM projected to the HMI-facing view
   * @throws NotFoundException when no DTM has been submitted yet
   */
  @Get("view")
  @ApiOperation({
    summary: "Get sanitized DTM projection (HMI consumer)",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: "No DTM has been submitted yet" })
  async getLatestView(): Promise<DtmView> {
    const view = await this.service.getLatestView();
    if (!view) throw new NotFoundException("no DTM has been submitted yet");
    return view;
  }

  /**
   * Return the SLD SVG rendered by edp-api for the latest DTM per system_adr §6.
   * Bytes are cached in-memory keyed by DTM version; cache populates lazily
   * on first GET after each topology save or process restart.
   * @param res Express response — written directly so we control content-type
   * @throws NotFoundException when no DTM has been submitted yet
   * @throws ServiceUnavailableException when edp-api render fails
   */
  @Get("sld.svg")
  @Header("Content-Type", "image/svg+xml; charset=utf-8")
  @ApiOperation({
    summary: "Get SLD SVG for this deployment (HMI consumer)",
  })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: "No DTM has been submitted yet" })
  @ApiResponse({ status: 503, description: "edp-api SVG render unavailable" })
  async getLatestSldSvg(@Res() res: Response): Promise<void> {
    const svg = await this.service.getLatestSld();
    if (svg === null) {
      throw new NotFoundException("no DTM has been submitted yet");
    }
    res.send(svg);
  }
}
