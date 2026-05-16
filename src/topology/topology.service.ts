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
import { MqttClientService } from "../mqtt/mqtt.client.service";
import { SldSvgRendererService } from "./sld_svg_renderer.service";
import { projectDtmToView, type DtmView } from "./topology.view";

/**
 * Compute the next monotonic version per ADR-002 §10 (MVP simplification).
 * Bootstrap → 1.0.0; subsequent saves bump the patch component by 1.
 * @param prev Prior version (e.g., "1.0.7") or null on bootstrap.
 * @returns Next semver string.
 */
function nextMonotonicVersion(prev: string | null): string {
  if (prev === null) return "1.0.0";
  // Reason: semver is always "M.m.p" — non-null asserts safe for validated input
  const parts = prev.split(".").map(Number);
  const major = parts[0]!;
  const minor = parts[1]!;
  const patch = parts[2]!;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * Persists DTM submissions and returns the most recent.
 * Single-tenant — no scoping by deployment_uuid; the running container is
 * scoped to one ARCNODE deployment by construction.
 *
 * Each save() increments a monotonic version per ADR-002 §10. Major/minor
 * semantic classification deferred until consumers actually need it; current
 * MVP uses unconditional patch bumps as the change signal.
 */
@Injectable()
export class TopologyService {
  private readonly logger = new Logger(TopologyService.name);

  // In-memory SLD SVG cache keyed by DTM version. Lazy: populated on the
  // first GET /topology/sld.svg after each save or process boot.
  private cachedSvg: Buffer | null = null;
  private cachedSvgVersion: string | null = null;

  /**
   * Wires the TypeORM repository, bundled template catalog, MQTT client,
   * and SLD SVG renderer.
   * @param repo TypeORM repository for Topology rows
   * @param catalog Slug-keyed device template catalog loaded at startup
   * @param mqtt MQTT client for system/topology_changed broadcasts
   * @param sldRenderer Wraps edp-api `POST /edp-api/sld-hmi-svg` for re-render
   */
  constructor(
    @InjectRepository(Topology)
    private readonly repo: Repository<Topology>,
    @Inject(TEMPLATE_CATALOG)
    private readonly catalog: Record<string, DeviceTemplateType>,
    private readonly mqtt: MqttClientService,
    private readonly sldRenderer: SldSvgRendererService,
  ) {}

  /**
   * Throws BadRequestException if any slug in dtm.templates_used is not in
   * the bundled catalog.
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
   * Persist a DTM with a monotonic version bump per ADR-002 §10.
   * Bootstrap → 1.0.0. Every subsequent save → patch + 1.
   * @param dtm Validated Device Topology Manifest
   * @returns The persisted Topology row, including assigned version
   */
  async save(dtm: DtmType): Promise<Topology> {
    const prior = await this.repo.findOne({
      where: {},
      order: { receivedAt: "DESC" },
    });
    const priorVersion = prior?.version ?? null;
    const version = nextMonotonicVersion(priorVersion);
    if (priorVersion === null) {
      this.logger.log(`seeded topology v${version} (initial)`);
    } else {
      this.logger.log(`updated topology v${priorVersion} → v${version}`);
    }
    const row = this.repo.create({
      dtm: dtm as unknown as Record<string, unknown>,
      version,
    });
    const saved = await this.repo.save(row);
    this.mqtt.publishTopologyChanged(version);
    return saved;
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
   * or null. Used by AsyncapiService to emit version in info.version.
   * @returns The latest row, or null
   */
  async getLatestRow(): Promise<Topology | null> {
    return this.repo.findOne({
      where: {},
      order: { receivedAt: "DESC" },
    });
  }

  /**
   * Return the sanitized DTM projection for HMI consumption per system_adr §22.
   * Strips gateway-only fields; inlines per-template measurement metadata.
   * @returns The latest DTM projected to the HMI-facing view, or null
   */
  async getLatestView(): Promise<DtmView | null> {
    const dtm = await this.getLatest();
    return dtm === null ? null : projectDtmToView(dtm);
  }

  /**
   * Return the SLD HMI SVG bytes for the latest DTM, calling edp-api to
   * render when the cache is empty or stale. Lazy render keeps `POST /topology`
   * decoupled from edp-api availability; first GET after each save or
   * process restart pays the render latency.
   * @returns SVG bytes, or null if no DTM has been submitted yet
   * @throws ServiceUnavailableException if edp-api is unreachable on render
   */
  async getLatestSld(): Promise<Buffer | null> {
    const row = await this.getLatestRow();
    if (row === null) return null;
    if (this.cachedSvg !== null && this.cachedSvgVersion === row.version) {
      return this.cachedSvg;
    }
    const svg = await this.sldRenderer.render(row.dtm as unknown as DtmType);
    this.cachedSvg = svg;
    this.cachedSvgVersion = row.version;
    return svg;
  }
}
