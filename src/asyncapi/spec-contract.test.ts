/**
 * Unit tests for spec-contract — the generated-not-hand-maintained
 * ProtocolSourceEntry/CommandSourceEntry schemas and their JSON Schema
 * export, plus the validators spec-generator.ts uses to self-enforce every
 * generated spec against them.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  ProtocolSourceEntry,
  CommandSourceEntry,
  protocolSourceJsonSchema,
  commandSourceJsonSchema,
  validateProtocolSourceMap,
  validateCommandSourceMap,
} from "./spec-contract";

describe("ProtocolSourceEntry", () => {
  it("validates a real modbus_tcp entry with connection + channel meta merged in", () => {
    const result = ProtocolSourceEntry.safeParse({
      protocol: "modbus_tcp",
      function_code: 3,
      address: 10,
      host: "10.0.0.5",
      port: 502,
      unit: "watts",
      poll_rate_hz: 1,
    });
    assert.equal(result.success, true);
  });

  it("validates a real synthetic entry with resolved pairs[]", () => {
    const result = ProtocolSourceEntry.safeParse({
      protocol: "synthetic",
      operation: "weighted_mean",
      pairs: [{ topic: "sites/{site_id}/devices/bess_rack_1/measurements/state_of_charge/percent", weight: 4000 }],
      unit: "percent",
      poll_rate_hz: 1,
    });
    assert.equal(result.success, true);
  });

  it("rejects pairs on a protocol other than synthetic", () => {
    const result = ProtocolSourceEntry.safeParse({
      protocol: "modbus_tcp",
      function_code: 3,
      address: 10,
      unit: "watts",
      pairs: [{ topic: "x", weight: 1 }],
    });
    assert.equal(result.success, false);
  });

  it("rejects the old stale protocol spelling ('dnp3' instead of 'dnp3_tcp')", () => {
    const result = ProtocolSourceEntry.safeParse({
      protocol: "dnp3",
      unit: "watts",
    });
    assert.equal(result.success, false);
  });

  it("rejects operation=weighted_mean resolved with inputs instead of pairs", () => {
    // Catches exactly the class of bug this contract exists to prevent: if
    // resolveSourceMeasurement ever mixed up which mode weighted_mean
    // resolves to, this would still silently publish before this check.
    const result = ProtocolSourceEntry.safeParse({
      protocol: "synthetic",
      operation: "weighted_mean",
      inputs: ["sites/{site_id}/devices/bess_rack_1/measurements/state_of_charge/percent"],
      unit: "percent",
      poll_rate_hz: 1,
    });
    assert.equal(result.success, false);
  });
});

describe("CommandSourceEntry", () => {
  it("validates a real distribute entry with envelope-guard fields resolved", () => {
    const result = CommandSourceEntry.safeParse({
      protocol: "distribute",
      allocation_policy: "soc_weighted",
      ramp_rate_per_sec: 0.1,
      hysteresis_margin: 0.05,
      hysteresis_dwell_secs: 30,
      children: [
        {
          device_id: "bess_rack_1",
          operating_state_topic: "sites/{site_id}/devices/bess_rack_1/measurements/operating_state/none",
          state_of_charge_topic: "sites/{site_id}/devices/bess_rack_1/measurements/state_of_charge/percent",
          power_min: -4000000,
          power_max: 4000000,
        },
      ],
      power_min: -4000000,
      power_max: 4000000,
      import_limit_topic: "sites/{site_id}/devices/operating_envelope/measurements/import_limit/watts",
      export_limit_topic: "sites/{site_id}/devices/operating_envelope/measurements/export_limit/watts",
      active_power_topic: "sites/{site_id}/devices/bess_module_1/measurements/active_power/watts",
      unit: "watts",
      verb: "set",
      target: "active_power",
    });
    assert.equal(result.success, true);
  });

  it("validates a plain distribute entry with no envelope-guard fields", () => {
    const result = CommandSourceEntry.safeParse({
      protocol: "distribute",
      allocation_policy: "equal_split",
      unit: "watts",
      verb: "set",
      target: "active_power",
    });
    assert.equal(result.success, true);
  });

  it("rejects a distribute entry with ramp_rate_per_sec but no envelope-guard resolution fields", () => {
    // Catches the class of bug where resolveEnvelopeGuard's output silently
    // gets dropped while the authored ramp/hysteresis fields still pass
    // through — half-guarded is worse than not-guarded at all.
    const result = CommandSourceEntry.safeParse({
      protocol: "distribute",
      allocation_policy: "soc_weighted",
      ramp_rate_per_sec: 0.1,
      hysteresis_margin: 0.05,
      hysteresis_dwell_secs: 30,
      unit: "watts",
      verb: "set",
      target: "active_power",
    });
    assert.equal(result.success, false);
  });

  it("rejects children on a protocol other than distribute", () => {
    const result = CommandSourceEntry.safeParse({
      protocol: "modbus_tcp",
      function_code: 16,
      address: 50,
      unit: "watts",
      verb: "set",
      target: "active_power",
      children: [],
    });
    assert.equal(result.success, false);
  });
});

describe("protocolSourceJsonSchema / commandSourceJsonSchema", () => {
  it("includes every real protocol value, fixing the old stale enum", () => {
    const schema = protocolSourceJsonSchema();
    const dumped = JSON.stringify(schema);
    for (const protocol of [
      "modbus_tcp",
      "dnp3_tcp",
      "snmp",
      "redfish",
      "bacnet_ip",
      "bacnet_sc",
      "synthetic",
    ]) {
      assert.ok(dumped.includes(`"${protocol}"`), `expected ${protocol} in schema`);
    }
    assert.ok(!dumped.includes('"dnp3"'), "stale 'dnp3' spelling should be gone");
  });

  it("command-source schema includes distribute", () => {
    const schema = commandSourceJsonSchema();
    assert.ok(JSON.stringify(schema).includes('"distribute"'));
  });
});

describe("validateProtocolSourceMap / validateCommandSourceMap", () => {
  it("passes a well-formed map through unchanged", () => {
    const map = {
      bess_rack_1: {
        active_power: {
          protocol: "modbus_tcp",
          function_code: 3,
          address: 10,
          unit: "watts",
          poll_rate_hz: 1,
        },
      },
    };
    assert.deepEqual(validateProtocolSourceMap(map), map);
  });

  it("throws with the offending device/channel named, on a malformed entry", () => {
    const map = {
      bess_rack_1: {
        active_power: { protocol: "not_a_real_protocol", unit: "watts" },
      },
    };
    assert.throws(() => validateProtocolSourceMap(map), /bess_rack_1.*active_power/);
  });

  it("validates a well-formed command-source map", () => {
    const map = {
      bess_module_1: {
        set_active_power: {
          protocol: "distribute",
          allocation_policy: "equal_split",
          unit: "watts",
          verb: "set",
          target: "active_power",
        },
      },
    };
    assert.deepEqual(validateCommandSourceMap(map), map);
  });
});
