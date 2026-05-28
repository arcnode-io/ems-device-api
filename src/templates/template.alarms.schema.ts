/**
 * Alarm catalog schemas — mirror of edp-module-assemblies alarm_spec.py.
 *
 * Sibling of template.protocols.schema.ts. Owns AlarmPriority + Reset +
 * ConditionSource (5-variant discriminated union) + Alarm. Each variant maps
 * to a wire-level transport the gateway uses to poll/listen for the trigger.
 */

import { z } from "zod";

// Hollifield §7.19 — 4-tier priority. P1 = safety/people, P4 = advisory.
export const AlarmPriority = z.enum(["P1", "P2", "P3", "P4"]);

// Clear behavior on return-to-normal. `latched` waits for HMI ack.
export const Reset = z.enum(["latched", "auto"]);

const DiscreteRegisterSource = z.strictObject({
  type: z.literal("discrete_register"),
  address: z.number().int().nonnegative(),
  meaning_when_set: z.enum(["alarm", "clear"]),
});

const AnalogThresholdSource = z.strictObject({
  type: z.literal("analog_threshold"),
  address: z.number().int().nonnegative(),
  threshold: z.number(),
  direction: z.enum(["above", "below"]),
  unit: z.string(),
  deadband_pct: z.number().nonnegative().nullable().default(null),
});

const SnmpTrapSource = z.strictObject({
  type: z.literal("snmp_trap"),
  oid: z.string(),
});

const DnpEventSource = z.strictObject({
  type: z.literal("dnp_event"),
  point_index: z.number().int().nonnegative(),
  point_type: z.enum(["binary_input", "analog_input"]),
});

const RedfishEventSource = z.strictObject({
  type: z.literal("redfish_event"),
  event_id: z.string(),
  severity: z.enum(["OK", "Warning", "Critical"]).nullable().default(null),
});

export const ConditionSource = z.discriminatedUnion("type", [
  DiscreteRegisterSource,
  AnalogThresholdSource,
  SnmpTrapSource,
  DnpEventSource,
  RedfishEventSource,
]);

export const Alarm = z.strictObject({
  id: z.string(),
  description: z.string(),
  condition_source: ConditionSource,
  priority: AlarmPriority,
  operator_action: z.string(),
  on_delay_ms: z.number().int().nonnegative(),
  off_delay_ms: z.number().int().nonnegative(),
  reset: Reset,
  reference_doc: z.string(),
});

export type AlarmType = z.infer<typeof Alarm>;
export type ConditionSourceType = z.infer<typeof ConditionSource>;
