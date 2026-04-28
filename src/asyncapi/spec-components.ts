/**
 * Components block for the AsyncAPI v3 spec.
 *
 * Per ADR-002 §6, four sample schemas (FloatSample/BooleanSample/EnumSample/
 * TriggerSample) carry every payload. Plus the topology-change event and
 * a published JSON Schema for the x-protocol-source extension shape so the
 * gateway and HMI can't drift.
 */

import type { DeviceTemplateType } from "../templates/template.schema";

const TS_FORMAT = "date-time";

/** Float-typed sample (e.g. voltage_dc, active_power). */
const FLOAT_SAMPLE_SCHEMA = {
  type: "object",
  required: ["ts", "value"],
  properties: {
    ts: { type: "string", format: TS_FORMAT },
    value: { type: "number" },
  },
};

/** Boolean-typed sample (e.g. interlock_engaged, breaker_closed). */
const BOOLEAN_SAMPLE_SCHEMA = {
  type: "object",
  required: ["ts", "value"],
  properties: {
    ts: { type: "string", format: TS_FORMAT },
    value: { type: "boolean" },
  },
};

/** Enum-typed sample. Per-channel value lock lives in x-enum-values. */
const ENUM_SAMPLE_SCHEMA = {
  type: "object",
  required: ["ts", "value"],
  properties: {
    ts: { type: "string", format: TS_FORMAT },
    value: { type: "string" },
  },
};

/** Trigger sample. Commands only (reset, clear). No value field. */
const TRIGGER_SAMPLE_SCHEMA = {
  type: "object",
  required: ["ts"],
  properties: {
    ts: { type: "string", format: TS_FORMAT },
  },
};

/** topology_changed event payload — `{ts, version}` per ADR-002 §10. */
const TOPOLOGY_CHANGED_SCHEMA = {
  type: "object",
  required: ["ts", "version"],
  properties: {
    ts: { type: "string", format: TS_FORMAT },
    version: { type: "string" },
  },
};

/**
 * Published JSON Schema for x-protocol-source map entries.
 * Gateway + HMI can validate / codegen against this to stay in sync.
 */
const PROTOCOL_SOURCE_SCHEMA = {
  type: "object",
  required: ["protocol"],
  properties: {
    protocol: {
      type: "string",
      enum: ["modbus_tcp", "snmp_v3", "redfish", "dnp3", "canbus"],
    },
    register_type: {
      type: "string",
      enum: ["holding", "input", "coil", "discrete"],
    },
    address: { type: "integer" },
    data_type: {
      type: "string",
      enum: ["int16", "uint16", "int32", "uint32", "uint8", "bool", "float32"],
    },
    word_order: { type: "string", enum: ["high_low", "low_high"] },
    scale: { type: "number" },
    offset: { type: "number" },
    server_unit_id: { type: "integer" },
  },
};

/**
 * Wraps a payload schema as an AsyncAPI message component.
 * @param name Message component identifier (e.g. `FloatSampleMsg`)
 * @param schemaRef Schema name under `components.schemas` (e.g. `FloatSample`)
 * @returns Minimal AsyncAPI Message Object referencing the named schema
 */
function msg(
  name: string,
  schemaRef: string,
): {
  name: string;
  payload: { $ref: string };
} {
  return { name, payload: { $ref: `#/components/schemas/${schemaRef}` } };
}

/**
 * Build the AsyncAPI components block — schemas (5 payload shapes +
 * ProtocolSource) and messages (4 wrappers + topology event).
 * @param templates Catalog entries used (reserved for future per-template
 *                  schema injection — schemas are template-agnostic at MVP).
 * @returns The fully populated components object.
 */
export function buildComponents(templates: readonly DeviceTemplateType[]): {
  messages: Record<string, unknown>;
  schemas: Record<string, unknown>;
} {
  void templates; // reserved for future per-template schema variants
  return {
    messages: {
      FloatSampleMsg: msg("FloatSampleMsg", "FloatSample"),
      BooleanSampleMsg: msg("BooleanSampleMsg", "BooleanSample"),
      EnumSampleMsg: msg("EnumSampleMsg", "EnumSample"),
      TriggerSampleMsg: msg("TriggerSampleMsg", "TriggerSample"),
      TopologyChangedMsg: msg("TopologyChangedMsg", "TopologyChanged"),
    },
    schemas: {
      FloatSample: FLOAT_SAMPLE_SCHEMA,
      BooleanSample: BOOLEAN_SAMPLE_SCHEMA,
      EnumSample: ENUM_SAMPLE_SCHEMA,
      TriggerSample: TRIGGER_SAMPLE_SCHEMA,
      TopologyChanged: TOPOLOGY_CHANGED_SCHEMA,
      ProtocolSource: PROTOCOL_SOURCE_SCHEMA,
    },
  };
}
