/**
 * Boot-time DTM read + seed per system_adr §22.
 *
 * path set + table empty → read + parse + validate + seed
 * path set + table populated → read + skip seed (don't overwrite operator changes)
 * path null → graceful empty start
 * Any read/parse/validate/catalog error when path set → fatal (caller propagates)
 */

import { Logger } from "@nestjs/common";
import type { INestApplicationContext } from "@nestjs/common";
import * as fs from "node:fs/promises";
import { Dtm } from "../topology/dtm.schema";
import type { DtmType } from "../topology/dtm.schema";
import { TopologyService } from "../topology/topology.service";

/**
 * Read DTM from a JSON file and seed topology if empty.
 * @param app Assembled NestJS application context
 * @param path filesystem path to dtm.json, or null to skip read
 * @param logger NestJS Logger instance
 */
export async function seedFromFile(
  app: INestApplicationContext,
  path: string | null,
  logger: Logger,
): Promise<void> {
  if (path === null) {
    logger.log("no boot_dtm_path configured; starting empty");
    return;
  }

  const body = await fs.readFile(path, "utf8");
  const raw = JSON.parse(body) as unknown;
  const dtm: DtmType = Dtm.parse(raw);

  const service = app.get(TopologyService);
  service.validateAgainstCatalog(dtm);

  const existing = await service.getLatest();
  if (existing !== null) {
    logger.log(`topology already populated; skipping seed from ${path}`);
    return;
  }
  await service.save(dtm);
  logger.log(`seeded topology from ${path}`);
}
