/**
 * x-* extensions for the AsyncAPI v3 spec.
 *
 * - `x-protocol-source` — keyed by `device_id` -> `channel_name`, carries
 *   the Modbus/SNMP/etc. binding metadata a poll loop needs to translate raw
 *   protocol values to engineering units. Measurements only. Lives at top
 *   level (not per-channel) because channels are templated and bindings are
 *   per-instance.
 * - `x-command-source` — commands only, kept as its own map rather than
 *   merged with `x-protocol-source`: a command's binding (e.g. a Modbus
 *   write register) is never something to poll, and a consumer walking one
 *   map has no way to accidentally pick up the other. Entries carry `verb`
 *   and `target` explicitly, because a command arrives over MQTT addressed
 *   by `commands/{verb}/{target}/{unit}` — the wire never carries the
 *   template's own command name, so a consumer resolving a topic to an
 *   entry needs verb+target as real fields, not a name it has to guess.
 * - `x-enum-values` — keyed by `${template}.${measurement}`, lists the
 *   allowed string labels for enum measurements. Template-scoped (not
 *   per-instance) because enum vocabulary is a template-level contract.
 *
 * Per ADR-002 §4, bindings live ON each measurement/command in the canonical
 * template schema. Extensions here project them from the DTM's self-describing
 * `templates_used` map.
 */

import { PROVISIONED_AT_COMMISSIONING } from "../topology/dtm.schema";
import type { DtmType } from "../topology/dtm.schema";
import type {
  DeviceTemplateType,
  BindingType,
  AlarmType,
} from "../templates/template.schema";
import {
  resolveSourceMeasurement,
  resolveDistributeChildren,
  resolveEnvelopeGuard,
  resolvePoiMeterDeviceId,
  resolveStateOfChargeFloor,
  type WeightedPairType,
  type DistributeChildType,
} from "./spec-rollup";

/** Stands in for the deployment's connection-point meter id, which varies per site. */
const POI_METER_PLACEHOLDER = "{poi_meter_device_id}";

/** Per-device, per-channel protocol source map. */
export type ProtocolSourceMap = Record<string, Record<string, unknown>>;

/** Per-device, per-channel command source map — entries additionally carry verb + target. */
export type CommandSourceMap = Record<string, Record<string, unknown>>;

/** Per-template enum vocabulary map. */
export type EnumValuesMap = Record<string, readonly string[]>;

/** Per-device alarm catalog map — keyed by device_id -> alarms[]. */
export type AlarmsMap = Record<string, readonly AlarmType[]>;

/**
 * Walk every device in the DTM, look up its template in `templates_used`,
 * and project each measurement's `binding` field into a per-device,
 * per-channel-name map. Each entry merges the template's binding with the
 * device's `connection` block (host/port/unit_id) so consumers have
 * everything needed to drive the protocol in one place.
 * Only entries with an explicit `binding` field are emitted; measurements
 * with `publisher` (module-level aggregates) are skipped.
 * @param dtm The self-describing deployment manifest
 * @returns Map keyed by `device_id` -> `channel_name` -> binding + connection
 */
export function buildProtocolSourceMap(dtm: DtmType): ProtocolSourceMap {
  return buildSourceMap(dtm, collectMeasurementBindings);
}

/**
 * The command-side mirror of {@link buildProtocolSourceMap} — same
 * per-device/per-channel-name keying, commands only, entries carry `verb`
 * and `target` (see the module docblock for why). Devices with a bound
 * command reuse the same device_id key as their `x-protocol-source` entry
 * if they have one.
 * @param dtm The self-describing deployment manifest
 * @returns Map keyed by `device_id` -> `channel_name` -> binding + connection + verb + target
 */
export function buildCommandSourceMap(dtm: DtmType): CommandSourceMap {
  const out: CommandSourceMap = {};
  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const tpl = dtm.templates_used[device.template];
    if (!tpl) continue;
    if (isUnprovisioned(device.connection ?? null)) continue;
    const entries = collectCommandBindings(
      dtm,
      tpl,
      device.connection ?? null,
      deviceId,
    );
    if (Object.keys(entries).length > 0) out[deviceId] = entries;
  }
  return out;
}

/**
 * Shared device-walk for building {@link buildProtocolSourceMap}.
 * @param dtm The self-describing deployment manifest
 * @param collect Per-template channel collector — the only thing that
 *     differs between the measurement and command source maps
 * @returns Map keyed by `device_id` -> `channel_name` -> whatever `collect` returned
 */
function buildSourceMap(
  dtm: DtmType,
  collect: (
    dtm: DtmType,
    tpl: DeviceTemplateType,
    connection: ConnectionFields,
    deviceId: string,
  ) => Record<string, ProtocolSourceEntry>,
): ProtocolSourceMap {
  const out: ProtocolSourceMap = {};
  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const tpl = dtm.templates_used[device.template];
    if (!tpl) continue;
    if (isUnprovisioned(device.connection ?? null)) continue;
    const entries = collect(dtm, tpl, device.connection ?? null, deviceId);
    if (Object.keys(entries).length > 0) out[deviceId] = entries;
  }
  return out;
}

/**
 * True when a device is still awaiting commissioning: it has a connection block,
 * but the address slot carries the sentinel instead of a real host or port.
 *
 * Reason: a null connection is a different thing and must not be skipped. A
 * module device has no address because it has no physical device, and its
 * synthetic measurements are computed by the gateway from topics. An
 * unprovisioned device has an address nobody has filled in yet, and advertising
 * it as pollable makes the gateway resolve a host literally named
 * PROVISIONED_AT_COMMISSIONING and dial the same string as a port.
 * @param connection The device's connection block, or null
 * @returns Whether the device is awaiting an address
 */
function isUnprovisioned(connection: ConnectionFields): boolean {
  if (connection === null) return false;
  return (
    connection.host === PROVISIONED_AT_COMMISSIONING ||
    connection.port === PROVISIONED_AT_COMMISSIONING
  );
}

/** Per-device connection block (host/port/unit_id), nullable for module devices. */
type ConnectionFields = {
  host: string;
  port: number | string;
  unit_id?: string | null;
} | null;

/**
 * Channel-level metadata merged into every protocol-source entry so the
 * gateway can drive the read loop (`poll_rate_hz`) and pick the right MQTT
 * topic suffix (`unit`) from a single map entry.
 */
type ChannelMeta = {
  unit: string;
  poll_rate_hz?: number | null;
};

/**
 * Resolved `source_measurement` mode output — never present on the raw
 * template binding, only on the compiled entry the gateway sees.
 */
type ResolvedRollupFields = { pairs?: WeightedPairType[] };

/** Fully merged map entry: binding ∪ connection ∪ channel meta ∪ resolved rollup fields. */
type ProtocolSourceEntry = BindingType &
  ConnectionFields &
  ChannelMeta &
  ResolvedRollupFields;

/**
 * A command's verb + target — the two things an inbound `commands/{verb}/
 * {target}/{unit}` topic actually carries, so a consumer can resolve the
 * right entry without knowing (or guessing) the template's command name.
 */
type CommandIdentity = { verb: string; target: string };

/**
 * Resolved `distribute` binding output — never present on the raw template
 * binding, only on the compiled entry the gateway sees. Envelope-guard
 * fields (power_min/power_max/the three topics) are only present when the
 * binding itself carries the ramp/hysteresis numbers.
 */
type ResolvedDistributeFields = {
  children?: DistributeChildType[];
  power_min?: number;
  power_max?: number;
  import_limit_topic?: string;
  export_limit_topic?: string;
  active_power_topic?: string;
};

/** Fully merged command entry: binding ∪ connection ∪ unit ∪ verb/target ∪ resolved distribute fields. */
type CommandSourceEntry = BindingType &
  ConnectionFields & { unit: string } & CommandIdentity &
  ResolvedDistributeFields;

/**
 * The connection fields a given protocol actually uses.
 *
 * Reason: unit_id is the Modbus slave id and means nothing to Redfish, SNMP,
 * DNP3 or BACnet, so stamping it on those entries advertises a field their
 * binding doesn't model. A field that is present but ignored is the same shape
 * as the bugs that strictness exists to catch — the gateway is setting
 * serde(deny_unknown_fields) on its binding structs, and this keeps our output
 * exactly what each binding declares.
 * @param conn The device's merged connection fields
 * @param protocol The binding's protocol
 * @returns conn, minus unit_id for every protocol but modbus_tcp
 */
function connectionFor(
  conn: ConnectionFields,
  protocol: string,
): ConnectionFields {
  // Reason: synthetic and distribute are computed from MQTT topics, not dialled
  // over a south protocol, so host/port are meaningless on them — the gateway's
  // SyntheticBinding and DistributeBinding model neither. A device can carry
  // both kinds at once (gpu_node polls Redfish per GPU and sums them
  // synthetically), so this can't be inferred from the device having no
  // connection.
  if (protocol === "synthetic" || protocol === "distribute") return null;
  if (conn === null || protocol === "modbus_tcp") return conn;
  const rest = { ...conn };
  delete rest.unit_id;
  return rest;
}

/**
 * Collect all binding-bearing measurements from a template, merging in the
 * device's connection (host/port/unit_id) plus channel meta (`unit`,
 * `poll_rate_hz`) so consumers see the complete protocol-instance picture in
 * one entry. For synthetic bindings, substitute `{device_id}` in the
 * `inputs[]` array with the instantiating `deviceId`. `{site_id}` stays
 * unresolved — gateway substitutes from its deployment config at runtime.
 * Synthetic bindings in `source_measurement` mode are resolved separately
 * (see spec-rollup.ts), which is why this needs the whole `dtm`.
 * @param dtm The self-describing deployment manifest
 * @param tpl Validated DeviceTemplate with measurements
 * @param connection Device-level connection block (host/port/unit_id), or null
 * @param deviceId The instantiating device's id, used for `{device_id}` substitution
 * @returns Map of channel name -> binding + connection + channel meta
 */
function collectMeasurementBindings(
  dtm: DtmType,
  tpl: DeviceTemplateType,
  connection: ConnectionFields,
  deviceId: string,
): Record<string, ProtocolSourceEntry> {
  const out: Record<string, ProtocolSourceEntry> = {};
  const conn = connection ?? ({} as ConnectionFields);
  for (const [name, meas] of Object.entries(tpl.measurements)) {
    if (meas.binding === null || meas.binding === undefined) continue;

    if (
      meas.binding.protocol === "synthetic" &&
      meas.binding.source_measurement
    ) {
      const resolved = resolveSourceMeasurement(
        dtm,
        deviceId,
        meas.binding.source_measurement,
        meas.binding.operation,
      );
      out[name] = {
        ...connectionFor(conn, "synthetic"),
        protocol: "synthetic",
        operation: meas.binding.operation,
        ...resolved,
        unit: meas.unit,
        poll_rate_hz: meas.poll_rate_hz,
      } as ProtocolSourceEntry;
      continue;
    }

    const resolvedBinding = resolveDeviceIdPlaceholder(
      meas.binding,
      deviceId,
      dtm,
    );
    out[name] = {
      ...connectionFor(conn, resolvedBinding.protocol),
      ...resolvedBinding,
      unit: meas.unit,
      poll_rate_hz: meas.poll_rate_hz,
    } as ProtocolSourceEntry;
  }
  return out;
}

/**
 * Collect all binding-bearing commands from a template — the command-side
 * mirror of {@link collectMeasurementBindings}, kept in its own map rather
 * than merged with measurements. A consumer that walks `x-protocol-source`
 * to spawn read-poll tasks must never see a write-only command channel;
 * this keeps that true by construction rather than by a filter someone has
 * to remember to write. Entries carry `verb`/`target` (not just the
 * template's own command name as the map key) because that's what an
 * inbound command topic actually addresses — a name like `approve_dispatch`
 * doesn't derive from its `verb: enable, target: event_active` pair, so a
 * consumer resolving a topic needs the real fields, not a guess. Distribute
 * bindings are resolved separately (see spec-rollup.ts), which is why this
 * needs the whole `dtm`.
 * @param dtm The self-describing deployment manifest
 * @param tpl Validated DeviceTemplate with commands
 * @param connection Device-level connection block (host/port/unit_id), or null
 * @param deviceId The instantiating device's id, used for `{device_id}` substitution
 * @returns Map of channel name -> binding + connection + verb + target
 */
function collectCommandBindings(
  dtm: DtmType,
  tpl: DeviceTemplateType,
  connection: ConnectionFields,
  deviceId: string,
): Record<string, CommandSourceEntry> {
  const out: Record<string, CommandSourceEntry> = {};
  const conn = connection ?? ({} as ConnectionFields);
  for (const [name, cmd] of Object.entries(tpl.commands)) {
    if (cmd.binding === null || cmd.binding === undefined) continue;

    if (cmd.binding.protocol === "distribute") {
      const children = resolveDistributeChildren(
        dtm,
        deviceId,
        cmd.verb,
        cmd.target,
      );
      const envelopeGuard =
        cmd.binding.ramp_rate_per_sec !== undefined
          ? resolveEnvelopeGuard(dtm, deviceId, cmd.target, children)
          : {};
      const socFloor = resolveStateOfChargeFloor(dtm, deviceId);
      out[name] = {
        ...connectionFor(conn, "distribute"),
        protocol: "distribute",
        allocation_policy: cmd.binding.allocation_policy,
        ramp_rate_per_sec: cmd.binding.ramp_rate_per_sec,
        hysteresis_margin: cmd.binding.hysteresis_margin,
        hysteresis_dwell_secs: cmd.binding.hysteresis_dwell_secs,
        children,
        ...envelopeGuard,
        ...socFloor,
        unit: cmd.unit,
        verb: cmd.verb,
        target: cmd.target,
      } as CommandSourceEntry;
      continue;
    }

    const resolvedBinding = resolveDeviceIdPlaceholder(
      cmd.binding,
      deviceId,
      dtm,
    );
    out[name] = {
      ...connectionFor(conn, resolvedBinding.protocol),
      ...resolvedBinding,
      unit: cmd.unit,
      verb: cmd.verb,
      target: cmd.target,
    } as CommandSourceEntry;
  }
  return out;
}

/**
 * Substitute device placeholders in synthetic binding `inputs[]`: `{device_id}`
 * with the instantiating device's id, `{poi_meter_device_id}` with the
 * deployment's connection-point meter. Non-synthetic bindings, and synthetic
 * bindings in `source_measurement` mode (no static `inputs[]` to substitute
 * into — that resolution is separate, children-walking logic), pass through
 * unchanged. `{site_id}` stays unresolved for gateway runtime substitution.
 * @param binding Binding from a measurement or command
 * @param deviceId The instantiating device's id
 * @param dtm The self-describing deployment manifest, for the meter lookup
 * @returns Binding with synthetic.inputs[] resolved if applicable
 */
function resolveDeviceIdPlaceholder(
  binding: BindingType,
  deviceId: string,
  dtm: DtmType,
): BindingType {
  if (binding.protocol !== "synthetic" || !binding.inputs) return binding;
  const inputs = binding.inputs.map((topic) => {
    const withDevice = topic.replace(/\{device_id\}/g, deviceId);
    // Reason: resolved lazily, so a deployment with no POI meter only fails on
    // templates that actually reference one.
    if (!withDevice.includes(POI_METER_PLACEHOLDER)) return withDevice;
    return withDevice.replaceAll(
      POI_METER_PLACEHOLDER,
      resolvePoiMeterDeviceId(dtm, `device ${deviceId}: synthetic input`),
    );
  });
  assertNoUnresolvedPlaceholders(inputs, deviceId);
  return { ...binding, inputs };
}

/**
 * Fail generation on any `{…}` left in a synthetic input besides `{site_id}`,
 * which the gateway fills from its own deployment config.
 *
 * Reason: an unsubstituted placeholder is not a runtime error anywhere. The
 * gateway subscribes to the literal topic, it never matches, and the synthetic
 * measurement holds forever with nothing logged. A build error is the only place
 * this class of bug is visible.
 * @param inputs Synthetic input topics, after substitution
 * @param deviceId The instantiating device's id, for the error message
 * @throws Error naming the topic and the placeholders nobody resolved
 */
function assertNoUnresolvedPlaceholders(
  inputs: string[],
  deviceId: string,
): void {
  for (const topic of inputs) {
    const leftover = (topic.match(/\{[^}]+\}/g) ?? []).filter(
      (placeholder) => placeholder !== "{site_id}",
    );
    if (leftover.length > 0) {
      throw new Error(
        `device ${deviceId}: synthetic input ${topic} has unresolved placeholder(s) ${leftover.join(", ")} — nothing substitutes them, so the gateway would subscribe to a topic that never matches`,
      );
    }
  }
}

/**
 * Walk every device, look up its template, and emit the template's alarm
 * catalog under the device_id key. Devices whose template has empty alarms[]
 * (modules — no equipment_id — and un-rationalized leaves) are skipped so the
 * map stays sparse. Catalogs are SKU-scoped: every device sharing a template
 * gets the same alarms[] reference.
 * @param dtm The self-describing deployment manifest
 * @returns Map keyed by `device_id` -> alarms[]
 */
export function buildAlarmsMap(dtm: DtmType): AlarmsMap {
  const out: Record<string, readonly AlarmType[]> = {};
  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const tpl = dtm.templates_used[device.template];
    if (!tpl) continue;
    if (tpl.alarms.length === 0) continue;
    out[deviceId] = tpl.alarms;
  }
  return out;
}

/**
 * Walk every template in the DTM's `templates_used` map, project enum-typed
 * measurements into a flat map of `${template}.${version}.${name} -> [labels]`.
 *
 * Labels are ordered by their declared `register_value` (the integer the
 * device puts on the wire), giving a deterministic order independent of YAML
 * insertion order and Postgres jsonb's key-length-then-alpha storage order.
 * @param templates All templates referenced by this deployment
 * @returns Map of template+name keys to their allowed string labels
 */
export function buildEnumValuesMap(
  templates: readonly DeviceTemplateType[],
): EnumValuesMap {
  const out: Record<string, readonly string[]> = {};
  for (const tpl of templates) {
    const key = tpl.template;
    for (const [name, meas] of Object.entries(tpl.measurements ?? {})) {
      if (meas.type === "enum" && meas.values) {
        out[`${key}.${name}`] = orderedEnumLabels(meas.values);
      }
    }
  }
  return out;
}

/**
 * Sort enum labels alphabetically (new schema has no register_value on values).
 * @param values The `values:` map from a class enum measurement
 * @returns Label keys in deterministic alphabetical order
 */
function orderedEnumLabels(values: Record<string, unknown>): readonly string[] {
  return Object.keys(values).sort((labelA, labelB) =>
    labelA.localeCompare(labelB),
  );
}
