/**
 * Pure DTM diff + version computation per ADR-002 §10 semver rules.
 *
 * No I/O, no NestJS DI. Caller (TopologyService.save) loads prev row, runs
 * diffDtm against incoming next, computes nextVersion, persists.
 */

import type { DtmType } from "./dtm.schema";
import {
  deepEqual,
  diffBuses,
  diffDevices,
  diffTemplates,
  diffTopLevel,
  escalate,
} from "./dtm_diff_internals";

export type Bump = "major" | "minor" | "patch" | "none";

export interface DtmDiff {
  bump: Bump;
  reasons: string[];
}

// Re-export internals so existing deep imports remain valid
export {
  deepEqual,
  diffBusMembers,
  diffBuses,
  diffDeviceFields,
  diffDevices,
  diffExtraMeasurements,
  diffTemplates,
  diffTopLevel,
  escalate,
  stableStringify,
} from "./dtm_diff_internals";

/**
 * Classify a prev → next DTM transition per ADR-002 §10.
 * @param prev The previously persisted DTM, or null for the bootstrap seed.
 * @param next The incoming DTM about to be persisted.
 * @returns DtmDiff describing the bump severity + accumulated reasons.
 */
export function diffDtm(prev: DtmType | null, next: DtmType): DtmDiff {
  if (prev === null) return { bump: "none", reasons: [] };
  if (deepEqual(prev, next)) return { bump: "none", reasons: [] };
  const reasons: string[] = [];
  const bump = [
    diffTopLevel(prev, next, reasons),
    diffDevices(prev, next, reasons),
    diffBuses(prev, next, reasons),
    diffTemplates(prev, next, reasons),
  ].reduce(escalate, "none" as Bump);
  return { bump, reasons };
}

/**
 * Compute the next semver string from prev + diff per ADR-002 §10.
 * @param prev Prior version (e.g., "2.4.7"), or null for the bootstrap seed.
 * @param diff The classified change.
 * @returns The new semver string. Bootstrap → "1.0.0". none → unchanged.
 */
export function nextVersion(prev: string | null, diff: DtmDiff): string {
  if (prev === null) return "1.0.0";
  if (diff.bump === "none") return prev;
  // Reason: semver is always "M.m.p" — non-null asserts safe for validated input
  const parts = prev.split(".").map(Number);
  const major = parts[0]!;
  const minor = parts[1]!;
  const patch = parts[2]!;
  if (diff.bump === "major") return `${major + 1}.0.0`;
  if (diff.bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}
