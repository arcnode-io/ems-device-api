/**
 * Channel + operation builders for the AsyncAPI v3 spec.
 *
 * Per ADR-002 §2: two families (`measurements`, `commands`) plus `system/`.
 * Per the AsyncAPI 3.0.0 MQTT bindings rule, QoS/retain go on operations,
 * NOT channels (channel-level mqtt binding "MUST NOT contain any properties").
 *
 * Spec is written from the device perspective (§12): `action: send` = device
 * publishes; `action: receive` = device subscribes. Non-device consumers
 * (HMI, analyst) invert during their own codegen.
 *
 * Channels stay template-agnostic (always these same 8) regardless of
 * deployment size — per-device variability doesn't grow the channel count.
 * `examples` on each parameter (AsyncAPI 3.0 Parameter Object field) is how
 * a reader sees real, currently-deployed device ids / measurement names /
 * command targets without that growth — populated from the DTM at
 * generation time, distinct from the fixed channel shape itself.
 */

import type { DtmType } from "../topology/dtm.schema";

const MQTT_BINDING_VERSION = "0.2.0";

const MEASUREMENT_ADDRESS =
  "sites/{site_id}/devices/{device_id}/measurements/{measurement}/{unit}";
const COMMAND_ADDRESS =
  "sites/{site_id}/devices/{device_id}/commands/{verb}/{target}/{unit}";

/** Operator-readable units allowed in the topic unit slot. ADR-002 §3. */
const UNIT_VOCABULARY = [
  "volts",
  "amps",
  "watts",
  "vars",
  "voltamperes",
  "watt_hours",
  "hertz",
  "celsius",
  "percent",
  "watts_per_m2",
  "meters_per_second",
  "bar",
  "liters_per_minute",
  "none",
] as const;

const SET_VERB = ["set"] as const;
const STATE_VERBS = ["start", "stop", "enable", "disable"] as const;
const TRIGGER_VERBS = ["reset", "clear"] as const;

/** Family-derived MQTT bindings per ADR-002 §11. */
const MEASUREMENT_BINDINGS = {
  qos: 0,
  retain: true,
  bindingVersion: MQTT_BINDING_VERSION,
};
const COMMAND_BINDINGS = {
  qos: 1,
  retain: false,
  bindingVersion: MQTT_BINDING_VERSION,
};
const SYSTEM_BINDINGS = {
  qos: 1,
  retain: false,
  bindingVersion: MQTT_BINDING_VERSION,
};

type WireType = "float" | "bool" | "enum";
type CommandPayloadType = WireType | "trigger";

/** Distinct measurement names per wire type, alphabetical, across every
 * template referenced by the DTM. */
function measurementNamesByType(
  dtm: DtmType,
): Record<WireType, readonly string[]> {
  const buckets: Record<WireType, Set<string>> = {
    float: new Set(),
    bool: new Set(),
    enum: new Set(),
  };
  for (const tpl of Object.values(dtm.templates_used)) {
    for (const [name, meas] of Object.entries(tpl.measurements)) {
      buckets[meas.type].add(name);
    }
  }
  return {
    float: orderedNames(buckets.float),
    bool: orderedNames(buckets.bool),
    enum: orderedNames(buckets.enum),
  };
}

/** Distinct bound command targets per payload type, alphabetical, across
 * every template referenced by the DTM. */
function commandTargetsByType(
  dtm: DtmType,
): Record<CommandPayloadType, readonly string[]> {
  const buckets: Record<CommandPayloadType, Set<string>> = {
    float: new Set(),
    bool: new Set(),
    enum: new Set(),
    trigger: new Set(),
  };
  for (const tpl of Object.values(dtm.templates_used)) {
    for (const cmd of Object.values(tpl.commands)) {
      buckets[cmd.payload].add(cmd.target);
    }
  }
  return {
    float: orderedNames(buckets.float),
    bool: orderedNames(buckets.bool),
    enum: orderedNames(buckets.enum),
    trigger: orderedNames(buckets.trigger),
  };
}

function orderedNames(names: Set<string>): readonly string[] {
  return [...names].sort((nameA, nameB) => nameA.localeCompare(nameB));
}

/** Every device id in the DTM, alphabetical. */
function deviceIds(dtm: DtmType): readonly string[] {
  return orderedNames(new Set(Object.keys(dtm.devices)));
}

/**
 * Attach `examples` (AsyncAPI 3.0 Parameter Object field) only when there's
 * at least one real value — an empty array would just be noise in the spec.
 * @param param Base parameter descriptor
 * @param examples Real values from this deployment's DTM, if any
 * @returns Parameter descriptor, with `examples` added when non-empty
 */
function withExamples(
  param: Record<string, unknown>,
  examples: readonly string[],
): Record<string, unknown> {
  return examples.length > 0 ? { ...param, examples } : param;
}

/**
 * Common channel parameters for measurement + command topic templates.
 * @param deviceIdExamples Real device ids from this deployment's DTM
 * @returns Map of `site_id` and `device_id` parameter descriptors.
 */
function commonDeviceParams(
  deviceIdExamples: readonly string[],
): Record<string, unknown> {
  return {
    site_id: { description: "Site slug (snake_case)" },
    device_id: withExamples(
      { description: "Device slug (leaf id; depth lives in DTM)" },
      deviceIdExamples,
    ),
  };
}

/**
 * Build a measurement channel template keyed by sample type.
 * @param measurementDescription Description for the {measurement} topic slot
 * @param deviceIdExamples Real device ids from this deployment's DTM
 * @param measurementExamples Real measurement names of this wire type
 * @returns AsyncAPI channel object with the measurement address + parameters
 */
function measurementChannel(
  measurementDescription: string,
  deviceIdExamples: readonly string[],
  measurementExamples: readonly string[],
): Record<string, unknown> {
  return {
    address: MEASUREMENT_ADDRESS,
    parameters: {
      ...commonDeviceParams(deviceIdExamples),
      measurement: withExamples(
        { description: measurementDescription },
        measurementExamples,
      ),
      unit: { enum: UNIT_VOCABULARY as readonly string[] },
    },
  };
}

/**
 * Build a command channel template keyed by sample type.
 * @param verbs Allowed verbs for this command channel's {verb} slot
 * @param targetDescription Description for the {target} topic slot
 * @param deviceIdExamples Real device ids from this deployment's DTM
 * @param targetExamples Real bound command targets of this payload type
 * @returns AsyncAPI channel object with the command address + parameters
 */
function commandChannel(
  verbs: readonly string[],
  targetDescription: string,
  deviceIdExamples: readonly string[],
  targetExamples: readonly string[],
): Record<string, unknown> {
  return {
    address: COMMAND_ADDRESS,
    parameters: {
      ...commonDeviceParams(deviceIdExamples),
      verb: { enum: verbs },
      target: withExamples({ description: targetDescription }, targetExamples),
      unit: { enum: UNIT_VOCABULARY as readonly string[] },
    },
  };
}

/**
 * All channel templates — 8 total (3 measurement + 4 command + 1 system) —
 * always the same regardless of deployment size (see module doc). Parameter
 * `examples` are the only per-DTM variability here.
 * @param dtm The self-describing deployment manifest
 * @returns AsyncAPI `channels` map keyed by descriptive channel id.
 */
export function buildChannels(dtm: DtmType): Record<string, unknown> {
  const ids = deviceIds(dtm);
  const measurements = measurementNamesByType(dtm);
  const commands = commandTargetsByType(dtm);

  return {
    measurementFloat: {
      ...measurementChannel("Float-typed measurement", ids, measurements.float),
      messages: {
        sample: { $ref: "#/components/messages/FloatSampleMsg" },
      },
    },
    measurementBool: {
      ...measurementChannel("Boolean-typed measurement", ids, measurements.bool),
      messages: {
        sample: { $ref: "#/components/messages/BooleanSampleMsg" },
      },
    },
    measurementEnum: {
      ...measurementChannel("Enum-typed measurement", ids, measurements.enum),
      messages: {
        sample: { $ref: "#/components/messages/EnumSampleMsg" },
      },
    },
    commandFloat: {
      ...commandChannel(SET_VERB, "Float setpoint target", ids, commands.float),
      messages: { sample: { $ref: "#/components/messages/FloatSampleMsg" } },
    },
    commandBool: {
      ...commandChannel(
        [...SET_VERB, ...STATE_VERBS],
        "Boolean state target",
        ids,
        commands.bool,
      ),
      messages: {
        sample: { $ref: "#/components/messages/BooleanSampleMsg" },
      },
    },
    commandEnum: {
      ...commandChannel(SET_VERB, "Enum mode target", ids, commands.enum),
      messages: { sample: { $ref: "#/components/messages/EnumSampleMsg" } },
    },
    commandTrigger: {
      ...commandChannel(TRIGGER_VERBS, "Trigger target", ids, commands.trigger),
      messages: { sample: { $ref: "#/components/messages/TriggerSampleMsg" } },
    },
    topologyChanged: {
      address: "system/topology_changed",
      messages: { event: { $ref: "#/components/messages/TopologyChangedMsg" } },
    },
  };
}

/**
 * Mirror channels with a publish + subscribe operation (device perspective).
 *
 * In AsyncAPI 3.0 the operation map's KEY is the operation identifier — there
 * is no separate `operationId` field on the object. Codegens use that key.
 * @returns AsyncAPI `operations` map keyed by descriptive operation id.
 */
export function buildOperations(): Record<string, unknown> {
  const op = (
    action: "send" | "receive",
    channelKey: string,
    bindings: Record<string, unknown>,
  ): Record<string, unknown> => ({
    action,
    channel: { $ref: `#/channels/${channelKey}` },
    bindings: { mqtt: bindings },
  });

  return {
    publishMeasurementFloat: op(
      "send",
      "measurementFloat",
      MEASUREMENT_BINDINGS,
    ),
    publishMeasurementBool: op("send", "measurementBool", MEASUREMENT_BINDINGS),
    publishMeasurementEnum: op("send", "measurementEnum", MEASUREMENT_BINDINGS),
    receiveCommandFloat: op("receive", "commandFloat", COMMAND_BINDINGS),
    receiveCommandBool: op("receive", "commandBool", COMMAND_BINDINGS),
    receiveCommandEnum: op("receive", "commandEnum", COMMAND_BINDINGS),
    receiveCommandTrigger: op("receive", "commandTrigger", COMMAND_BINDINGS),
    publishTopologyChanged: op("send", "topologyChanged", SYSTEM_BINDINGS),
  };
}
