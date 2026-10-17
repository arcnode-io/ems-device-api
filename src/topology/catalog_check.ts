import { BadRequestException } from "@nestjs/common";
import type { DtmType } from "./dtm.schema";
import type { DeviceTemplateType } from "../templates/template.schema";

/**
 * Throws BadRequestException if any slug in dtm.templates_used is not in the catalog.
 * @param dtm Validated Device Topology Manifest
 * @param catalog Slug-keyed template catalog
 */
export function assertTemplatesInCatalog(
  dtm: DtmType,
  catalog: Record<string, DeviceTemplateType>,
): void {
  const unknown = Object.keys(dtm.templates_used).filter(
    (slug) => !(slug in catalog),
  );
  if (unknown.length > 0) {
    throw new BadRequestException(
      `templates_used contains slug(s) not in bundled catalog: ${unknown.join(", ")}`,
    );
  }
}
