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
      const { data } = await axios.post<ArrayBuffer>(url, dtm, {
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
