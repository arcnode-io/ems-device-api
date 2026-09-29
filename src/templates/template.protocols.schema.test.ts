/**
 * Unit tests for template.protocols.schema.ts — mirrors edp-api
 * test_template_protocols.py coverage for the Phase I additions
 * (source_measurement mode, weighted_mean, DistributeBinding).
 * AAA pattern throughout. Zod `.safeParse()` used so failures return
 * structured errors.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Binding } from "./template.protocols.schema";

/**
 * Parse and assert failure, returning all joined error messages.
 * @param input - Raw input value expected to fail
 * @returns Semicolon-joined issue messages
 */
function fail(input: unknown): string {
  const result = Binding.safeParse(input);
  assert.equal(result.success, false);
  return result.error.issues.map((issue) => issue.message).join("; ");
}

describe("DistributeBinding", () => {
  it("accepts allocation_policy=equal_split", () => {
    const result = Binding.parse({
      protocol: "distribute",
      allocation_policy: "equal_split",
    });
    if (result.protocol !== "distribute")
      throw new Error("expected distribute");
    assert.equal(result.allocation_policy, "equal_split");
  });

  it("accepts allocation_policy=soc_weighted", () => {
    const result = Binding.parse({
      protocol: "distribute",
      allocation_policy: "soc_weighted",
    });
    if (result.protocol !== "distribute")
      throw new Error("expected distribute");
    assert.equal(result.allocation_policy, "soc_weighted");
  });

  it("accepts envelope-guard fields when all three are present", () => {
    const result = Binding.parse({
      protocol: "distribute",
      allocation_policy: "soc_weighted",
      ramp_rate_per_sec: 0.1,
      hysteresis_margin: 0.05,
      hysteresis_dwell_secs: 30.0,
    });
    if (result.protocol !== "distribute")
      throw new Error("expected distribute");
    assert.equal(result.ramp_rate_per_sec, 0.1);
    assert.equal(result.hysteresis_margin, 0.05);
    assert.equal(result.hysteresis_dwell_secs, 30.0);
  });

  it("stays valid without envelope-guard fields (plain distribute, unaffected)", () => {
    const result = Binding.parse({
      protocol: "distribute",
      allocation_policy: "equal_split",
    });
    if (result.protocol !== "distribute")
      throw new Error("expected distribute");
    assert.equal(result.ramp_rate_per_sec, undefined);
    assert.equal(result.hysteresis_margin, undefined);
    assert.equal(result.hysteresis_dwell_secs, undefined);
  });

  it("rejects partial envelope-guard fields (all-or-nothing, not two-of-three)", () => {
    const msg = fail({
      protocol: "distribute",
      allocation_policy: "equal_split",
      ramp_rate_per_sec: 0.1,
      hysteresis_margin: 0.05,
    });
    assert.ok(msg.includes("all three or none"), `got: ${msg}`);
  });
});

describe("SyntheticBinding source_measurement mode", () => {
  it("projects one measurement across the device's children", () => {
    const result = Binding.parse({
      protocol: "synthetic",
      operation: "weighted_mean",
      source_measurement: "state_of_charge",
    });
    if (result.protocol !== "synthetic") throw new Error("expected synthetic");
    assert.equal(result.operation, "weighted_mean");
    assert.equal(result.source_measurement, "state_of_charge");
    assert.equal(result.inputs, undefined);
  });

  it("rejects both inputs and source_measurement set", () => {
    const msg = fail({
      protocol: "synthetic",
      operation: "sum",
      inputs: ["a", "b"],
      source_measurement: "active_power",
    });
    assert.ok(msg.includes("exactly one of"), `got: ${msg}`);
  });

  it("rejects neither inputs nor source_measurement set", () => {
    const msg = fail({ protocol: "synthetic", operation: "sum" });
    assert.ok(msg.includes("exactly one of"), `got: ${msg}`);
  });

  it("weighted_mean requires source_measurement mode", () => {
    const msg = fail({
      protocol: "synthetic",
      operation: "weighted_mean",
      inputs: ["a", "b"],
    });
    assert.ok(msg.includes("weighted_mean requires"), `got: ${msg}`);
  });

  it("subtract requires inputs mode", () => {
    const msg = fail({
      protocol: "synthetic",
      operation: "subtract",
      source_measurement: "active_power",
    });
    assert.ok(msg.includes("subtract requires"), `got: ${msg}`);
  });

  it("sum is valid in source_measurement mode", () => {
    const result = Binding.parse({
      protocol: "synthetic",
      operation: "sum",
      source_measurement: "active_power",
    });
    if (result.protocol !== "synthetic") throw new Error("expected synthetic");
    assert.equal(result.operation, "sum");
  });
});

describe("edp-api 7938054 mirror — int64 + snmp scale", () => {
  it("accepts int64 for ION9000's INT64 Wh energy registers", () => {
    // Arrange + Act
    const result = Binding.safeParse({
      protocol: "modbus_tcp",
      function_code: 3,
      address: 4000,
      data_type: "int64",
    });

    // Assert
    assert.equal(result.success, true);
  });

  it("accepts and defaults snmp scale for Sentry4-MIB sub-units", () => {
    // Arrange + Act — Sentry4-MIB reports current in 0.01 A, voltage in 0.1 V.
    const scaled = Binding.parse({
      protocol: "snmp",
      oid: "1.3.6.1.4.1.1718.4.1.1",
      scale: 0.01,
    }) as { scale: number };
    const bare = Binding.parse({
      protocol: "snmp",
      oid: "1.3.6.1.4.1.1718.4.1.1",
    }) as { scale: number };

    // Assert
    assert.equal(scaled.scale, 0.01);
    assert.equal(bare.scale, 1.0);
  });
});

describe("edp-api mirror — SunSpec scale_factor_address", () => {
  it("accepts a scale-factor register address, and omits it when absent", () => {
    // Arrange + Act — SunSpec model 103: W at 40084, W_SF at 40085.
    const sunspec = Binding.parse({
      protocol: "modbus_tcp",
      function_code: 3,
      address: 40084,
      data_type: "int16",
      scale_factor_address: 40085,
    }) as { scale_factor_address?: number };
    const fixed = Binding.parse({
      protocol: "modbus_tcp",
      function_code: 3,
      address: 4000,
      data_type: "int64",
    }) as { scale_factor_address?: number };

    // Assert — optional, not defaulted: a device with a fixed scale shouldn't
    // carry a register address it doesn't have.
    assert.equal(sunspec.scale_factor_address, 40085);
    assert.equal(fixed.scale_factor_address, undefined);
  });
});

describe("edp-api b68d05f mirror — data_type not defaulted, redfish scale", () => {
  it("leaves data_type absent when the template omits it", () => {
    // Arrange + Act — edp-api requires it on emit, but a DTM authored before the
    // field existed still has to parse. Emitting nothing lets the gateway apply
    // its own Int32 default rather than having two defaults that disagree.
    const bare = Binding.parse({
      protocol: "modbus_tcp",
      function_code: 3,
      address: 4000,
    }) as { data_type?: string };

    // Assert
    assert.equal(bare.data_type, undefined);
  });

  it("accepts and defaults a redfish scale for MHz-reporting OEM properties", () => {
    // Arrange + Act — NVIDIA OperatingSpeedMHz is MHz; the vocabulary is hertz.
    const scaled = Binding.parse({
      protocol: "redfish",
      uri: "/Chassis/1/Processors",
      scale: 1000000,
    }) as { scale: number };
    const bare = Binding.parse({
      protocol: "redfish",
      uri: "/Chassis/1/Power",
    }) as { scale: number };

    // Assert
    assert.equal(scaled.scale, 1000000);
    assert.equal(bare.scale, 1.0);
  });
});
