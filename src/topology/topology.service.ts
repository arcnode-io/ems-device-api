import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Topology } from "./topology.entity";
import type { DtmType } from "./dtm.schema";

/**
 * Persists DTM submissions and returns the most recent.
 * Single-tenant — no scoping by deployment_uuid; the running container is
 * scoped to one ARCNODE deployment by construction.
 */
@Injectable()
export class TopologyService {
  /**
   * Wires the TypeORM repository for the Topology entity.
   * @param repo TypeORM repository for Topology rows
   */
  constructor(
    @InjectRepository(Topology)
    private readonly repo: Repository<Topology>,
  ) {}

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
