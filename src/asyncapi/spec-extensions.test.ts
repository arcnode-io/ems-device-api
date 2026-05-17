/**
 * Unit tests for spec-extensions — focused on the synthetic-binding
 * `{device_id}` placeholder substitution at AsyncAPI generation time.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildProtocolSourceMap } from "./spec-extensions";
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
            thresholds: { warn_min: 0, warn_max: 1, alarm_min: 0, alarm_max: 1 },
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
