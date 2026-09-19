/**
 * Protocol binding schemas for device template measurements.
 *
 * Split from template.schema.ts to mirror edp-api's template_protocols.py.
 * Owns the 5 binding variants and the Binding discriminated-union export.
 */

import { z } from "zod";

const ModbusBinding = z.strictObject({
  protocol: z.literal("modbus_tcp"),
  function_code: z.number().int(),
  address: z.number().int(),
  data_type: z
    .enum(["int16", "uint16", "int32", "uint32", "float32"])
    .default("int16"),
  word_order: z.enum(["high_low", "low_high"]).default("high_low"),
  scale: z.number().default(1.0),
  offset: z.number().default(0.0),
});

const Dnp3Binding = z.strictObject({
  protocol: z.literal("dnp3_tcp"),
  point_index: z.number().int(),
  point_type: z.enum([
    "analog_input",
    "binary_input",
    "analog_output",
    "binary_output",
    "counter",
  ]),
  // Optional audit metadata: outstation's configured static variation
  // (e.g., 5 for Group 30 Var 5 = 32-bit float). Master polls with default
  // variation when unset.
  variation: z.number().int().nullable().default(null),
});

const SnmpBinding = z.strictObject({
  protocol: z.literal("snmp"),
  oid: z.string(),
});

const RedfishBinding = z.strictObject({
  protocol: z.literal("redfish"),
  uri: z.string(),
  json_pointer: z.string().nullable().default(null),
});

const BacnetIpBinding = z.strictObject({
  protocol: z.literal("bacnet_ip"),
  device_instance: z.number().int(),
  object_type: z.enum([
    "analog_input",
    "analog_output",
    "analog_value",
    "binary_input",
    "binary_output",
    "binary_value",
  ]),
  object_instance: z.number().int(),
  property_id: z.enum(["present_value"]).default("present_value"),
});

// BACnet/SC (ASHRAE 135-2020 Annex AB). Hub-and-spoke over WebSockets with
// mandatory mTLS. Tier-1 enums match BacnetIp; widen as templates land.
const BacnetScBinding = z.strictObject({
  protocol: z.literal("bacnet_sc"),
  hub_url: z.url().startsWith("wss://"),
  device_vmac: z
    .string()
    .regex(
      /^[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}:[0-9A-Fa-f]{2}$/,
    ),
  object_type: z.enum(["analog_input"]),
  object_instance: z.number().int().nonnegative(),
  property_id: z.enum(["present_value"]),
});

// Gateway-side pure-function derivation from cached MQTT inputs.
// Synthetic channels do NOT poll a south-side device. Exactly one of two
// input-source modes applies:
//
// - `inputs`: a fixed list of topics. The gateway subscribes to each, caches
//   latest values, ticks at the measurement's poll_rate_hz, and publishes the
//   result of applying `operation`. Holds (no publish) until every input has
//   at least one cached sample. Topic strings may contain `{site_id}`
//   (gateway runtime) and `{device_id}` (ems-device-api AsyncAPI-gen
//   substitution).
// - `source_measurement`: names a measurement projected across every child
//   of the device this binding lives on. Resolving children into concrete
//   topics is ems-device-api's job (spec-extensions.ts), not modeled here.
//
// `weighted_mean` (capacity_kwh-weighted, per DeviceTemplate.capacity_kwh on
// each child) is only meaningful across children, so it requires
// `source_measurement` mode. `subtract` is only ever between two fixed
// topics (e.g. envelope limit minus module draw), so it requires `inputs`
// mode. `sum`/`mean`/`max`/`min` work in either mode.
const SyntheticBinding = z
  .strictObject({
    protocol: z.literal("synthetic"),
    operation: z.enum(["subtract", "sum", "mean", "max", "min", "weighted_mean"]),
    inputs: z.array(z.string()).optional(),
    source_measurement: z.string().optional(),
  })
  .refine(
    (binding) => Boolean(binding.inputs) !== Boolean(binding.source_measurement),
    {
      message:
        "synthetic binding requires exactly one of `inputs` (fixed topic list) or `source_measurement` (projected across children)",
    },
  )
  .refine(
    (binding) =>
      !(binding.operation === "weighted_mean" && !binding.source_measurement),
    {
      message: "operation=weighted_mean requires source_measurement mode",
    },
  )
  .refine((binding) => !(binding.operation === "subtract" && !binding.inputs), {
    message: "operation=subtract requires inputs mode",
  });

// Command-distribution binding — fans a module-level setpoint out to
// children per `allocation_policy`. No target-measurement field: verb+target
// are inherited from whichever Command this binding lives on, resolved
// per-child by ems-device-api matching verb+target against each child's own
// commands (not modeled here).
const DistributeBinding = z.strictObject({
  protocol: z.literal("distribute"),
  allocation_policy: z.enum(["equal_split", "soc_weighted"]),
});

export const Binding = z.discriminatedUnion("protocol", [
  ModbusBinding,
  Dnp3Binding,
  SnmpBinding,
  RedfishBinding,
  BacnetIpBinding,
  BacnetScBinding,
  SyntheticBinding,
  DistributeBinding,
]);

export type BindingType = z.infer<typeof Binding>;
