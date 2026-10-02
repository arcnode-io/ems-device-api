/**
 * Unit tests for spec-generator — specifically that buildSpec self-validates
 * the resolved x-protocol-source/x-command-source maps against the real
 * contract (spec-contract.ts) before returning, rather than just trusting
 * the resolvers blindly.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSpec } from "./spec-generator";
import { Dtm } from "../topology/dtm.schema";
import type { DtmType } from "../topology/dtm.schema";

/**
 * Minimal DTM with one real bound measurement + command — happy path only.
 * @returns A DTM fixture
 */
function dtm(): DtmType {
  return {
    deployment_uuid: "00000000-0000-0000-0000-00000000gen1",
    sizing_params: {
      P_compute_total_kW: 1,
      E_BESS_total_kWh: 1,
      T_coolant_setpoint_C: 1,
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
        capacity_kwh: 4000.0,
        description: "fixture",
        contains: [],
        measurements: {
          active_power: {
            unit: "watts",
            type: "float",
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

describe("buildSpec self-validation", () => {
  it("returns a spec unchanged when x-protocol-source/x-command-source pass contract validation", () => {
    const spec = buildSpec(dtm(), "1.0.0") as unknown as {
      "x-protocol-source": Record<string, Record<string, { protocol: string }>>;
      "x-command-source": Record<string, Record<string, { protocol: string }>>;
    };

    assert.equal(
      spec["x-protocol-source"].bess_rack_1?.active_power?.protocol,
      "modbus_tcp",
    );
    assert.equal(
      spec["x-command-source"].bess_rack_1?.set_active_power?.protocol,
      "modbus_tcp",
    );
  });
});

describe("buildSpec payload refs", () => {
  it("points every x-protocol-source entry at a schema the spec declares", () => {
    // Arrange
    const spec = buildSpec(dtm(), "1.0.0") as unknown as {
      "x-protocol-source": Record<
        string,
        Record<string, { payload: { $ref: string } }>
      >;
      components: { schemas: Record<string, unknown> };
    };

    // Act — every ref the source map emits, and the schemas on offer
    const refs = Object.values(spec["x-protocol-source"]).flatMap((channels) =>
      Object.values(channels).map((entry) => entry.payload.$ref),
    );
    const declared = Object.keys(spec.components.schemas).map(
      (name) => `#/components/schemas/${name}`,
    );

    // Assert — a dangling ref would leave the gateway guessing the wire type,
    // which is the thing the ref exists to stop.
    assert.deepEqual(
      refs.filter((ref) => !declared.includes(ref)),
      [],
    );
    assert.deepEqual(refs, ["#/components/schemas/BessRack_ActivePower"]);
  });
});

/**
 * A relay whose unbalance is computed by the gateway from its own phase voltages.
 * @returns A DTM fixture with one synthetic `unbalance` measurement
 */
function dtmWithUnbalance(): DtmType {
  // Reason: parsed, not cast — a persisted row has every protocol default
  // applied, and casting a literal skips them.
  return Dtm.parse({
    deployment_uuid: "123e4567-e89b-12d3-a456-426614174abc",
    sizing_params: {
      P_compute_total_kW: 1,
      E_BESS_total_kWh: 1,
      T_coolant_setpoint_C: 18,
      ride_through_hours: 0,
      bess_reserve_floor_mwh: 0,
    },
    devices: {
      relay_01: {
        device_id: "relay_01",
        template: "protective_relay",
        connection: { host: "10.0.0.9", port: 20000 },
      },
    },
    buses: [],
    templates_used: {
      protective_relay: {
        template: "protective_relay",
        kind: "leaf",
        equipment_id: "RLY-001",
        vendor: "SEL",
        model: "751",
        description: "feeder relay",
        commands: {},
        alarms: [],
        measurements: {
          phase_voltage_a: {
            unit: "volts",
            type: "float",
            binding: {
              protocol: "dnp3_tcp",
              point_index: 0,
              point_type: "analog_input",
            },
          },
          voltage_unbalance_pct: {
            unit: "percent",
            type: "float",
            publisher: "gateway",
            binding: {
              protocol: "synthetic",
              operation: "unbalance",
              inputs: ["phase_voltage_a", "phase_voltage_b", "phase_voltage_c"],
            },
          },
        },
      },
    },
  });
}

describe("buildSpec synthetic unbalance", () => {
  it("resolves an unbalance entry the gateway can consume", () => {
    // Arrange / Act — buildSpec validates every entry against the published
    // contract before returning, so this failing is how a new operation that
    // the resolved-entry shape rejects would surface.
    const spec = buildSpec(dtmWithUnbalance(), "1.0.0") as unknown as {
      "x-protocol-source": Record<
        string,
        Record<
          string,
          { operation?: string; inputs?: string[]; payload: { $ref: string } }
        >
      >;
    };
    const entry = spec["x-protocol-source"].relay_01?.voltage_unbalance_pct;

    // Assert — inputs mode survives resolution, and the entry carries the
    // payload ref so the gateway publishes it as its declared type.
    assert.equal(entry?.operation, "unbalance");
    assert.deepEqual(entry?.inputs, [
      "phase_voltage_a",
      "phase_voltage_b",
      "phase_voltage_c",
    ]);
    assert.equal(
      entry?.payload.$ref,
      "#/components/schemas/ProtectiveRelay_VoltageUnbalancePct",
    );
  });
});
