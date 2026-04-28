/**
 * x-* extensions for the AsyncAPI v3 spec.
 *
 * - `x-protocol-source` — keyed by `(device_id, measurement|command)`,
 *   carries the Modbus/SNMP/etc. binding metadata the gateway needs to
 *   translate raw protocol values to engineering units. Lives at top level
 *   (not per-channel) because channels are templated and bindings are
 *   per-instance.
 * - `x-enum-values` — keyed by `${class}.${version}.${measurement}`, lists
 *   the allowed string labels for enum measurements/commands. Class-scoped
 *   (not per-instance) because enum vocabulary is a class-level contract.
 *
 * Per ADR-002 §4, the `protocol_binding_template` block on each class YAML
 * is the canonical source. Extensions here just project it into spec shape.
 */

import type { DtmType } from "../topology/dtm.schema";
import type { DeviceClassType } from "../classes/class.schema";
import type { ClassLookup } from "./types";

/** Per-device, per-channel protocol source map. */
export type ProtocolSourceMap = Record<string, Record<string, unknown>>;

/** Per-class enum vocabulary map. */
export type EnumValuesMap = Record<string, readonly string[]>;

/**
 * Walk every device in the DTM, look up its class, and project the class's
 * `protocol_binding_template.register_map` entries into a per-device,
 * per-channel-name map.
 * @param dtm The deployment manifest
 * @param lookup Resolve class refs to their definitions
 * @returns Map keyed by `device_id` -> `measurement_or_command_name` -> binding
 */
export function buildProtocolSourceMap(
  dtm: DtmType,
  lookup: ClassLookup,
): ProtocolSourceMap {
  const out: ProtocolSourceMap = {};
  for (const [deviceId, device] of Object.entries(dtm.devices)) {
    const cls = lookup(device.class);
    if (!cls) continue;
    const template = (cls as Record<string, unknown>).protocol_binding_template;
    if (!isProtocolBindingTemplate(template)) continue;
    const entries = projectBindings(template);
    if (Object.keys(entries).length > 0) out[deviceId] = entries;
  }
  return out;
}

/**
 * Walk every loaded class, project enum-typed measurements + commands into
 * a flat map of `${class}.${version}.${name} -> [labels]`.
 * @param classes All loaded device classes
 * @returns Map of class+name keys to their allowed string labels
 */
export function buildEnumValuesMap(
  classes: readonly DeviceClassType[],
): EnumValuesMap {
  const out: Record<string, readonly string[]> = {};
  for (const cls of classes) {
    const key = `${cls.class}.${cls.version}`;
    for (const [name, meas] of Object.entries(cls.measurements ?? {})) {
      if (meas.type === "enum" && meas.values) {
        out[`${key}.${name}`] = Object.keys(meas.values);
      }
    }
  }
  return out;
}

interface ProtocolBindingTemplate {
  type: string;
  register_map?: Record<string, Record<string, unknown>>;
}

/**
 * Type-narrow an unknown class extra-field to the template shape we care about.
 * @param value Candidate `protocol_binding_template` block from a class YAML
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
 * Flatten a class's register_map into per-channel binding entries.
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
