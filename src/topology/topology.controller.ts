import { Body, Controller, Get, NotFoundException, Post } from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse } from "@nestjs/swagger";
import { ZodValidationPipe } from "nestjs-zod";
import { Dtm, type DtmType } from "./dtm.schema";
import { TopologyService } from "./topology.service";

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
   * Return the most-recently submitted DTM. 404 if nothing has been submitted.
   * Consumed by ems-hmi (module browser, SLD rendering).
   * @returns The latest DTM body
   * @throws NotFoundException when no DTM has been submitted yet
   */
  @Get()
  @ApiOperation({ summary: "Get latest DTM" })
  @ApiResponse({ status: 200 })
  @ApiResponse({ status: 404, description: "No DTM has been submitted yet" })
  async getLatest(): Promise<DtmType> {
    const dtm = await this.service.getLatest();
    if (!dtm) throw new NotFoundException("no DTM has been submitted yet");
    return dtm;
  }
}
