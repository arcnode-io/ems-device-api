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
} from "../templates/template.schema";

/** Per-device, per-channel protocol source map. */
export type ProtocolSourceMap = Record<string, Record<string, unknown>>;

/** Per-template enum vocabulary map. */
export type EnumValuesMap = Record<string, readonly string[]>;

/**
 * Walk every device in the DTM, look up its template in `templates_used`,
 * and project per-measurement/command `binding` fields into a per-device,
 * per-channel-name map. Only entries with an explicit `binding` field are
 * emitted; measurements with `publisher` (module-level aggregates) are skipped.
 * @param dtm The self-describing deployment manifest
 * @returns Map keyed by `device_id` -> `channel_name` -> binding fields
 */
export function buildProtocolSourceMap(dtm: DtmType): ProtocolSourceMap {
  const out: ProtocolSourceMap = {};
  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const tpl = dtm.templates_used[device.template];
    if (!tpl) continue;
    const entries = collectBindings(tpl);
    if (Object.keys(entries).length > 0) out[deviceId] = entries;
  }
  return out;
}

/**
 * Collect all binding-bearing measurements and commands from a template.
 * @param tpl Validated DeviceTemplate with measurements and commands
 * @returns Map of channel name -> binding fields (empty if no bindings)
 */
function collectBindings(tpl: DeviceTemplateType): Record<string, BindingType> {
  const out: Record<string, BindingType> = {};
  for (const [name, meas] of Object.entries(tpl.measurements)) {
    if (meas.binding !== null && meas.binding !== undefined) {
      out[name] = meas.binding;
    }
  }
  for (const [name, cmd] of Object.entries(tpl.commands)) {
    if (cmd.binding !== null && cmd.binding !== undefined) {
      out[name] = cmd.binding;
    }
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
