import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import axios, { AxiosError } from "axios";
import type { DtmType } from "./dtm.schema";
import { loadConfig } from "../config";

/**
 * Calls edp-api's stateless `POST /edp-api/sld-hmi-svg` endpoint to render
 * the SLD HMI SVG for a given DTM. Pure pass-through: same DTM in -> same
 * SVG bytes out. No persistence here; TopologyService caches the result.
 *
 * Architectural rationale (edp-api owns SVG authoring; device-api owns runtime
 * topology CRUD): when our cached DTM mutates, we re-render through edp-api
 * rather than duplicating SVG-authoring logic on the device-api side.
 */
@Injectable()
export class SldSvgRendererService {
  private readonly logger = new Logger(SldSvgRendererService.name);
  private readonly edpApiUrl: string;

  /** Loads edp-api URL from cfg.yml at construction time. */
  constructor() {
    this.edpApiUrl = loadConfig().edpApiUrl;
  }

  /**
   * Render a DTM to SVG bytes via edp-api.
   * @param dtm The (possibly runtime-mutated) DTM to render.
   * @returns SVG document bytes.
   * @throws ServiceUnavailableException if edp-api is unreachable / returns non-2xx.
   */
  async render(dtm: DtmType): Promise<Buffer> {
    const url = `${this.edpApiUrl}/edp-api/sld-hmi-svg`;
    try {
      // Reason: edp-api's Device is extra="forbid", so once it drops `blocking`
      // (ADR §25) any DTM still carrying it would 422 and break SLD re-render on
      // every topology change. Stripping here lets that removal land safely.
      const payload = dtm.devices
        ? {
            ...dtm,
            devices: Object.fromEntries(
              Object.entries(dtm.devices).map(([id, device]) => {
                const rest = { ...device };
                delete rest.blocking;
                return [id, rest];
              }),
            ),
          }
        : dtm;
      const { data } = await axios.post<ArrayBuffer>(url, payload, {
        responseType: "arraybuffer",
        headers: { "Content-Type": "application/json" },
      });
      return Buffer.from(data);
    } catch (err) {
      const detail = err instanceof AxiosError ? err.message : String(err);
      this.logger.error(`edp-api sld-hmi-svg render failed: ${detail}`);
      throw new ServiceUnavailableException(
        `SLD SVG render unavailable: ${detail}`,
      );
    }
  }
}
