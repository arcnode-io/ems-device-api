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
} from "./spec-extensions";
import type { DtmType } from "../topology/dtm.schema";

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
              formula: "subtract",
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
            publisher: "line_controller",
            binding: null,
          },
        },
        alarms: [],
      },
    },
  } as unknown as DtmType;
}

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
