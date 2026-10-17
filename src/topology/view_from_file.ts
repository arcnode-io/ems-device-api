/**
 * GET /topology/view, computed from a DTM file instead of the database.
 *
 * Same steps POST /topology + GET /topology/view take: schema parse, catalog
 * check, projection. Nothing is added to the DTM here or there — the view is
 * the file, sanitized.
 *
 * Usage: npm run -s topology-view -- <dtm.json> > view.json
 * (catalog root comes from cfg.yml's block for $ENV, `local` when unset)
 */

import { readFileSync } from "node:fs";
import { loadConfig } from "../config";
import { TemplateLoaderService } from "../templates/template_loader.service";
import type { DeviceTemplateType } from "../templates/template.schema";
import { assertTemplatesInCatalog } from "./catalog_check";
import { Dtm } from "./dtm.schema";
import { projectDtmToView, type DtmView } from "./topology.view";

/**
 * Project a DTM file the way POST /topology then GET /topology/view would.
 * @param dtmPath Path to a DTM JSON file
 * @param catalog Slug-keyed template catalog the DTM must stay within
 * @returns The sanitized HMI-facing view
 * @throws ZodError on a malformed DTM; BadRequestException on an unknown template slug
 */
export function viewFromFile(
  dtmPath: string,
  catalog: Record<string, DeviceTemplateType>,
): DtmView {
  const dtm = Dtm.parse(JSON.parse(readFileSync(dtmPath, "utf8")));
  assertTemplatesInCatalog(dtm, catalog);
  return projectDtmToView(dtm);
}

if (require.main === module) {
  const dtmPath = process.argv[2];
  if (dtmPath === undefined) {
    throw new Error("usage: npm run -s topology-view -- <dtm.json>");
  }
  const catalog = new TemplateLoaderService().loadCatalog(
    loadConfig().templateCatalogRoot,
  );
  process.stdout.write(
    `${JSON.stringify(viewFromFile(dtmPath, catalog), null, 2)}\n`,
  );
}
