/**
 * Boot-time DTM read + seed per system_adr §22.
 *
 * path set + table empty → read + parse + validate + seed
 * path set + table populated and still serviceable → read + skip seed (don't
 *   overwrite operator changes)
 * path set + table populated but the row no longer builds a spec → re-seed
 * path null → graceful empty start
 * Any read/parse/validate/catalog error when path set → fatal (caller propagates)
 *
 * sldPath set → the SVG is stored on the row unless it already has one, so a
 *   deployment can ship a pre-rendered diagram and never run edp-api. Unset leaves
 *   the lazy render in place.
 */

import { Logger } from "@nestjs/common";
import type { INestApplicationContext } from "@nestjs/common";
import * as fs from "node:fs/promises";
import { SpecContractError } from "../asyncapi/spec-contract";
import { buildSpec } from "../asyncapi/spec-generator";
import { Dtm } from "../topology/dtm.schema";
import type { DtmType } from "../topology/dtm.schema";
import { TopologyService } from "../topology/topology.service";

/**
 * Whether the persisted DTM should be replaced by the mounted file.
 *
 * Reason: tightening a field — narrowing a type, requiring what was optional —
 * leaves rows that no longer satisfy the contract, and /asyncapi is generated
 * from the row on every request, so the gateway's only spec source stays down
 * until someone notices. The mounted file is the current shape by definition,
 * so a row the contract rejects is a row to replace.
 * @param dtm The persisted DTM, as stored
 * @param logger NestJS Logger instance
 * @returns True only when the contract itself rejected the row
 */
function needsReseed(dtm: DtmType, logger: Logger): boolean {
  try {
    // The version only lands in info.version, so any value answers the question.
    buildSpec(dtm, "0");
    return false;
  } catch (err) {
    if (err instanceof SpecContractError) return true;
    // Reason: an error we can't attribute to the contract is not grounds to
    // overwrite an operator's topology. Keep the row and keep booting —
    // /asyncapi answers 503 with the detail on every request, which surfaces it
    // better than a boot loop with no HTTP surface at all.
    const detail = err instanceof Error ? err.message : String(err);
    logger.warn(
      `persisted topology failed to build a spec for an unrecognized reason; ` +
        `keeping it — /asyncapi will answer 503: ${detail}`,
    );
    return false;
  }
}

/**
 * Read DTM from a JSON file and seed topology if empty.
 * @param app Assembled NestJS application context
 * @param path filesystem path to dtm.json, or null to skip read
 * @param logger NestJS Logger instance
 * @param sldPath filesystem path to a pre-rendered SLD SVG, or null to render on demand
 */
export async function seedFromFile(
  app: INestApplicationContext,
  path: string | null,
  logger: Logger,
  sldPath: string | null = null,
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
  const stale = existing !== null && needsReseed(existing, logger);
  if (existing !== null && !stale) {
    logger.log(`topology already populated; skipping seed from ${path}`);
    await seedSld(app, sldPath, logger);
    return;
  }
  if (stale) {
    logger.warn(
      `persisted topology no longer generates a spec; re-seeding from ${path}`,
    );
  }
  await service.save(dtm);
  logger.log(`seeded topology from ${path}`);
  await seedSld(app, sldPath, logger);
}

/**
 * Store a pre-rendered SLD on the latest row when one is mounted.
 *
 * Runs on the already-populated path too, so a deployment that gains a diagram
 * file picks it up on its next boot rather than only on a fresh seed.
 * @param app Assembled NestJS application context
 * @param sldPath filesystem path to an SVG, or null to skip
 * @param logger NestJS Logger instance
 */
async function seedSld(
  app: INestApplicationContext,
  sldPath: string | null,
  logger: Logger,
): Promise<void> {
  if (sldPath === null) return;
  const svg = await fs.readFile(sldPath);
  const stored = await app.get(TopologyService).storeSldIfAbsent(svg);
  logger.log(
    stored
      ? `seeded SLD from ${sldPath}`
      : `topology already has an SLD; left it alone`,
  );
}
