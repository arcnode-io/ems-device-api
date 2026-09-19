/**
 * Phase I children resolution — compiles a device's `synthetic` binding
 * `source_measurement` mode and a `distribute` binding's implicit children
 * into the concrete topics/values the gateway consumes. Both walk `parent`
 * on the DTM (ADR-002's module→children relationship) so the gateway never
 * does any DTM-walking itself — it only ever sees fully-resolved data.
 */

import type { DtmType, DeviceType } from "../topology/dtm.schema";
import type { DeviceTemplateType } from "../templates/template.schema";
import { MEASUREMENT_ADDRESS } from "./spec-channels";

/** One resolved {topic, weight} pair for a `weighted_mean` aggregation. */
export type WeightedPair = { topic: string; weight: number };

/** One resolved child entry for a `distribute` binding's allocation. */
export type DistributeChild = {
  device_id: string;
  operating_state_topic: string;
  state_of_charge_topic: string;
  power_min: number;
  power_max: number;
};

/** Resolved envelope-guard fields for a `distribute` binding — see resolveEnvelopeGuard. */
export type EnvelopeGuardResolution = {
  power_min: number;
  power_max: number;
  import_limit_topic: string;
  export_limit_topic: string;
  active_power_topic: string;
};

/** Well-known singleton DOE device id — same convention already hardcoded in bess_module's own import_headroom/export_headroom inputs[]. */
const OPERATING_ENVELOPE_DEVICE_ID = "operating_envelope";

/**
 * Find every device whose `parent` is `deviceId`, sorted by device_id for
 * deterministic output order.
 * @param dtm The self-describing deployment manifest
 * @param deviceId The parent device's id
 * @returns This device's children, sorted by device_id
 */
export function resolveChildren(dtm: DtmType, deviceId: string): DeviceType[] {
  return Object.values(dtm.devices)
    .filter((device) => device.parent === deviceId)
    .sort((deviceA, deviceB) => deviceA.device_id.localeCompare(deviceB.device_id));
}

/**
 * Look up a child's template, failing loud if the DTM's own referential-
 * integrity guarantee (device.template must resolve in templates_used)
 * has somehow been bypassed by a caller constructing a DTM by hand.
 * @param dtm The self-describing deployment manifest
 * @param child The child device whose template to resolve
 * @returns The child's validated DeviceTemplate
 */
function childTemplate(dtm: DtmType, child: DeviceType): DeviceTemplateType {
  const tpl = dtm.templates_used[child.template];
  if (!tpl) {
    throw new Error(
      `device ${child.device_id}: template ${child.template} not in catalog`,
    );
  }
  return tpl;
}

/**
 * Fill the MEASUREMENT_ADDRESS topic template with a concrete device_id,
 * measurement, and unit. `{site_id}` stays unresolved for gateway runtime.
 * @param deviceId The measurement's owning device id
 * @param measurement The measurement name
 * @param unit The measurement's operator-readable unit
 * @returns The concrete MQTT topic
 */
function buildTopic(deviceId: string, measurement: string, unit: string): string {
  return MEASUREMENT_ADDRESS.replace("{device_id}", deviceId)
    .replace("{measurement}", measurement)
    .replace("{unit}", unit);
}

/**
 * Resolve a `synthetic` binding's `source_measurement` mode into concrete
 * `inputs` (sum/mean/max/min) or `pairs` (weighted_mean, weighted by each
 * child's `capacity_kwh`) across every child of `deviceId`. Fails loud if a
 * child's template is missing the named measurement, or — weighted_mean
 * only — missing `capacity_kwh`.
 * @param dtm The self-describing deployment manifest
 * @param deviceId The device this synthetic binding lives on (the parent)
 * @param sourceMeasurement The measurement name to project across children
 * @param operation The synthetic binding's operation
 * @returns `{inputs}` for sum/mean/max/min, `{pairs}` for weighted_mean
 */
export function resolveSourceMeasurement(
  dtm: DtmType,
  deviceId: string,
  sourceMeasurement: string,
  operation: string,
): { inputs: string[] } | { pairs: WeightedPair[] } {
  const children = resolveChildren(dtm, deviceId);

  if (operation === "weighted_mean") {
    const pairs = children.map((child) => {
      const tpl = childTemplate(dtm, child);
      const meas = tpl.measurements[sourceMeasurement];
      if (!meas) {
        throw new Error(
          `device ${deviceId}: source_measurement "${sourceMeasurement}" not found on child ${child.device_id}'s template (${child.template})`,
        );
      }
      if (tpl.capacity_kwh === null) {
        throw new Error(
          `device ${deviceId}: weighted_mean requires capacity_kwh on child ${child.device_id}'s template (${child.template}), but it's null`,
        );
      }
      return {
        topic: buildTopic(child.device_id, sourceMeasurement, meas.unit),
        weight: tpl.capacity_kwh,
      };
    });
    return { pairs };
  }

  const inputs = children.map((child) => {
    const tpl = childTemplate(dtm, child);
    const meas = tpl.measurements[sourceMeasurement];
    if (!meas) {
      throw new Error(
        `device ${deviceId}: source_measurement "${sourceMeasurement}" not found on child ${child.device_id}'s template (${child.template})`,
      );
    }
    return buildTopic(child.device_id, sourceMeasurement, meas.unit);
  });
  return { inputs };
}

/**
 * Resolve a `distribute` binding's children array. For every child of
 * `deviceId`: verify it has its own command matching `verb`+`target` (fail
 * loud if not — nothing to write to), and resolve its `operating_state`/
 * `state_of_charge` topics (FAULT/OFFLINE eligibility + SoC weighting) plus
 * the target measurement's static `bounds` (the rack's own rated range, for
 * allocation clamping).
 * @param dtm The self-describing deployment manifest
 * @param deviceId The device this distribute binding lives on (the parent)
 * @param verb The command's verb, inherited by every child's own command
 * @param target The command's target, inherited by every child's own command
 * @returns Resolved per-child allocation data, sorted by device_id
 */
export function resolveDistributeChildren(
  dtm: DtmType,
  deviceId: string,
  verb: string,
  target: string,
): DistributeChild[] {
  const children = resolveChildren(dtm, deviceId);

  return children.map((child) => {
    const tpl = childTemplate(dtm, child);

    const hasMatchingCommand = Object.values(tpl.commands).some(
      (cmd) => cmd.verb === verb && cmd.target === target,
    );
    if (!hasMatchingCommand) {
      throw new Error(
        `device ${deviceId}: distribute binding needs a ${verb}/${target} command on child ${child.device_id}'s template (${child.template}), none found`,
      );
    }

    const operatingState = tpl.measurements.operating_state;
    if (!operatingState) {
      throw new Error(
        `device ${deviceId}: distribute binding needs operating_state on child ${child.device_id}'s template (${child.template}), none found`,
      );
    }

    const soc = tpl.measurements.state_of_charge;
    if (!soc) {
      throw new Error(
        `device ${deviceId}: distribute binding needs state_of_charge on child ${child.device_id}'s template (${child.template}), none found`,
      );
    }

    const targetMeas = tpl.measurements[target];
    if (!targetMeas?.bounds) {
      throw new Error(
        `device ${deviceId}: distribute binding needs ${target}.bounds on child ${child.device_id}'s template (${child.template}), none found`,
      );
    }

    return {
      device_id: child.device_id,
      operating_state_topic: buildTopic(
        child.device_id,
        "operating_state",
        operatingState.unit,
      ),
      state_of_charge_topic: buildTopic(
        child.device_id,
        "state_of_charge",
        soc.unit,
      ),
      power_min: targetMeas.bounds.min,
      power_max: targetMeas.bounds.max,
    };
  });
}

/**
 * Resolve a `distribute` binding's envelope-guard fields: the module-level
 * clamp range (summed from each already-resolved child's own power_min/
 * power_max — bess_module has no static rated-power fact of its own, since
 * its rack count is `qty: "scalable"` and varies per deployment, same
 * reason `capacity_kwh` lives on the leaf, not the module) plus the
 * concrete topics for the site's `operating_envelope` limits and this
 * device's own live reading (the control law ramps from the current value).
 * @param dtm The self-describing deployment manifest
 * @param deviceId The device this distribute binding lives on (the parent)
 * @param target The command's target — this device's own measurement of
 *     the same name (e.g. `active_power`) supplies `active_power_topic`
 * @param children Already-resolved children from resolveDistributeChildren
 * @returns Envelope-guard clamp bounds + the three concrete topics
 */
export function resolveEnvelopeGuard(
  dtm: DtmType,
  deviceId: string,
  target: string,
  children: DistributeChild[],
): EnvelopeGuardResolution {
  const power_min = children.reduce((sum, child) => sum + child.power_min, 0);
  const power_max = children.reduce((sum, child) => sum + child.power_max, 0);

  const envelopeDevice = dtm.devices[OPERATING_ENVELOPE_DEVICE_ID];
  if (!envelopeDevice) {
    throw new Error(
      `device ${deviceId}: distribute binding's envelope guard needs a device named "${OPERATING_ENVELOPE_DEVICE_ID}" in this deployment, none found`,
    );
  }
  const envelopeTpl = dtm.templates_used[envelopeDevice.template];
  if (!envelopeTpl) {
    throw new Error(
      `device ${deviceId}: ${OPERATING_ENVELOPE_DEVICE_ID}'s template ${envelopeDevice.template} not in catalog`,
    );
  }
  const importLimit = envelopeTpl.measurements.import_limit;
  const exportLimit = envelopeTpl.measurements.export_limit;
  if (!importLimit || !exportLimit) {
    throw new Error(
      `device ${deviceId}: distribute binding's envelope guard needs import_limit and export_limit on ${OPERATING_ENVELOPE_DEVICE_ID}'s template, none found`,
    );
  }

  const tpl = dtm.templates_used[dtm.devices[deviceId]!.template];
  const targetMeas = tpl?.measurements[target];
  if (!targetMeas) {
    throw new Error(
      `device ${deviceId}: distribute binding's envelope guard needs its own ${target} measurement, none found`,
    );
  }

  return {
    power_min,
    power_max,
    import_limit_topic: buildTopic(
      OPERATING_ENVELOPE_DEVICE_ID,
      "import_limit",
      importLimit.unit,
    ),
    export_limit_topic: buildTopic(
      OPERATING_ENVELOPE_DEVICE_ID,
      "export_limit",
      exportLimit.unit,
    ),
    active_power_topic: buildTopic(deviceId, target, targetMeas.unit),
  };
}
