/** Shared types for the AsyncAPI spec generator and its sub-builders. */

import type { DeviceClassType } from "../classes/class.schema";

/** Resolves a DTM device-class ref like `bess_module.v1` to its definition. */
export type ClassLookup = (classRef: string) => DeviceClassType | undefined;
