import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Topology } from "./topology.entity";
import type { DtmType } from "./dtm.schema";
import { TEMPLATE_CATALOG } from "../templates/templates.module";
import type { DeviceTemplateType } from "../templates/template.schema";
import { diffDtm, nextVersion } from "./dtm_diff";

/**
 * Persists DTM submissions and returns the most recent.
 * Single-tenant — no scoping by deployment_uuid; the running container is
 * scoped to one ARCNODE deployment by construction.
 *
 * Each save() runs dtm_diff against the prior row and computes the next
 * semver per ADR-002 §10. Identical DTMs still create rows (audit lineage)
 * but version stays the same.
 */
@Injectable()
export class TopologyService {
  private readonly logger = new Logger(TopologyService.name);

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
   * Throws BadRequestException if any slug in dtm.templates_used is not in
   * the bundled catalog.
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
   * Persist a DTM. Computes the next semver from prior row + diff per
   * ADR-002 §10. Bootstrap → 1.0.0. Identical DTM → version unchanged + new
   * row (audit).
   * @param dtm Validated Device Topology Manifest
   * @returns The persisted Topology row, including assigned version
   */
  async save(dtm: DtmType): Promise<Topology> {
    const prior = await this.repo.findOne({
      where: {},
      order: { receivedAt: "DESC" },
    });
    const priorDtm = (prior?.dtm ?? null) as DtmType | null;
    const priorVersion = prior?.version ?? null;
    const diff = diffDtm(priorDtm, dtm);
    const version = nextVersion(priorVersion, diff);
    const reasonStr =
      diff.reasons.length > 0 ? `: ${diff.reasons.join("; ")}` : "";
    if (priorVersion === null) {
      this.logger.log(`seeded topology v${version} (initial)`);
    } else {
      this.logger.log(
        `updated topology v${priorVersion} → v${version} (${diff.bump}${reasonStr})`,
      );
    }
    const row = this.repo.create({
      dtm: dtm as unknown as Record<string, unknown>,
      version,
    });
    return await this.repo.save(row);
  }

  /**
   * Return the most-recently persisted DTM, or null if nothing has been
   * submitted.
   * @returns The latest DTM, or null
   */
  async getLatest(): Promise<DtmType | null> {
    const row = await this.repo.findOne({
      where: {},
      order: { receivedAt: "DESC" },
    });
    return row ? (row.dtm as DtmType) : null;
  }

  /**
   * Return the most-recently persisted Topology row (DTM + version + meta),
   * or null. Used by AsyncapiService to emit the real version in info.version.
   * @returns The latest row, or null
   */
  async getLatestRow(): Promise<Topology | null> {
    return this.repo.findOne({
      where: {},
      order: { receivedAt: "DESC" },
    });
  }
}
