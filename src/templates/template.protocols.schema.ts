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

export const Binding = z.discriminatedUnion("protocol", [
  ModbusBinding,
  Dnp3Binding,
  SnmpBinding,
  RedfishBinding,
  BacnetIpBinding,
]);

export type BindingType = z.infer<typeof Binding>;
