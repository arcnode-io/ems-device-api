/**
 * Sanitized DTM projection consumed by HMI per system_adr §22.
 *
 * Strips gateway-only fields (`connection.*`, per-measurement `binding`,
 * per-measurement `publisher`, per-command `binding`/`fanout`) and inlines
 * per-template measurement metadata HMI needs (unit, display_name_default,
 * iec_61850_ref, bounds, thresholds, poll_rate_hz, enum values).
 *
 * HMI uses this for: module browser, parent-chain rollups, device-detail
 * routing, chart MIN/MAX threshold lines, Reading tone derivation, sim driver
 * bounds in demo mode, and IEC 61850 → SLD field mapping.
 */

import { PROVISIONED_AT_COMMISSIONING } from "./dtm.schema";
import type { DtmType, DeviceType, BusType } from "./dtm.schema";
import type {
  DeviceTemplateType,
  MeasurementType,
} from "../templates/template.schema";

const KWH_PER_MWH = 1000;

/** Per-measurement metadata projected for HMI consumption. */
export interface MeasurementView {
  unit: string;
  type: "float" | "bool" | "enum";
  poll_rate_hz: number | null;
  display_name_default: string | null;
  iec_61850_ref: string | null;
  bounds: MeasurementType["bounds"];
  thresholds: MeasurementType["thresholds"];
  values: MeasurementType["values"];
}

/** Per-template projection for HMI consumption. */
export interface DeviceTemplateView {
  template: string;
  kind: "leaf" | "module";
  equipment_id: string | null;
  vendor: string | null;
  model: string | null;
  description: string;
  measurements: Record<string, MeasurementView>;
  // Commands are listed by name + verb + target + unit + payload (no binding/fanout).
  commands: Record<
    string,
    {
      verb: string;
      target: string;
      unit: string;
      payload: "float" | "bool" | "enum" | "trigger";
      display_name_default: string | null;
    }
  >;
}

/** Per-device projection for HMI consumption. */
export interface DeviceView {
  device_id: string;
  template: string;
  parent: string | null;
  display_name: string | null;
  /**
   * False while this device is still awaiting a real address. The HMI renders
   * unprovisioned devices grey. True for a device with no connection at all — a
   * module has no address because it has no physical device, which is not the
   * same as awaiting one.
   */
  provisioned: boolean;
  extra_measurements: Record<string, MeasurementView> | null;
}

/** Site-wide BESS pack + reserve floor, derived once here for every consumer. */
export interface BessView {
  /** Total installed rack capacity, MWh. */
  pack_mwh: number;
  /** Islanding ride-through reserve held out of the pack, MWh. */
  reserve_floor_mwh: number;
  /** The floor as a percent of the pack, [0..100]. */
  reserve_floor_pct: number;
}

/** Full sanitized DTM projection — same top-level shape as DTM minus gateway fields. */
export interface DtmView {
  deployment_uuid: string;
  // HMI-facing name per its TopologyView schema (required enum there). The
  // DTM-internal field is `mode` (edp-api computed, optional); absent =
  // not-computed = not fully provisioned → default "sim".
  ems_mode: "sim" | "live";
  sizing_ref: string | null;
  sizing_params: DtmType["sizing_params"];
  devices: Record<string, DeviceView>;
  buses: BusType[];
  templates_used: Record<string, DeviceTemplateView>;
  bess: BessView | null;
}

/**
 * Whether a device has a real address yet.
 *
 * Reason: /topology/view strips connection fields, so the HMI can't otherwise
 * tell a device awaiting commissioning from one that's live. A null connection
 * counts as provisioned — a module device has no address because it has no
 * physical device, and greying a working synthetic aggregate would be wrong.
 * @param connection The device's connection block, or null
 * @returns False only when an address slot still holds the commissioning sentinel
 */
function isProvisioned(connection: DeviceType["connection"] | null): boolean {
  if (connection === null || connection === undefined) return true;
  return (
    connection.host !== PROVISIONED_AT_COMMISSIONING &&
    connection.port !== PROVISIONED_AT_COMMISSIONING
  );
}

/**
 * Project a Measurement onto its view (strip binding/publisher, keep metadata).
 * @param meas Raw catalog measurement
 * @returns View safe for customer-browser consumption
 */
function projectMeasurement(meas: MeasurementType): MeasurementView {
  return {
    unit: meas.unit,
    type: meas.type,
    poll_rate_hz: meas.poll_rate_hz,
    display_name_default: meas.display_name_default,
    iec_61850_ref: meas.iec_61850_ref,
    bounds: meas.bounds,
    thresholds: meas.thresholds,
    values: meas.values,
  };
}

/**
 * Project a DeviceTemplate onto its view (strip command binding/fanout).
 * @param tpl Raw catalog template
 * @returns View safe for customer-browser consumption
 */
function projectTemplate(tpl: DeviceTemplateType): DeviceTemplateView {
  const measurements: Record<string, MeasurementView> = {};
  for (const [name, meas] of Object.entries(tpl.measurements)) {
    measurements[name] = projectMeasurement(meas);
  }
  const commands: DeviceTemplateView["commands"] = {};
  for (const [name, cmd] of Object.entries(tpl.commands)) {
    commands[name] = {
      verb: cmd.verb,
      target: cmd.target,
      unit: cmd.unit,
      payload: cmd.payload,
      display_name_default: cmd.display_name_default,
    };
  }
  return {
    template: tpl.template,
    kind: tpl.kind,
    equipment_id: tpl.equipment_id,
    vendor: tpl.vendor,
    model: tpl.model,
    description: tpl.description,
    measurements,
    commands,
  };
}

/**
 * Project a Device onto its view (strip connection; sanitize extra_measurements).
 * @param dev Raw DTM device
 * @returns View safe for customer-browser consumption
 */
function projectDevice(dev: DeviceType): DeviceView {
  const extras: Record<string, MeasurementView> | null =
    dev.extra_measurements != null
      ? Object.fromEntries(
          Object.entries(dev.extra_measurements).map(([name, meas]) => [
            name,
            projectMeasurement(meas),
          ]),
        )
      : null;
  return {
    device_id: dev.device_id,
    template: dev.template,
    parent: dev.parent ?? null,
    display_name: dev.display_name ?? null,
    provisioned: isProvisioned(dev.connection ?? null),
    extra_measurements: extras,
  };
}

/**
 * Sum every instantiated rack's nameplate capacity and express the reserve
 * floor as a percent of it.
 *
 * Reason: `sizing_params.E_BESS_total_kWh` is a sizing input and can disagree
 * with the racks a DTM actually instantiates — the racks are what physically
 * exist, so they are the pack. The gateway clamps discharge against this same
 * percent (spec-rollup's `resolveStateOfChargeFloor`), so the number the HMI
 * shows and the number the plant enforces have to come from one derivation.
 * @param dtm Validated DTM as persisted
 * @returns Pack + floor, or null when no device carries rack capacity
 */
function projectBess(dtm: DtmType): BessView | null {
  let totalKwh = 0;
  for (const device of Object.values(dtm.devices)) {
    const capacity = dtm.templates_used[device.template]?.capacity_kwh;
    if (capacity) totalKwh += capacity;
  }
  if (totalKwh === 0) return null;

  const floorMwh = dtm.sizing_params.bess_reserve_floor_mwh;
  return {
    pack_mwh: totalKwh / KWH_PER_MWH,
    reserve_floor_mwh: floorMwh,
    reserve_floor_pct: ((floorMwh * KWH_PER_MWH) / totalKwh) * 100,
  };
}

/**
 * Project a full DTM onto its sanitized HMI-facing view.
 * @param dtm Validated DTM as persisted
 * @returns Sanitized projection per system_adr §22
 */
export function projectDtmToView(dtm: DtmType): DtmView {
  const devices: Record<string, DeviceView> = {};
  for (const [id, dev] of Object.entries(dtm.devices)) {
    devices[id] = projectDevice(dev);
  }
  const templates: Record<string, DeviceTemplateView> = {};
  for (const [slug, tpl] of Object.entries(dtm.templates_used)) {
    templates[slug] = projectTemplate(tpl);
  }
  return {
    deployment_uuid: dtm.deployment_uuid,
    ems_mode: dtm.mode ?? "sim",
    sizing_ref: dtm.sizing_ref ?? null,
    sizing_params: dtm.sizing_params,
    devices,
    buses: dtm.buses,
    templates_used: templates,
    bess: projectBess(dtm),
  };
}
