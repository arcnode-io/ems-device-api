/**
 * Phase I children resolution — compiles a device's `synthetic` binding
 * `source_measurement` mode and a `distribute` binding's implicit children
 * into the concrete topics/values the gateway consumes. Both walk `parent`
 * on the DTM (ADR-002's module→children relationship) so the gateway never
 * does any DTM-walking itself — it only ever sees fully-resolved data.
 */

import { z } from "zod";
import type { DtmType, DeviceType } from "../topology/dtm.schema";
import type { DeviceTemplateType } from "../templates/template.schema";
import { MEASUREMENT_ADDRESS } from "./spec-channels";

/**
 * One resolved {topic, weight} pair for a `weighted_mean` aggregation. A
 * real Zod schema (not just a TS type) so spec-contract.ts can compose it
 * into the published x-protocol-source JSON Schema without a second,
 * hand-maintained copy of this shape.
 */
export const WeightedPair = z.strictObject({
  topic: z.string(),
  weight: z.number(),
});
export type WeightedPairType = z.infer<typeof WeightedPair>;

/**
 * One resolved child entry for a `distribute` binding's allocation. A real
 * Zod schema for the same reason as {@link WeightedPair}.
 */
export const DistributeChild = z.strictObject({
  device_id: z.string(),
  operating_state_topic: z.string(),
  state_of_charge_topic: z.string(),
  power_min: z.number(),
  power_max: z.number(),
});
export type DistributeChildType = z.infer<typeof DistributeChild>;

/** One child cap a `power_cap` command fans out to. */
export const PowerCapChild = z.strictObject({
  device_id: z.string(),
  target: z.string(),
  min_w: z.number(),
  max_w: z.number(),
});
export type PowerCapChildType = z.infer<typeof PowerCapChild>;

/** Resolved reserve-floor field for a `distribute` binding — see resolveStateOfChargeFloor. */
export type StateOfChargeFloorResolution = {
  state_of_charge_floor_percent?: number;
};

/** Resolved operator-reserve fields for a `distribute` binding — see resolveOperatorReserve. */
export type OperatorReserveResolution = {
  operator_reserve_topic?: string;
  site_capacity_wh?: number;
};

/** Resolved readiness fields for a `distribute` binding — see resolveReadiness. */
export type ReadinessResolution = {
  readiness_soc_percent?: number;
  recharge_power_w?: number;
};

/** Resolved envelope-guard fields for a `distribute` binding — see resolveEnvelopeGuard. */
export type EnvelopeGuardResolution = {
  power_min: number;
  power_max: number;
  import_limit_topic: string;
  export_limit_topic: string;
  active_power_topic: string;
  poi_active_power_topic: string;
};

/** Well-known singleton DOE device id — same convention already hardcoded in bess_module's own import_headroom/export_headroom inputs[]. */
const OPERATING_ENVELOPE_DEVICE_ID = "operating_envelope";
const DER_DISPATCH_DEVICE_ID = "der_dispatch";
const OPERATOR_RESERVE_MEASUREMENT = "operator_reserve";

/**
 * The connection-point meter's template slug. Resolved by template rather than
 * by a well-known device_id, unlike the envelope above: meter ids vary per
 * deployment (edp-api emits `poi_meter_1`, platform's fixture uses `meter_01`).
 */
const POI_METER_TEMPLATE = "poi_meter";

/**
 * Find every device whose `parent` is `deviceId`, sorted by device_id for
 * deterministic output order.
 * @param dtm The self-describing deployment manifest
 * @param deviceId The parent device's id
 * @param childTemplateSlug Only children instantiating this template, or every
 *     child when omitted. A module's children are heterogeneous, so a caller
 *     that needs one kind says which.
 * @returns This device's children, sorted by device_id
 */
export function resolveChildren(
  dtm: DtmType,
  deviceId: string,
  childTemplateSlug?: string | null,
): DeviceType[] {
  return Object.values(dtm.devices)
    .filter((device) => device.parent === deviceId)
    .filter(
      (device) =>
        childTemplateSlug == null || device.template === childTemplateSlug,
    )
    .sort((deviceA, deviceB) =>
      deviceA.device_id.localeCompare(deviceB.device_id),
    );
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
function buildTopic(
  deviceId: string,
  measurement: string,
  unit: string,
): string {
  return MEASUREMENT_ADDRESS.replace("{device_id}", deviceId)
    .replace("{measurement}", measurement)
    .replace("{unit}", unit);
}

/**
 * Resolve a `synthetic` binding's `source_measurement` mode into concrete
 * `inputs` (sum/mean/max/min) or `pairs` (weighted_mean, weighted by each
 * child's `capacity_kwh`) across the children of `deviceId` that
 * `child_template` names, or across every child when it names none. Fails loud
 * if such a child's template is missing the named measurement, or —
 * weighted_mean only — missing `capacity_kwh`, and fails loud when the filter
 * matches no children at all.
 * @param dtm The self-describing deployment manifest
 * @param deviceId The device this synthetic binding lives on (the parent)
 * @param sourceMeasurement The measurement name to project across children
 * @param operation The synthetic binding's operation
 * @param childTemplateSlug Roll up only children instantiating this template,
 *     or every child when omitted
 * @returns `{inputs}` for sum/mean/max/min, `{pairs}` for weighted_mean
 */
export function resolveSourceMeasurement(
  dtm: DtmType,
  deviceId: string,
  sourceMeasurement: string,
  operation: string,
  childTemplateSlug?: string | null,
): { inputs: string[] } | { pairs: WeightedPairType[] } {
  const children = resolveChildren(dtm, deviceId, childTemplateSlug);
  if (children.length === 0) {
    throw new Error(
      `device ${deviceId}: source_measurement "${sourceMeasurement}" rolls up ` +
        `${childTemplateSlug == null ? "its children" : `children of template "${childTemplateSlug}"`}, but none were found`,
    );
  }

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
): DistributeChildType[] {
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
 * Resolve a `power_cap` binding's children: one entry per (child of
 * `child_template`, listed command), carrying the watt range that command may
 * be driven across.
 *
 * Reason the range comes from the child's measurement rather than the command:
 * the command's `target` names a measurement on the child, and that
 * measurement's bounds are the hardware's own limit — one fact in one place,
 * rather than a range restated on every command that could disagree with it.
 * @param dtm The self-describing deployment manifest
 * @param deviceId The module this power_cap binding lives on
 * @param childTemplateSlug Only children of this template are capped
 * @param childCommands The command names on each child that are its knobs
 * @returns One resolved child cap per (child, command)
 * @throws Error when no such children exist, a child lacks a listed command,
 *     or the measurement that command targets carries no bounds
 */
export function resolvePowerCapChildren(
  dtm: DtmType,
  deviceId: string,
  childTemplateSlug: string,
  childCommands: readonly string[],
): PowerCapChildType[] {
  const children = resolveChildren(dtm, deviceId, childTemplateSlug);
  if (children.length === 0) {
    throw new Error(
      `device ${deviceId}: power_cap binding caps children of template "${childTemplateSlug}", but none are parented under it`,
    );
  }
  return children.flatMap((child) => {
    const tpl = childTemplate(dtm, child);
    return childCommands.map((commandName) => {
      const cmd = tpl.commands[commandName];
      if (!cmd) {
        throw new Error(
          `device ${deviceId}: power_cap binding lists command "${commandName}", not found on child ${child.device_id}'s template (${child.template})`,
        );
      }
      const bounds = tpl.measurements[cmd.target]?.bounds;
      if (!bounds) {
        throw new Error(
          `device ${deviceId}: power_cap binding needs ${cmd.target}.bounds on child ${child.device_id}'s template (${child.template}), none found`,
        );
      }
      return {
        device_id: child.device_id,
        target: cmd.target,
        min_w: bounds.min,
        max_w: bounds.max,
      };
    });
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
  children: DistributeChildType[],
): EnvelopeGuardResolution {
  const power_min = children.reduce((sum, child) => sum + child.power_min, 0);
  const power_max = children.reduce((sum, child) => sum + child.power_max, 0);

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
    ...resolveEnvelopeTopics(dtm, deviceId),
    active_power_topic: buildTopic(deviceId, target, targetMeas.unit),
  };
}

/**
 * The three topics any envelope guard watches: the site's two limits and the
 * connection-point reading they constrain.
 *
 * Reason this is shared rather than duplicated: a distribute guard and a
 * power_cap guard watch the same envelope, and two copies of the topic
 * construction could drift so that storage and compute were constrained by
 * different-looking versions of one limit.
 * @param dtm The self-describing deployment manifest
 * @param deviceId The device whose guard is being resolved, for error context
 * @returns The envelope's import/export limit topics and the POI reading topic
 * @throws Error when the deployment carries no operating_envelope device, its
 *     template is absent from the catalog, or it declares no limits
 */
export function resolveEnvelopeTopics(
  dtm: DtmType,
  deviceId: string,
): {
  import_limit_topic: string;
  export_limit_topic: string;
  poi_active_power_topic: string;
} {
  const envelopeDevice = dtm.devices[OPERATING_ENVELOPE_DEVICE_ID];
  if (!envelopeDevice) {
    throw new Error(
      `device ${deviceId}: envelope guard needs a device named "${OPERATING_ENVELOPE_DEVICE_ID}" in this deployment, none found`,
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
      `device ${deviceId}: envelope guard needs import_limit and export_limit on ${OPERATING_ENVELOPE_DEVICE_ID}'s template, none found`,
    );
  }
  return {
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
    poi_active_power_topic: resolvePoiActivePowerTopic(dtm, deviceId),
  };
}

/**
 * Resolve the connection-point meter's `active_power` topic.
 *
 * Reason: the envelope's limits are limits on active power at the connection
 * point (CSIP-AUS), so the control law has to compare them against POI net power
 * rather than the battery's own output. Comparing against the battery alone
 * treats it as the only asset at the POI, which makes a zero export limit clamp
 * every discharge to zero even when the site is importing.
 *
 * Throws rather than returning nothing when the meter is missing: callers check
 * {@link envelopeAvailable} first and leave the guard out, so reaching this
 * without a meter is a caller bug, not a deployment shape.
 * @param dtm The self-describing deployment manifest
 * @param deviceId The device this distribute binding lives on (the parent)
 * @returns The meter's concrete `active_power` topic
 */
function resolvePoiActivePowerTopic(dtm: DtmType, deviceId: string): string {
  const meterId = resolvePoiMeterDeviceId(
    dtm,
    `device ${deviceId}: distribute binding's envelope guard`,
  );
  const activePower =
    dtm.templates_used[dtm.devices[meterId]!.template]?.measurements
      .active_power;
  if (!activePower) {
    throw new Error(
      `device ${deviceId}: distribute binding's envelope guard needs an active_power measurement on ${meterId}'s template (${POI_METER_TEMPLATE}), none found`,
    );
  }
  return buildTopic(meterId, "active_power", activePower.unit);
}

/**
 * The device_id of this deployment's single connection-point meter.
 *
 * Resolved by template slug rather than by a well-known device_id, because meter
 * ids vary per deployment (edp-api emits `poi_meter_1`, platform's fixture uses
 * `meter_01`) and neither should have to change for resolution to work.
 *
 * Throws rather than returning nothing: a caller that can live without the
 * meter checks for one first (see {@link envelopeAvailable}); one that reaches
 * this needs it, and two meters are ambiguous either way.
 * @param dtm The self-describing deployment manifest
 * @param context Caller-supplied error prefix naming what needed the meter
 * @returns The meter's device_id
 */
export function resolvePoiMeterDeviceId(dtm: DtmType, context: string): string {
  const meters = Object.values(dtm.devices).filter(
    (device) => device.template === POI_METER_TEMPLATE,
  );
  if (meters.length === 0) {
    throw new Error(
      `${context} needs a device on the "${POI_METER_TEMPLATE}" template in this deployment, none found`,
    );
  }
  if (meters.length > 1) {
    throw new Error(
      `${context} found more than one "${POI_METER_TEMPLATE}" device (${meters.map((found) => found.device_id).join(", ")}) — which one bounds the envelope is ambiguous`,
    );
  }
  return meters[0]!.device_id;
}

/**
 * Whether this deployment can be envelope-guarded at all: it needs the site's
 * operating_envelope device and a connection-point meter to compare against.
 * @param dtm The self-describing deployment manifest
 * @returns true when both exist
 */
export function envelopeAvailable(dtm: DtmType): boolean {
  const hasEnvelope = dtm.devices[OPERATING_ENVELOPE_DEVICE_ID] !== undefined;
  const hasMeter = Object.values(dtm.devices).some(
    (device) => device.template === POI_METER_TEMPLATE,
  );
  return hasEnvelope && hasMeter;
}

/** kWh in one MWh — sizing_params states the reserve in MWh, rack capacity is kWh. */
const KWH_PER_MWH = 1000;

/**
 * Resolve a `distribute` binding's BESS reserve floor into a per-rack state-of-charge
 * percent. The gateway compares this against each child's own cached
 * `state_of_charge` reading, which is already a percent, so no unit conversion
 * happens at enforcement time.
 *
 * One percent applies to every rack, which is what makes the rack reserves sum
 * to the site floor even when racks differ in capacity:
 * `sum(pct/100 * capacity_i) = pct/100 * sum(capacity_i)`. Enforcing it per rack
 * is stricter than a site-level aggregate — holding every rack at or above the
 * floor keeps the site total at or above the reserve at every instant, whereas a
 * site-level check would let one rack drain past its share.
 *
 * Every `distribute` binding already requires `state_of_charge` on each child, so
 * a child without `capacity_kwh` is a malformed battery rather than a non-battery
 * device, and is rejected rather than quietly left without a floor.
 * @param dtm The self-describing deployment manifest
 * @param deviceId The device this distribute binding lives on (the parent)
 * @returns The floor as a percent, or `{}` when no reserve is configured
 */
export function resolveStateOfChargeFloor(
  dtm: DtmType,
  deviceId: string,
): StateOfChargeFloorResolution {
  const floorMwh = dtm.sizing_params.bess_reserve_floor_mwh;
  if (!floorMwh) return {};

  let totalKwh = 0;
  for (const child of resolveChildren(dtm, deviceId)) {
    const tpl = dtm.templates_used[child.template];
    if (!tpl) {
      throw new Error(
        `device ${deviceId}: child ${child.device_id}'s template ${child.template} not in catalog`,
      );
    }
    if (tpl.capacity_kwh === null) {
      throw new Error(
        `device ${deviceId}: reserve floor requires capacity_kwh on child ${child.device_id}'s template (${child.template}), but it's null`,
      );
    }
    totalKwh += tpl.capacity_kwh;
  }
  if (totalKwh === 0) {
    throw new Error(
      `device ${deviceId}: sizing_params sets bess_reserve_floor_mwh ${floorMwh} but this device has no child capacity to reserve it from`,
    );
  }

  const percent = ((floorMwh * KWH_PER_MWH) / totalKwh) * 100;
  if (percent > 100) {
    throw new Error(
      `device ${deviceId}: bess_reserve_floor_mwh ${floorMwh} exceeds total rack capacity ${totalKwh} kWh (${percent}% state of charge)`,
    );
  }
  return { state_of_charge_floor_percent: percent };
}

/**
 * Resolve how much energy the site must hold ready, and the rate it may charge at.
 *
 * Both come from edp-api's sizing of the contracted flex obligation: readiness is the islanding
 * ride-through floor plus the curtailment-response energy, and the recharge rate is what refills
 * the latter inside the minimum interval between events. Derived rather than operator-set, so the
 * number the plant is asked to hold is the number it was sold; `operator_reserve` already covers
 * an operator wanting to hold more.
 *
 * The target is a percent of installed capacity, not energy, because every SoC threshold a
 * consumer already holds is one — the supplier floor and the operator reserve both end up as a
 * percent compared against a module's own `state_of_charge`. Dividing the site obligation by site
 * capacity here means a consumer needs no capacity of its own to compare against, and the figure
 * is the same for every module: a module's share of the obligation is proportional to its
 * capacity, and its published SoC is its racks' capacity-weighted mean, so the ratio cancels.
 *
 * The rate is watts and genuinely is each module's own share — N modules each charging at the
 * site rate would import N times what the site was sized for.
 *
 * Both fields are omitted together when there is nothing actionable: no readiness target, no rate
 * to reach it, or no capacity-bearing device. Absent must mean no charging, because that is the
 * behaviour of every deployment that predates this and shipping it cannot start a site importing
 * power nobody asked for.
 * @param dtm The self-describing deployment manifest
 * @param children The module's own resolved children, whose capacity sets its share of the rate
 * @returns The readiness percent and recharge power, or `{}`
 */
export function resolveReadiness(
  dtm: DtmType,
  children: DistributeChildType[],
): ReadinessResolution {
  const readinessMwh = dtm_readiness(dtm);
  const rechargeMw = dtm.sizing_params.bess_recharge_mw;
  if (!readinessMwh || !rechargeMw) return {};

  const capacityOf = (deviceId: string): number =>
    dtm.templates_used[dtm.devices[deviceId]?.template ?? ""]?.capacity_kwh ??
    0;

  let siteKwh = 0;
  for (const deviceId of Object.keys(dtm.devices))
    siteKwh += capacityOf(deviceId);
  let moduleKwh = 0;
  for (const child of children) moduleKwh += capacityOf(child.device_id);
  if (siteKwh === 0 || moduleKwh === 0) return {};

  // Reason: clamped rather than rejected. The floor resolver throws when its target exceeds rack
  // capacity, but that checks sizing_params against itself; this lands against a rack list
  // commissioning edits by hand, so an obligation larger than the racks installed so far is a
  // half-built site, not a bad manifest. Charge to full and let the racks' own limits bound it.
  const percent = Math.min(((readinessMwh * KWH_PER_MWH) / siteKwh) * 100, 100);
  return {
    readiness_soc_percent: percent,
    // Reason: this module's share of the rate, not the site total. power_min/power_max on the
    // same binding are already the sum of this module's own children, so an unprefixed field
    // here is module-scoped by convention — site_capacity_wh says "site" precisely because it
    // is the exception.
    recharge_power_w: (rechargeMw * 1_000_000 * moduleKwh) / siteKwh,
  };
}

/**
 * The site's readiness target in MWh, or 0 when it has none.
 * @param dtm The self-describing deployment manifest
 * @returns Readiness energy in MWh
 */
function dtm_readiness(dtm: DtmType): number {
  return dtm.sizing_params.bess_readiness_mwh;
}

/**
 *
 * @param dtm
 */
/**
 * Where the operator's energy reserve is published, and the site capacity it is a fraction of.
 *
 * The reserve is a soft floor an operator sets on top of the supplier's own warranty-derived one;
 * a consumer takes the greater of the two, so it can tighten what storage will spend but never
 * relax it. It is site-wide energy, so a consumer converts it to a per-module percentage against
 * total installed capacity — every rack then holds back the same fraction and keeps its
 * proportional share, with no cross-module arithmetic.
 *
 * Capacity is emitted in watt-hours to match the channel, rather than the `capacity_kwh` the
 * templates author it in: the conversion happens once here, where the unit is unambiguous, instead
 * of in every consumer.
 *
 * Both fields are omitted together when there is nothing to resolve — no der_dispatch device, no
 * `operator_reserve` on its template, or no capacity-bearing device. A deployment without storage
 * simply has no operator reserve, which is not an error.
 * @param dtm The self-describing deployment manifest
 * @returns The topic and site capacity, or `{}` when either cannot be determined
 */
export function resolveOperatorReserve(
  dtm: DtmType,
): OperatorReserveResolution {
  const dispatch = dtm.devices[DER_DISPATCH_DEVICE_ID];
  const dispatchTpl = dispatch
    ? dtm.templates_used[dispatch.template]
    : undefined;
  const reserve = dispatchTpl?.measurements[OPERATOR_RESERVE_MEASUREMENT];
  if (!reserve) return {};

  let totalKwh = 0;
  for (const device of Object.values(dtm.devices)) {
    const capacity = dtm.templates_used[device.template]?.capacity_kwh;
    if (capacity) totalKwh += capacity;
  }
  if (totalKwh === 0) return {};

  return {
    operator_reserve_topic: buildTopic(
      DER_DISPATCH_DEVICE_ID,
      OPERATOR_RESERVE_MEASUREMENT,
      reserve.unit,
    ),
    site_capacity_wh: totalKwh * 1000,
  };
}
