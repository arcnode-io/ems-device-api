/** Shared types for the AsyncAPI spec generator and its sub-builders. */

import type { DeviceTemplateType } from "../templates/template.schema";

/** Resolves a DTM device-template ref like `bess_module.v1` to its definition. */
export type TemplateLookup = (
  templateRef: string,
) => DeviceTemplateType | undefined;
