import { Logger } from "@nestjs/common";
import {
  distributeRange,
  resolveDistributeChildren,
} from "../asyncapi/spec-rollup";
import type { DtmType } from "./dtm.schema";
import type { BoundsType } from "../templates/template.schema";

const logger = new Logger("DeviceBounds");

/**
 * Per-device ranges device-api derives rather than reads off a template.
 *
 * Today that's one thing: a `distribute` command's target on a module is the sum
 * of its children's ranges (a BESS module's active_power = Σ its racks'), the
 * same range the gateway clamps dispatch to.
 * @param dtm Validated DTM as persisted
 * @param deviceId The device to derive for
 * @returns Measurement name → range, or null when nothing derives one
 */
export function deviceBounds(
  dtm: DtmType,
  deviceId: string,
): Record<string, BoundsType> | null {
  const tpl = dtm.templates_used[dtm.devices[deviceId]!.template];
  const out: Record<string, BoundsType> = {};
  for (const [name, cmd] of Object.entries(tpl?.commands ?? {})) {
    if (cmd.binding?.protocol !== "distribute") continue;
    let children;
    try {
      children = resolveDistributeChildren(
        dtm,
        deviceId,
        cmd.verb,
        cmd.target,
        cmd.binding,
      );
    } catch (err) {
      // Reason: a module whose children can't be resolved can't be dispatched —
      // /asyncapi refuses the binding with the detail. The view still serves
      // everything else; this module just shows no range.
      logger.warn(
        `device ${deviceId}: no ${cmd.target} range for ${name}: ${(err as Error).message}`,
      );
      continue;
    }
    if (children.length === 0) continue;
    const { power_min, power_max } = distributeRange(children);
    out[cmd.target] = { min: power_min, max: power_max, nominal: 0 };
  }
  return Object.keys(out).length > 0 ? out : null;
}
