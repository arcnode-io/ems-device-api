import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Topology } from "./topology.entity";
import type { DtmType } from "./dtm.schema";
import { TEMPLATE_CATALOG } from "../templates/templates.module";
import type { DeviceTemplateType } from "../templates/template.schema";

/**
 * Persists DTM submissions and returns the most recent.
 * Single-tenant — no scoping by deployment_uuid; the running container is
 * scoped to one ARCNODE deployment by construction.
 */
@Injectable()
export class TopologyService {
  /**
   * Wires the TypeORM repository and the bundled template catalog.
   * @param repo TypeORM repository for Topology rows
   * @param catalog Slug-keyed device template catalog loaded at startup
   */
  constructor(
    @InjectRepository(Topology)
    private readonly repo: Repository<Topology>,
    @Inject(TEMPLATE_CATALOG)
    private readonly catalog: Record<string, DeviceTemplateType>,
  ) {}

  /**
   * Throws BadRequestException if any slug in dtm.templates_used is not in the bundled catalog.
   * This is one level above Zod's template_refs_resolve refine — it checks that the
   * device-api actually knows how to resolve each slug, not just that dtm is self-consistent.
   * @param dtm Validated Device Topology Manifest
   */
  validateAgainstCatalog(dtm: DtmType): void {
    const unknown = Object.keys(dtm.templates_used).filter(
      (slug) => !(slug in this.catalog),
    );
    if (unknown.length > 0) {
      throw new BadRequestException(
        `templates_used contains slug(s) not in bundled catalog: ${unknown.join(", ")}`,
      );
    }
  }

  /**
   * Persist a new DTM submission. History is retained, not overwritten.
   * @param dtm Validated Device Topology Manifest
   * @returns The persisted Topology row, including its auto-PK and timestamp
   */
  async save(dtm: DtmType): Promise<Topology> {
    const row = this.repo.create({ dtm });
    return await this.repo.save(row);
  }

  /**
   * Return the most-recently persisted DTM, or null if nothing has been submitted.
   * @returns The latest DTM, or null
   */
  async getLatest(): Promise<DtmType | null> {
    const row = await this.repo.findOne({
      where: {},
      order: { receivedAt: "DESC" },
    });
    return row ? (row.dtm as DtmType) : null;
  }
}
