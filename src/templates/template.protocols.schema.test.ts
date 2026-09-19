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
    if (result.protocol !== "distribute") throw new Error("expected distribute");
    assert.equal(result.allocation_policy, "equal_split");
  });

  it("accepts allocation_policy=soc_weighted", () => {
    const result = Binding.parse({
      protocol: "distribute",
      allocation_policy: "soc_weighted",
    });
    if (result.protocol !== "distribute") throw new Error("expected distribute");
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
    if (result.protocol !== "distribute") throw new Error("expected distribute");
    assert.equal(result.ramp_rate_per_sec, 0.1);
    assert.equal(result.hysteresis_margin, 0.05);
    assert.equal(result.hysteresis_dwell_secs, 30.0);
  });

  it("stays valid without envelope-guard fields (plain distribute, unaffected)", () => {
    const result = Binding.parse({
      protocol: "distribute",
      allocation_policy: "equal_split",
    });
    if (result.protocol !== "distribute") throw new Error("expected distribute");
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
