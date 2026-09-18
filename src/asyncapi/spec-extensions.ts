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

import type { DtmType } from "../topology/dtm.schema";
import type {
  DeviceTemplateType,
  BindingType,
  AlarmType,
} from "../templates/template.schema";

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
    const entries = collectCommandBindings(tpl, device.connection ?? null, deviceId);
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
    tpl: DeviceTemplateType,
    connection: ConnectionFields,
    deviceId: string,
  ) => Record<string, ProtocolSourceEntry>,
): ProtocolSourceMap {
  const out: ProtocolSourceMap = {};
  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const tpl = dtm.templates_used[device.template];
    if (!tpl) continue;
    const entries = collect(tpl, device.connection ?? null, deviceId);
    if (Object.keys(entries).length > 0) out[deviceId] = entries;
  }
  return out;
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

/** Fully merged map entry: binding ∪ connection ∪ channel meta. */
type ProtocolSourceEntry = BindingType & ConnectionFields & ChannelMeta;

/**
 * A command's verb + target — the two things an inbound `commands/{verb}/
 * {target}/{unit}` topic actually carries, so a consumer can resolve the
 * right entry without knowing (or guessing) the template's command name.
 */
type CommandIdentity = { verb: string; target: string };

/** Fully merged command entry: binding ∪ connection ∪ unit ∪ verb/target. */
type CommandSourceEntry = BindingType &
  ConnectionFields & { unit: string } & CommandIdentity;

/**
 * Collect all binding-bearing measurements from a template, merging in the
 * device's connection (host/port/unit_id) plus channel meta (`unit`,
 * `poll_rate_hz`) so consumers see the complete protocol-instance picture in
 * one entry. For synthetic bindings, substitute `{device_id}` in the
 * `inputs[]` array with the instantiating `deviceId`. `{site_id}` stays
 * unresolved — gateway substitutes from its deployment config at runtime.
 * @param tpl Validated DeviceTemplate with measurements
 * @param connection Device-level connection block (host/port/unit_id), or null
 * @param deviceId The instantiating device's id, used for `{device_id}` substitution
 * @returns Map of channel name -> binding + connection + channel meta
 */
function collectMeasurementBindings(
  tpl: DeviceTemplateType,
  connection: ConnectionFields,
  deviceId: string,
): Record<string, ProtocolSourceEntry> {
  const out: Record<string, ProtocolSourceEntry> = {};
  const conn = connection ?? ({} as ConnectionFields);
  for (const [name, meas] of Object.entries(tpl.measurements)) {
    if (meas.binding !== null && meas.binding !== undefined) {
      const resolvedBinding = resolveDeviceIdPlaceholder(
        meas.binding,
        deviceId,
      );
      out[name] = {
        ...conn,
        ...resolvedBinding,
        unit: meas.unit,
        poll_rate_hz: meas.poll_rate_hz,
      } as ProtocolSourceEntry;
    }
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
 * consumer resolving a topic needs the real fields, not a guess.
 * @param tpl Validated DeviceTemplate with commands
 * @param connection Device-level connection block (host/port/unit_id), or null
 * @param deviceId The instantiating device's id, used for `{device_id}` substitution
 * @returns Map of channel name -> binding + connection + verb + target
 */
function collectCommandBindings(
  tpl: DeviceTemplateType,
  connection: ConnectionFields,
  deviceId: string,
): Record<string, CommandSourceEntry> {
  const out: Record<string, CommandSourceEntry> = {};
  const conn = connection ?? ({} as ConnectionFields);
  for (const [name, cmd] of Object.entries(tpl.commands)) {
    if (cmd.binding !== null && cmd.binding !== undefined) {
      const resolvedBinding = resolveDeviceIdPlaceholder(cmd.binding, deviceId);
      out[name] = {
        ...conn,
        ...resolvedBinding,
        unit: cmd.unit,
        verb: cmd.verb,
        target: cmd.target,
      } as CommandSourceEntry;
    }
  }
  return out;
}

/**
 * Substitute the `{device_id}` placeholder in synthetic binding `inputs[]`
 * with the instantiating device's id. Non-synthetic bindings pass through
 * unchanged. `{site_id}` stays unresolved for gateway runtime substitution.
 * @param binding Binding from a measurement or command
 * @param deviceId The instantiating device's id
 * @returns Binding with synthetic.inputs[] resolved if applicable
 */
function resolveDeviceIdPlaceholder(
  binding: BindingType,
  deviceId: string,
): BindingType {
  if (binding.protocol !== "synthetic") return binding;
  return {
    ...binding,
    inputs: binding.inputs.map((topic) =>
      topic.replace(/\{device_id\}/g, deviceId),
    ),
  };
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
