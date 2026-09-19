/**
 * Unit tests for spec-rollup — Phase I children resolution for the
 * `synthetic` binding's `source_measurement` mode and the `distribute`
 * binding's `children[]` array. Both compile a dynamic, children-shaped
 * binding into the concrete topics/values the gateway consumes; neither
 * ever reaches the gateway unresolved.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveChildren,
  resolveSourceMeasurement,
  resolveDistributeChildren,
} from "./spec-rollup";
import type { DtmType } from "../topology/dtm.schema";

/**
 * bess_module_1 with two bess_rack children (rack_b, rack_a — deliberately
 * out of alphabetical order in `devices` to prove sorting), each with
 * capacity_kwh, active_power (bounds + a set_active_power command),
 * state_of_charge, and operating_state — everything a rollup/distribute
 * binding needs to resolve against.
 * @returns A DTM fixture with one module and two rack children
 */
function dtmWithRackChildren(): DtmType {
  const rackMeasurements = {
    active_power: {
      unit: "watts",
      type: "float",
      iec_61850_ref: "MMXU.W",
      poll_rate_hz: 1,
      display_name_default: null,
      bounds: { min: -4000000, max: 4000000, nominal: 0 },
      thresholds: {
        warn_min: -3800000,
        warn_max: 3800000,
        alarm_min: -4000000,
        alarm_max: 4000000,
      },
      values: null,
      publisher: null,
      binding: {
        protocol: "modbus_tcp",
        function_code: 3,
        address: 10,
        data_type: "int32",
        word_order: "high_low",
        scale: 1.0,
        offset: 0.0,
      },
    },
    state_of_charge: {
      unit: "percent",
      type: "float",
      iec_61850_ref: "ZBAT.BatChaSt",
      poll_rate_hz: 1,
      display_name_default: null,
      bounds: { min: 0, max: 100, nominal: 50 },
      thresholds: {
        warn_min: 15,
        warn_max: 90,
        alarm_min: 5,
        alarm_max: 95,
      },
      values: null,
      publisher: null,
      binding: {
        protocol: "modbus_tcp",
        function_code: 3,
        address: 0,
        data_type: "uint16",
        word_order: "high_low",
        scale: 0.1,
        offset: 0.0,
      },
    },
    operating_state: {
      unit: "none",
      type: "enum",
      iec_61850_ref: "ZGEN.Mod.stVal",
      poll_rate_hz: 1,
      display_name_default: null,
      bounds: null,
      thresholds: null,
      values: { "0": "STANDBY", "3": "FAULT", "4": "OFFLINE" },
      publisher: null,
      binding: {
        protocol: "modbus_tcp",
        function_code: 3,
        address: 40,
        data_type: "uint16",
        word_order: "high_low",
        scale: 1.0,
        offset: 0.0,
      },
    },
  };
  const rackCommands = {
    set_active_power: {
      verb: "set",
      target: "active_power",
      unit: "watts",
      payload: "float",
      display_name_default: null,
      fanout: null,
      binding: {
        protocol: "modbus_tcp",
        function_code: 16,
        address: 50,
        data_type: "int32",
        word_order: "high_low",
        scale: 1.0,
        offset: 0.0,
      },
    },
  };

  return {
    deployment_uuid: "00000000-0000-0000-0000-000000000ddd",
    sizing_params: {
      P_compute_total_kW: 100,
      E_BESS_total_kWh: 200,
      T_coolant_setpoint_C: 18,
    },
    devices: {
      bess_module_1: {
        device_id: "bess_module_1",
        template: "bess_module",
        parent: null,
        display_name: null,
        connection: null,
      },
      bess_rack_b: {
        device_id: "bess_rack_b",
        template: "bess_rack",
        parent: "bess_module_1",
        display_name: null,
        connection: null,
      },
      bess_rack_a: {
        device_id: "bess_rack_a",
        template: "bess_rack",
        parent: "bess_module_1",
        display_name: null,
        connection: null,
      },
    },
    buses: [],
    templates_used: {
      bess_module: {
        template: "bess_module",
        kind: "module",
        equipment_id: null,
        vendor: null,
        model: null,
        capacity_kwh: null,
        description: "rollup fixture",
        contains: [],
        commands: {},
        measurements: {},
        alarms: [],
      },
      bess_rack: {
        template: "bess_rack",
        kind: "leaf",
        equipment_id: "EXT-BESS-001",
        vendor: "Tesla",
        model: "Megapack 2 XL",
        capacity_kwh: 4000.0,
        description: "rack fixture",
        contains: [],
        measurements: rackMeasurements,
        commands: rackCommands,
        alarms: [],
      },
    },
  } as unknown as DtmType;
}

describe("resolveChildren", () => {
  it("finds every device whose parent matches, sorted by device_id", () => {
    const dtm = dtmWithRackChildren();
    const children = resolveChildren(dtm, "bess_module_1");
    assert.deepEqual(
      children.map((child) => child.device_id),
      ["bess_rack_a", "bess_rack_b"],
    );
  });

  it("returns empty array when no children exist", () => {
    const dtm = dtmWithRackChildren();
    const children = resolveChildren(dtm, "bess_rack_a");
    assert.deepEqual(children, []);
  });
});

describe("resolveSourceMeasurement", () => {
  it("resolves sum/mean/max/min into flat inputs[] across children", () => {
    const dtm = dtmWithRackChildren();
    const result = resolveSourceMeasurement(
      dtm,
      "bess_module_1",
      "active_power",
      "sum",
    );
    assert.deepEqual(result, {
      inputs: [
        "sites/{site_id}/devices/bess_rack_a/measurements/active_power/watts",
        "sites/{site_id}/devices/bess_rack_b/measurements/active_power/watts",
      ],
    });
  });

  it("resolves weighted_mean into {topic,weight} pairs using each child's capacity_kwh", () => {
    const dtm = dtmWithRackChildren();
    const result = resolveSourceMeasurement(
      dtm,
      "bess_module_1",
      "state_of_charge",
      "weighted_mean",
    );
    assert.deepEqual(result, {
      pairs: [
        {
          topic:
            "sites/{site_id}/devices/bess_rack_a/measurements/state_of_charge/percent",
          weight: 4000.0,
        },
        {
          topic:
            "sites/{site_id}/devices/bess_rack_b/measurements/state_of_charge/percent",
          weight: 4000.0,
        },
      ],
    });
  });

  it("throws when a child's template lacks the named measurement", () => {
    const dtm = dtmWithRackChildren();
    assert.throws(
      () => resolveSourceMeasurement(dtm, "bess_module_1", "reactive_power", "sum"),
      /reactive_power.*not found/,
    );
  });

  it("throws when weighted_mean but a child's capacity_kwh is null", () => {
    const dtm = dtmWithRackChildren();
    dtm.templates_used.bess_rack!.capacity_kwh = null;
    assert.throws(
      () =>
        resolveSourceMeasurement(
          dtm,
          "bess_module_1",
          "state_of_charge",
          "weighted_mean",
        ),
      /capacity_kwh/,
    );
  });
});

describe("resolveDistributeChildren", () => {
  it("resolves every child's health/SoC topics + target measurement bounds", () => {
    const dtm = dtmWithRackChildren();
    const children = resolveDistributeChildren(
      dtm,
      "bess_module_1",
      "set",
      "active_power",
    );
    assert.deepEqual(children, [
      {
        device_id: "bess_rack_a",
        operating_state_topic:
          "sites/{site_id}/devices/bess_rack_a/measurements/operating_state/none",
        state_of_charge_topic:
          "sites/{site_id}/devices/bess_rack_a/measurements/state_of_charge/percent",
        power_min: -4000000,
        power_max: 4000000,
      },
      {
        device_id: "bess_rack_b",
        operating_state_topic:
          "sites/{site_id}/devices/bess_rack_b/measurements/operating_state/none",
        state_of_charge_topic:
          "sites/{site_id}/devices/bess_rack_b/measurements/state_of_charge/percent",
        power_min: -4000000,
        power_max: 4000000,
      },
    ]);
  });

  it("throws when a child lacks a matching verb+target command", () => {
    const dtm = dtmWithRackChildren();
    assert.throws(
      () => resolveDistributeChildren(dtm, "bess_module_1", "set", "reactive_power"),
      /set\/reactive_power/,
    );
  });

  it("throws when a child lacks operating_state", () => {
    const dtm = dtmWithRackChildren();
    delete (dtm.templates_used.bess_rack!.measurements as Record<string, unknown>)
      .operating_state;
    assert.throws(
      () => resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
      /operating_state/,
    );
  });

  it("throws when a child lacks state_of_charge", () => {
    const dtm = dtmWithRackChildren();
    delete (dtm.templates_used.bess_rack!.measurements as Record<string, unknown>)
      .state_of_charge;
    assert.throws(
      () => resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
      /state_of_charge/,
    );
  });

  it("throws when the target measurement lacks bounds", () => {
    const dtm = dtmWithRackChildren();
    dtm.templates_used.bess_rack!.measurements.active_power!.bounds = null;
    assert.throws(
      () => resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
      /bounds/,
    );
  });
});
