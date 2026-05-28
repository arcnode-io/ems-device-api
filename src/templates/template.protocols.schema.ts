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
// Synthetic channels do NOT poll a south-side device. The gateway subscribes
// to the topics listed in `inputs`, caches latest values per topic, ticks at
// the measurement's poll_rate_hz, applies `formula` over cached values, and
// publishes the result. Holds (no publish) until every input is cached.
//
// Input topics may contain `{site_id}` (gateway runtime substitution from
// deployment config) and `{device_id}` (substituted at AsyncAPI generation
// time with the instantiating device's id).
const SyntheticBinding = z.strictObject({
  protocol: z.literal("synthetic"),
  formula: z.enum(["subtract", "sum", "mean", "max", "min"]),
  inputs: z.array(z.string()),
});

export const Binding = z.discriminatedUnion("protocol", [
  ModbusBinding,
  Dnp3Binding,
  SnmpBinding,
  RedfishBinding,
  BacnetIpBinding,
  BacnetScBinding,
  SyntheticBinding,
]);

export type BindingType = z.infer<typeof Binding>;
