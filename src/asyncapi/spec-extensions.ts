/**
 * x-* extensions for the AsyncAPI v3 spec.
 *
 * - `x-protocol-source` — keyed by `device_id` -> `channel_name`, carries
 *   the Modbus/SNMP/etc. binding metadata the gateway needs to translate raw
 *   protocol values to engineering units. Lives at top level (not per-channel)
 *   because channels are templated and bindings are per-instance.
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

/** Per-template enum vocabulary map. */
export type EnumValuesMap = Record<string, readonly string[]>;

/** Per-device alarm catalog map — keyed by device_id -> alarms[]. */
export type AlarmsMap = Record<string, readonly AlarmType[]>;

/**
 * Walk every device in the DTM, look up its template in `templates_used`,
 * and project per-measurement/command `binding` fields into a per-device,
 * per-channel-name map. Each entry merges the template's binding with the
 * device's `connection` block (host/port/unit_id) so consumers have
 * everything needed to drive the protocol in one place.
 * Only entries with an explicit `binding` field are emitted; measurements
 * with `publisher` (module-level aggregates) are skipped.
 * @param dtm The self-describing deployment manifest
 * @returns Map keyed by `device_id` -> `channel_name` -> binding + connection
 */
export function buildProtocolSourceMap(dtm: DtmType): ProtocolSourceMap {
  const out: ProtocolSourceMap = {};
  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const tpl = dtm.templates_used[device.template];
    if (!tpl) continue;
    const entries = collectBindings(tpl, device.connection ?? null, deviceId);
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
 * Collect all binding-bearing measurements and commands from a template,
 * merging in the device's connection (host/port/unit_id) plus channel meta
 * (`unit`, `poll_rate_hz`) so consumers see the complete protocol-instance
 * picture in one entry. For synthetic bindings, substitute `{device_id}` in
 * the `inputs[]` array with the instantiating `deviceId`. `{site_id}` stays
 * unresolved — gateway substitutes from its deployment config at runtime.
 * @param tpl Validated DeviceTemplate with measurements and commands
 * @param connection Device-level connection block (host/port/unit_id), or null
 * @param deviceId The instantiating device's id, used for `{device_id}` substitution
 * @returns Map of channel name -> binding + connection + channel meta
 */
function collectBindings(
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
  for (const [name, cmd] of Object.entries(tpl.commands)) {
    if (cmd.binding !== null && cmd.binding !== undefined) {
      const resolvedBinding = resolveDeviceIdPlaceholder(cmd.binding, deviceId);
      out[name] = {
        ...conn,
        ...resolvedBinding,
        unit: cmd.unit,
      } as ProtocolSourceEntry;
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
