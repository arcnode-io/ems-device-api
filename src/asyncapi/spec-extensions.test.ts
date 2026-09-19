/**
 * Unit tests for spec-extensions — focused on the synthetic-binding
 * `{device_id}` placeholder substitution at AsyncAPI generation time.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAlarmsMap,
  buildProtocolSourceMap,
  buildCommandSourceMap,
} from "./spec-extensions";
import type { DtmType } from "../topology/dtm.schema";

/**
 * Minimal DTM with a real bound command (mirrors bess_rack.set_active_power:
 * a real Modbus write, function_code 16) alongside a bound measurement on
 * the same device, so the two source maps can be told apart.
 */
function dtmWithBoundCommand(): DtmType {
  return {
    deployment_uuid: "00000000-0000-0000-0000-000000000bbb",
    sizing_params: {
      P_compute_total_kW: 100,
      E_BESS_total_kWh: 200,
      T_coolant_setpoint_C: 18,
    },
    devices: {
      bess_rack_1: {
        device_id: "bess_rack_1",
        template: "bess_rack",
        parent: null,
        display_name: null,
        connection: null,
      },
    },
    buses: [],
    templates_used: {
      bess_rack: {
        template: "bess_rack",
        kind: "leaf",
        equipment_id: "EXT-BESS-001",
        vendor: "Tesla",
        model: "Megapack 2 XL",
        description: "bound-command fixture",
        contains: [],
        measurements: {
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
        },
        commands: {
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
        },
        alarms: [],
      },
    },
  } as unknown as DtmType;
}

/**
 * Minimal DTM that exercises a synthetic binding on a module-kind device.
 * The synthetic input topic carries a literal device reference
 * (`operating_envelope`) and a `{device_id}` placeholder that should be
 * substituted with the instantiating device's id (`bess_module_1`) at
 * AsyncAPI generation time. `{site_id}` stays unresolved — gateway runtime substitutes.
 */
function dtmWithSyntheticHeadroom(): DtmType {
  return {
    deployment_uuid: "00000000-0000-0000-0000-000000000aaa",
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
    },
    buses: [],
    templates_used: {
      bess_module: {
        template: "bess_module",
        kind: "module",
        equipment_id: null,
        vendor: null,
        model: null,
        description: "synthetic-headroom fixture",
        contains: [],
        commands: {},
        measurements: {
          import_headroom: {
            unit: "watts",
            type: "float",
            iec_61850_ref: "MMXU.W",
            poll_rate_hz: 1,
            display_name_default: "Module Import Headroom",
            bounds: { min: 0, max: 1, nominal: 0 },
            thresholds: {
              warn_min: 0,
              warn_max: 1,
              alarm_min: 0,
              alarm_max: 1,
            },
            values: null,
            publisher: "gateway",
            binding: {
              protocol: "synthetic",
              operation: "subtract",
              inputs: [
                "sites/{site_id}/devices/operating_envelope/measurements/import_limit/watts",
                "sites/{site_id}/devices/{device_id}/measurements/active_power/watts",
              ],
            },
          },
        },
      },
    },
  } as unknown as DtmType;
}

/**
 * DTM with one leaf carrying an alarm catalog (mirrors a SKU like GRD-SWG-001).
 * Plus a module-kind device whose template has no equipment_id and therefore
 * alarms=[] — must be skipped by buildAlarmsMap per handoff caveat.
 */
function dtmWithAlarms(): DtmType {
  return {
    deployment_uuid: "00000000-0000-0000-0000-000000000bbb",
    sizing_params: {
      P_compute_total_kW: 100,
      E_BESS_total_kWh: 200,
      T_coolant_setpoint_C: 18,
    },
    devices: {
      switchgear_1: {
        device_id: "switchgear_1",
        template: "switchgear",
        parent: null,
        display_name: null,
        connection: null,
      },
      bess_module_1: {
        device_id: "bess_module_1",
        template: "bess_module",
        parent: null,
        display_name: null,
        connection: null,
      },
    },
    buses: [],
    templates_used: {
      switchgear: {
        template: "switchgear",
        kind: "leaf",
        equipment_id: "GRD-SWG-001",
        vendor: "ABB",
        model: "SafeGear",
        description: "Switchgear leaf with alarms",
        contains: [],
        commands: {},
        measurements: {
          voltage: {
            unit: "V",
            type: "float",
            iec_61850_ref: "MMXU.PhV",
            poll_rate_hz: 1,
            display_name_default: null,
            bounds: { min: 0, max: 500, nominal: 240 },
            thresholds: {
              warn_min: 200,
              warn_max: 260,
              alarm_min: 180,
              alarm_max: 280,
            },
            values: null,
            publisher: null,
            binding: {
              protocol: "modbus_tcp",
              function_code: 3,
              address: 100,
              data_type: "int16",
              word_order: "high_low",
              scale: 1.0,
              offset: 0.0,
            },
          },
        },
        alarms: [
          {
            id: "arc_flash_trip",
            description: "Arc-flash relay tripped breaker",
            condition_source: {
              type: "discrete_register",
              address: 100,
              meaning_when_set: "alarm",
            },
            priority: "P1",
            operator_action: "Evacuate; verify isolation.",
            on_delay_ms: 0,
            off_delay_ms: 0,
            reset: "latched",
            reference_doc: "SEL-351 §7.4.1",
          },
        ],
      },
      bess_module: {
        template: "bess_module",
        kind: "module",
        equipment_id: null,
        vendor: null,
        model: null,
        description: "module — no alarms",
        contains: [],
        commands: {},
        measurements: {
          soc: {
            unit: "%",
            type: "float",
            iec_61850_ref: "ZBAT.BatChaSt",
            poll_rate_hz: 1,
            display_name_default: null,
            bounds: { min: 0, max: 100, nominal: 50 },
            thresholds: {
              warn_min: 10,
              warn_max: 90,
              alarm_min: 5,
              alarm_max: 95,
            },
            values: null,
            publisher: "local_process",
            binding: null,
          },
        },
        alarms: [],
      },
    },
  } as unknown as DtmType;
}

/**
 * bess_module_1 with two bess_rack children, wired with real Phase I
 * bindings on the MODULE's own measurements/command (not just testing the
 * resolver functions in isolation — this exercises the full
 * buildProtocolSourceMap/buildCommandSourceMap pipeline the way a real
 * deployment would): active_power sums across children, state_of_charge is
 * capacity-weighted, set_active_power distributes via equal_split.
 * @returns A DTM fixture wiring source_measurement + distribute end to end
 */
function dtmWithRollupBindings(): DtmType {
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
      thresholds: { warn_min: 15, warn_max: 90, alarm_min: 5, alarm_max: 95 },
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
    deployment_uuid: "00000000-0000-0000-0000-000000000eee",
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
      bess_rack_1: {
        device_id: "bess_rack_1",
        template: "bess_rack",
        parent: "bess_module_1",
        display_name: null,
        connection: null,
      },
      bess_rack_2: {
        device_id: "bess_rack_2",
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
        description: "rollup pipeline fixture",
        contains: [],
        measurements: {
          active_power: {
            unit: "watts",
            type: "float",
            iec_61850_ref: null,
            poll_rate_hz: 1,
            display_name_default: "Module Active Power",
            bounds: null,
            thresholds: null,
            values: null,
            publisher: "gateway",
            binding: {
              protocol: "synthetic",
              operation: "sum",
              source_measurement: "active_power",
            },
          },
          state_of_charge: {
            unit: "percent",
            type: "float",
            iec_61850_ref: null,
            poll_rate_hz: 1,
            display_name_default: "Module State of Charge",
            bounds: null,
            thresholds: null,
            values: null,
            publisher: "gateway",
            binding: {
              protocol: "synthetic",
              operation: "weighted_mean",
              source_measurement: "state_of_charge",
            },
          },
        },
        commands: {
          set_active_power: {
            verb: "set",
            target: "active_power",
            unit: "watts",
            payload: "float",
            display_name_default: null,
            fanout: null,
            binding: {
              protocol: "distribute",
              allocation_policy: "equal_split",
            },
          },
        },
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

describe("buildProtocolSourceMap / buildCommandSourceMap — bess_system rollup end to end", () => {
  it("resolves active_power (sum) into flat inputs[] across both racks", () => {
    const map = buildProtocolSourceMap(dtmWithRollupBindings());
    const entry = map.bess_module_1?.active_power as
      | { protocol: string; operation: string; inputs: string[] }
      | undefined;

    assert.ok(entry, "expected active_power in x-protocol-source");
    assert.equal(entry.protocol, "synthetic");
    assert.equal(entry.operation, "sum");
    assert.deepEqual(entry.inputs, [
      "sites/{site_id}/devices/bess_rack_1/measurements/active_power/watts",
      "sites/{site_id}/devices/bess_rack_2/measurements/active_power/watts",
    ]);
  });

  it("resolves state_of_charge (weighted_mean) into {topic,weight} pairs", () => {
    const map = buildProtocolSourceMap(dtmWithRollupBindings());
    const entry = map.bess_module_1?.state_of_charge as
      | { protocol: string; operation: string; pairs: { topic: string; weight: number }[] }
      | undefined;

    assert.ok(entry, "expected state_of_charge in x-protocol-source");
    assert.equal(entry.operation, "weighted_mean");
    assert.deepEqual(entry.pairs, [
      {
        topic:
          "sites/{site_id}/devices/bess_rack_1/measurements/state_of_charge/percent",
        weight: 4000.0,
      },
      {
        topic:
          "sites/{site_id}/devices/bess_rack_2/measurements/state_of_charge/percent",
        weight: 4000.0,
      },
    ]);
  });

  it("resolves set_active_power (distribute) into children[] with health/SoC topics + bounds", () => {
    const map = buildCommandSourceMap(dtmWithRollupBindings());
    const entry = map.bess_module_1?.set_active_power as
      | {
          protocol: string;
          allocation_policy: string;
          verb: string;
          target: string;
          children: {
            device_id: string;
            operating_state_topic: string;
            state_of_charge_topic: string;
            power_min: number;
            power_max: number;
          }[];
        }
      | undefined;

    assert.ok(entry, "expected set_active_power in x-command-source");
    assert.equal(entry.protocol, "distribute");
    assert.equal(entry.allocation_policy, "equal_split");
    assert.equal(entry.verb, "set");
    assert.equal(entry.target, "active_power");
    assert.deepEqual(entry.children, [
      {
        device_id: "bess_rack_1",
        operating_state_topic:
          "sites/{site_id}/devices/bess_rack_1/measurements/operating_state/none",
        state_of_charge_topic:
          "sites/{site_id}/devices/bess_rack_1/measurements/state_of_charge/percent",
        power_min: -4000000,
        power_max: 4000000,
      },
      {
        device_id: "bess_rack_2",
        operating_state_topic:
          "sites/{site_id}/devices/bess_rack_2/measurements/operating_state/none",
        state_of_charge_topic:
          "sites/{site_id}/devices/bess_rack_2/measurements/state_of_charge/percent",
        power_min: -4000000,
        power_max: 4000000,
      },
    ]);
  });
});

describe("buildCommandSourceMap — envelope-guarded distribute end to end", () => {
  /**
   * dtmWithRollupBindings() plus an operating_envelope singleton device and
   * ramp/hysteresis fields on the distribute binding — isolated from the
   * plain-distribute e2e test above so that one stays a real assertion of
   * the un-guarded shape.
   * @returns The rollup fixture, mutated to exercise envelope-guard resolution
   */
  function dtmWithEnvelopeGuard(): DtmType {
    const dtm = dtmWithRollupBindings();
    dtm.devices.operating_envelope = {
      device_id: "operating_envelope",
      template: "operating_envelope",
      blocking: [],
      parent: null,
      display_name: null,
      connection: null,
    };
    dtm.templates_used.operating_envelope = {
      template: "operating_envelope",
      kind: "leaf",
      equipment_id: "EXT-DOE-001",
      vendor: "Test",
      model: "Test DOE",
      capacity_kwh: null,
      description: "envelope fixture",
      contains: [],
      commands: {},
      measurements: {
        import_limit: { unit: "watts", type: "float", publisher: "gateway" },
        export_limit: { unit: "watts", type: "float", publisher: "gateway" },
      },
      alarms: [],
    } as unknown as DtmType["templates_used"][string];
    dtm.templates_used.bess_module!.commands.set_active_power!.binding = {
      protocol: "distribute",
      allocation_policy: "equal_split",
      ramp_rate_per_sec: 0.1,
      hysteresis_margin: 0.05,
      hysteresis_dwell_secs: 30.0,
    } as unknown as DtmType["templates_used"][string]["commands"][string]["binding"];
    return dtm;
  }

  it("resolves envelope-guard bounds + topics alongside children[]", () => {
    const map = buildCommandSourceMap(dtmWithEnvelopeGuard());
    const entry = map.bess_module_1?.set_active_power as
      | {
          ramp_rate_per_sec: number;
          hysteresis_margin: number;
          hysteresis_dwell_secs: number;
          power_min: number;
          power_max: number;
          import_limit_topic: string;
          export_limit_topic: string;
          active_power_topic: string;
        }
      | undefined;

    assert.ok(entry, "expected set_active_power in x-command-source");
    assert.equal(entry.ramp_rate_per_sec, 0.1);
    assert.equal(entry.hysteresis_margin, 0.05);
    assert.equal(entry.hysteresis_dwell_secs, 30.0);
    assert.equal(entry.power_min, -8000000);
    assert.equal(entry.power_max, 8000000);
    assert.equal(
      entry.import_limit_topic,
      "sites/{site_id}/devices/operating_envelope/measurements/import_limit/watts",
    );
    assert.equal(
      entry.export_limit_topic,
      "sites/{site_id}/devices/operating_envelope/measurements/export_limit/watts",
    );
    assert.equal(
      entry.active_power_topic,
      "sites/{site_id}/devices/bess_module_1/measurements/active_power/watts",
    );
  });
});

describe("buildAlarmsMap", () => {
  it("projects per-device alarm catalogs keyed by device_id", () => {
    const dtm = dtmWithAlarms();

    const map = buildAlarmsMap(dtm);

    assert.deepEqual(Object.keys(map), ["switchgear_1"]);
    assert.equal(map.switchgear_1?.length, 1);
    assert.equal(map.switchgear_1?.[0]?.id, "arc_flash_trip");
  });

  it("skips devices whose template has empty alarms[] (modules + un-rationalized SKUs)", () => {
    const dtm = dtmWithAlarms();

    const map = buildAlarmsMap(dtm);

    assert.equal(map.bess_module_1, undefined);
  });

  it("skips devices whose template is missing from templates_used", () => {
    const dtm = dtmWithAlarms();
    dtm.devices.orphan = {
      device_id: "orphan",
      template: "ghost_template",
      blocking: [],
      parent: null,
      display_name: null,
      connection: null,
    };

    const map = buildAlarmsMap(dtm);

    assert.equal(map.orphan, undefined);
  });
});

describe("buildProtocolSourceMap synthetic placeholder substitution", () => {
  it("substitutes {device_id} with the instantiating device's id", () => {
    // Arrange
    const dtm = dtmWithSyntheticHeadroom();

    // Act
    const map = buildProtocolSourceMap(dtm);
    const headroom = map.bess_module_1?.import_headroom as
      | Record<string, unknown>
      | undefined;
    const inputs = headroom?.inputs as string[] | undefined;

    // Assert — {device_id} → bess_module_1; {site_id} preserved
    assert.ok(inputs, "expected inputs[] on synthetic binding entry");
    assert.deepEqual(inputs, [
      "sites/{site_id}/devices/operating_envelope/measurements/import_limit/watts",
      "sites/{site_id}/devices/bess_module_1/measurements/active_power/watts",
    ]);
  });

  it("passes non-synthetic bindings through unchanged", () => {
    // Arrange — same DTM but flip the binding to modbus (no substitution semantics)
    const dtm = dtmWithSyntheticHeadroom();
    const bessTpl = dtm.templates_used.bess_module!;
    const meas = bessTpl.measurements.import_headroom!;
    meas.binding = {
      protocol: "modbus_tcp",
      function_code: 3,
      address: 0,
      data_type: "int16",
      word_order: "high_low",
      scale: 1.0,
      offset: 0.0,
    };
    meas.publisher = null;

    // Act
    const map = buildProtocolSourceMap(dtm);
    const headroom = map.bess_module_1?.import_headroom;

    // Assert — modbus binding fields intact, no substitution happened
    assert.equal((headroom as { protocol: string }).protocol, "modbus_tcp");
    assert.equal((headroom as { function_code: number }).function_code, 3);
  });
});

describe("x-protocol-source / x-command-source split", () => {
  it("buildProtocolSourceMap never includes a bound command", () => {
    // Arrange
    const dtm = dtmWithBoundCommand();

    // Act
    const map = buildProtocolSourceMap(dtm);

    // Assert — only the measurement shows up, never set_active_power
    assert.deepEqual(Object.keys(map.bess_rack_1 ?? {}), ["active_power"]);
  });

  it("buildCommandSourceMap includes the bound command with verb + target", () => {
    // Arrange
    const dtm = dtmWithBoundCommand();

    // Act
    const map = buildCommandSourceMap(dtm);
    const entry = map.bess_rack_1?.set_active_power as
      | Record<string, unknown>
      | undefined;

    // Assert — the fields a consumer resolving commands/set/active_power/watts
    // actually needs, present without guessing from the channel name
    assert.ok(entry, "expected set_active_power in x-command-source");
    assert.equal(entry.verb, "set");
    assert.equal(entry.target, "active_power");
    assert.equal(entry.protocol, "modbus_tcp");
    assert.equal(entry.function_code, 16);
    assert.equal(entry.address, 50);
  });

  it("buildCommandSourceMap never includes a bound measurement", () => {
    // Arrange
    const dtm = dtmWithBoundCommand();

    // Act
    const map = buildCommandSourceMap(dtm);

    // Assert — only the command shows up, never active_power
    assert.deepEqual(Object.keys(map.bess_rack_1 ?? {}), ["set_active_power"]);
  });
});
