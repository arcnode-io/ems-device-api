/**
 * x-* extensions for the AsyncAPI v3 spec.
 *
 * - `x-protocol-source` — keyed by `(device_id, measurement|command)`,
 *   carries the Modbus/SNMP/etc. binding metadata the gateway needs to
 *   translate raw protocol values to engineering units. Lives at top level
 *   (not per-channel) because channels are templated and bindings are
 *   per-instance.
 * - `x-enum-values` — keyed by `${template}.${version}.${measurement}`,
 *   lists the allowed string labels for enum measurements. Template-scoped
 *   (not per-instance) because enum vocabulary is a template-level contract.
 *
 * Per ADR-002 §4, the `protocol_binding_template` block on each template YAML
 * is the canonical source. Extensions here project it from the DTM's
 * self-describing `templates_used` map.
 */

import type { DtmType } from "../topology/dtm.schema";
import type { DeviceTemplateType } from "../templates/template.schema";

/** Per-device, per-channel protocol source map. */
export type ProtocolSourceMap = Record<string, Record<string, unknown>>;

/** Per-template enum vocabulary map. */
export type EnumValuesMap = Record<string, readonly string[]>;

/**
 * Walk every device in the DTM, look up its template in `templates_used`,
 * and project the `protocol_binding_template.register_map` entries into a
 * per-device, per-channel-name map.
 * @param dtm The self-describing deployment manifest
 * @returns Map keyed by `device_id` -> `measurement_or_command_name` -> binding
 */
export function buildProtocolSourceMap(dtm: DtmType): ProtocolSourceMap {
  const out: ProtocolSourceMap = {};
  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const tpl = dtm.templates_used[device.template];
    if (!tpl) continue;
    const template = (tpl as Record<string, unknown>).protocol_binding_template;
    if (!isProtocolBindingTemplate(template)) continue;
    const entries = projectBindings(template);
    if (Object.keys(entries).length > 0) out[deviceId] = entries;
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
 * Sort enum labels by `register_value` ascending. Entries without a
 * `register_value` (mqtt_native, redfish bindings) fall back to alphabetical.
 * @param values The `values:` map from a class enum measurement
 * @returns Label keys in deterministic protocol order
 */
function orderedEnumLabels(values: Record<string, unknown>): readonly string[] {
  return Object.entries(values)
    .map(([label, def]) => ({
      label,
      regValue:
        (def as { register_value?: number }).register_value ?? Number.NaN,
    }))
    .sort((labelA, labelB) => {
      if (Number.isNaN(labelA.regValue) && Number.isNaN(labelB.regValue)) {
        return labelA.label.localeCompare(labelB.label);
      }
      if (Number.isNaN(labelA.regValue)) return 1;
      if (Number.isNaN(labelB.regValue)) return -1;
      return labelA.regValue - labelB.regValue;
    })
    .map(({ label }) => label);
}

interface ProtocolBindingTemplate {
  type: string;
  register_map?: Record<string, Record<string, unknown>>;
}

/**
 * Type-narrow an unknown template extra-field to the binding shape we project.
 * @param value Candidate `protocol_binding_template` block from a template YAML
 * @returns True if the value matches the binding-template shape we project
 */
function isProtocolBindingTemplate(
  value: unknown,
): value is ProtocolBindingTemplate {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  );
}

/**
 * Flatten a template's register_map into per-channel binding entries.
 * @param template Validated protocol_binding_template block
 * @returns Map of channel name -> protocol-source binding fields
 */
function projectBindings(
  template: ProtocolBindingTemplate,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [name, raw] of Object.entries(template.register_map ?? {})) {
    out[name] = {
      protocol: template.type,
      register_type: "holding",
      address: raw.addr,
      data_type: raw.type,
      scale: raw.scale ?? 1,
      offset: raw.offset ?? 0,
    };
  }
  return out;
}
