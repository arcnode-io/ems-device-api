/**
 * Components block for the AsyncAPI v3 spec.
 *
 * Per ADR-002 §6: four base sample shapes (FloatSample/BooleanSample/
 * EnumSample/TriggerSample) plus one concrete schema per template
 * measurement and command, each wrapped as a `<Name>Msg` message. Plus the
 * topology-change event and the published JSON Schemas for the
 * x-protocol-source / x-command-source extension shapes — generated from
 * the real Binding contract (spec-contract.ts), not hand-written, so they
 * can't drift from what buildProtocolSourceMap/buildCommandSourceMap
 * actually produce.
 */

import type { DeviceTemplateType } from "../templates/template.schema";
import { buildConcreteMessages } from "./spec-messages";
import { protocolSourceJsonSchema, commandSourceJsonSchema } from "./spec-contract";

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
 * Build the AsyncAPI components block — base schemas + ProtocolSource +
 * topology event, plus one concrete schema and `<Name>Msg` wrapper per
 * template measurement and command.
 * @param templates Templates to project (a DTM's templates_used)
 * @returns The fully populated components object.
 */
export function buildComponents(templates: readonly DeviceTemplateType[]): {
  messages: Record<string, unknown>;
  schemas: Record<string, unknown>;
} {
  const messages: Record<string, unknown> = {
    FloatSampleMsg: msg("FloatSampleMsg", "FloatSample"),
    BooleanSampleMsg: msg("BooleanSampleMsg", "BooleanSample"),
    EnumSampleMsg: msg("EnumSampleMsg", "EnumSample"),
    TriggerSampleMsg: msg("TriggerSampleMsg", "TriggerSample"),
    TopologyChangedMsg: msg("TopologyChangedMsg", "TopologyChanged"),
  };
  const schemas: Record<string, unknown> = {
    FloatSample: FLOAT_SAMPLE_SCHEMA,
    BooleanSample: BOOLEAN_SAMPLE_SCHEMA,
    EnumSample: ENUM_SAMPLE_SCHEMA,
    TriggerSample: TRIGGER_SAMPLE_SCHEMA,
    TopologyChanged: TOPOLOGY_CHANGED_SCHEMA,
    ProtocolSource: protocolSourceJsonSchema(),
    CommandSource: commandSourceJsonSchema(),
  };
  for (const concrete of buildConcreteMessages(templates)) {
    schemas[concrete.name] = concrete.schema;
    messages[`${concrete.name}Msg`] = msg(`${concrete.name}Msg`, concrete.name);
  }
  return { messages, schemas };
}
