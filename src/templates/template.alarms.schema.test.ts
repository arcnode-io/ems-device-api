/**
 * Unit tests for template.alarms.schema.ts — mirrors edp-module-assemblies
 * Pydantic alarm_spec.py test coverage. AAA pattern.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  Alarm,
  AlarmPriority,
  ConditionSource,
  Reset,
} from "./template.alarms.schema";

function ok<T>(schema: { parse: (v: unknown) => T }, input: unknown): T {
  return schema.parse(input);
}

function fail(
  schema: {
    safeParse: (v: unknown) => {
      success: boolean;
      error?: { issues: { message: string }[] };
    };
  },
  input: unknown,
): string {
  const result = schema.safeParse(input);
  assert.equal(result.success, false);
  return result.error!.issues.map((issue) => issue.message).join("; ");
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

describe("AlarmPriority", () => {
  it("accepts P1..P4", () => {
    for (const p of ["P1", "P2", "P3", "P4"]) {
      assert.equal(ok(AlarmPriority, p), p);
    }
  });

  it("rejects P5", () => {
    const msg = fail(AlarmPriority, "P5");
    assert.ok(msg.length > 0);
  });
});

describe("Reset", () => {
  it("accepts latched and auto", () => {
    assert.equal(ok(Reset, "latched"), "latched");
    assert.equal(ok(Reset, "auto"), "auto");
  });

  it("rejects unknown reset mode", () => {
    const msg = fail(Reset, "manual");
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// ConditionSource discriminated union
// ---------------------------------------------------------------------------

describe("ConditionSource", () => {
  it("parses DiscreteRegisterSource", () => {
    const result = ok(ConditionSource, {
      type: "discrete_register",
      address: 100,
      meaning_when_set: "alarm",
    });
    assert.equal(result.type, "discrete_register");
  });

  it("DiscreteRegisterSource rejects negative address", () => {
    const msg = fail(ConditionSource, {
      type: "discrete_register",
      address: -1,
      meaning_when_set: "alarm",
    });
    assert.ok(msg.length > 0);
  });

  it("parses AnalogThresholdSource; deadband_pct defaults to null", () => {
    const result = ok(ConditionSource, {
      type: "analog_threshold",
      address: 200,
      threshold: 75.0,
      direction: "above",
      unit: "°C",
    });
    if (result.type !== "analog_threshold")
      throw new Error("expected analog_threshold");
    assert.equal(result.deadband_pct, null);
  });

  it("AnalogThresholdSource accepts deadband_pct", () => {
    const result = ok(ConditionSource, {
      type: "analog_threshold",
      address: 200,
      threshold: 75.0,
      direction: "below",
      unit: "V",
      deadband_pct: 2.5,
    });
    if (result.type !== "analog_threshold")
      throw new Error("expected analog_threshold");
    assert.equal(result.deadband_pct, 2.5);
  });

  it("AnalogThresholdSource rejects negative deadband_pct", () => {
    const msg = fail(ConditionSource, {
      type: "analog_threshold",
      address: 200,
      threshold: 75.0,
      direction: "above",
      unit: "°C",
      deadband_pct: -1,
    });
    assert.ok(msg.length > 0);
  });

  it("parses SnmpTrapSource", () => {
    const result = ok(ConditionSource, {
      type: "snmp_trap",
      oid: "1.3.6.1.4.1.318.1.1.1.11",
    });
    assert.equal(result.type, "snmp_trap");
  });

  it("parses DnpEventSource", () => {
    const result = ok(ConditionSource, {
      type: "dnp_event",
      point_index: 7,
      point_type: "binary_input",
    });
    assert.equal(result.type, "dnp_event");
  });

  it("DnpEventSource rejects unknown point_type", () => {
    const msg = fail(ConditionSource, {
      type: "dnp_event",
      point_index: 7,
      point_type: "counter",
    });
    assert.ok(msg.length > 0);
  });

  it("parses RedfishEventSource; severity defaults to null", () => {
    const result = ok(ConditionSource, {
      type: "redfish_event",
      event_id: "ThermalEvent.1.0.TempCritical",
    });
    if (result.type !== "redfish_event")
      throw new Error("expected redfish_event");
    assert.equal(result.severity, null);
  });

  it("RedfishEventSource accepts severity", () => {
    const result = ok(ConditionSource, {
      type: "redfish_event",
      event_id: "ThermalEvent.1.0.TempCritical",
      severity: "Critical",
    });
    if (result.type !== "redfish_event")
      throw new Error("expected redfish_event");
    assert.equal(result.severity, "Critical");
  });

  it("rejects unknown condition_source type", () => {
    const msg = fail(ConditionSource, {
      type: "iec61850_goose",
      address: 1,
    });
    assert.ok(msg.length > 0);
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(ConditionSource, {
      type: "discrete_register",
      address: 100,
      meaning_when_set: "alarm",
      extra: true,
    });
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Alarm
// ---------------------------------------------------------------------------

const baseAlarm = {
  id: "arc_flash_trip",
  description: "Arc-flash relay tripped breaker",
  condition_source: {
    type: "discrete_register" as const,
    address: 100,
    meaning_when_set: "alarm" as const,
  },
  priority: "P1" as const,
  operator_action: "Evacuate; verify isolation; await electrician.",
  on_delay_ms: 0,
  off_delay_ms: 0,
  reset: "latched" as const,
  reference_doc: "SEL-351 §7.4.1",
};

describe("Alarm", () => {
  it("parses minimal alarm", () => {
    const result = ok(Alarm, baseAlarm);
    assert.equal(result.id, "arc_flash_trip");
    assert.equal(result.priority, "P1");
  });

  it("rejects negative on_delay_ms", () => {
    const msg = fail(Alarm, { ...baseAlarm, on_delay_ms: -1 });
    assert.ok(msg.length > 0);
  });

  it("rejects negative off_delay_ms", () => {
    const msg = fail(Alarm, { ...baseAlarm, off_delay_ms: -1 });
    assert.ok(msg.length > 0);
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(Alarm, { ...baseAlarm, extra: "oops" });
    assert.ok(msg.length > 0);
  });

  it("rejects missing operator_action (Hollifield §A4 step 4)", () => {
    const msg = fail(Alarm, {
      id: baseAlarm.id,
      description: baseAlarm.description,
      condition_source: baseAlarm.condition_source,
      priority: baseAlarm.priority,
      on_delay_ms: baseAlarm.on_delay_ms,
      off_delay_ms: baseAlarm.off_delay_ms,
      reset: baseAlarm.reset,
      reference_doc: baseAlarm.reference_doc,
    });
    assert.ok(msg.length > 0);
  });
});
