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
 */

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

/**
 * Common channel parameters for measurement + command topic templates.
 * @returns Map of `site_id` and `device_id` parameter descriptors.
 */
function commonDeviceParams(): Record<string, unknown> {
  return {
    site_id: { description: "Site slug (snake_case)" },
    device_id: { description: "Device slug (leaf id; depth lives in DTM)" },
  };
}

/**
 * Build a measurement channel template keyed by sample type.
 * @param measurementDescription Description for the {measurement} topic slot
 * @returns AsyncAPI channel object with the measurement address + parameters
 */
function measurementChannel(
  measurementDescription: string,
): Record<string, unknown> {
  return {
    address: MEASUREMENT_ADDRESS,
    parameters: {
      ...commonDeviceParams(),
      measurement: { description: measurementDescription },
      unit: { enum: UNIT_VOCABULARY as readonly string[] },
    },
  };
}

/**
 * Build a command channel template keyed by sample type.
 * @param verbs Allowed verbs for this command channel's {verb} slot
 * @param targetDescription Description for the {target} topic slot
 * @returns AsyncAPI channel object with the command address + parameters
 */
function commandChannel(
  verbs: readonly string[],
  targetDescription: string,
): Record<string, unknown> {
  return {
    address: COMMAND_ADDRESS,
    parameters: {
      ...commonDeviceParams(),
      verb: { enum: verbs },
      target: { description: targetDescription },
      unit: { enum: UNIT_VOCABULARY as readonly string[] },
    },
  };
}

/**
 * All channel templates — 7 total (3 measurement + 3 command + 1 system).
 * @returns AsyncAPI `channels` map keyed by descriptive channel id.
 */
export function buildChannels(): Record<string, unknown> {
  return {
    measurementFloat: {
      ...measurementChannel("Float-typed measurement"),
      messages: {
        sample: { $ref: "#/components/messages/FloatSampleMsg" },
      },
    },
    measurementBool: {
      ...measurementChannel("Boolean-typed measurement"),
      messages: {
        sample: { $ref: "#/components/messages/BooleanSampleMsg" },
      },
    },
    measurementEnum: {
      ...measurementChannel("Enum-typed measurement"),
      messages: {
        sample: { $ref: "#/components/messages/EnumSampleMsg" },
      },
    },
    commandFloat: {
      ...commandChannel(SET_VERB, "Float setpoint target"),
      messages: { sample: { $ref: "#/components/messages/FloatSampleMsg" } },
    },
    commandBool: {
      ...commandChannel([...SET_VERB, ...STATE_VERBS], "Boolean state target"),
      messages: {
        sample: { $ref: "#/components/messages/BooleanSampleMsg" },
      },
    },
    commandEnum: {
      ...commandChannel(SET_VERB, "Enum mode target"),
      messages: { sample: { $ref: "#/components/messages/EnumSampleMsg" } },
    },
    commandTrigger: {
      ...commandChannel(TRIGGER_VERBS, "Trigger target"),
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
