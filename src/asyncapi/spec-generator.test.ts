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

/**
 * A compute hall shaped the way edp-api generates one: a module parenting a
 * mix of templates, where only some children carry the rolled-up measurement
 * and only some are cappable.
 * @param shedEnabled Whether the site lets the EMS cap compute on its own
 * @returns A DTM fixture
 */
function dtmWithComputeHall(shedEnabled: boolean): DtmType {
  const gpuNode = {
    template: "gpu_node",
    kind: "leaf",
    equipment_id: "GPU-001",
    vendor: "NVIDIA",
    model: "HGX B200",
    description: "gpu node",
    alarms: [],
    measurements: {
      gpu_1_power_limit: {
        unit: "watts",
        type: "float",
        bounds: { min: 200, max: 1000, nominal: 1000 },
        binding: {
          protocol: "redfish",
          uri: "/Systems/HGX/Processors/GPU_SXM_1/EnvironmentMetrics",
          json_pointer: "/PowerLimitWatts/SetPoint",
        },
      },
    },
    commands: {
      set_gpu_1_power_limit: {
        verb: "set",
        target: "gpu_1_power_limit",
        unit: "watts",
        payload: "float",
        binding: {
          protocol: "redfish",
          uri: "/Systems/HGX/Processors/GPU_SXM_1/EnvironmentMetrics",
          json_pointer: "/PowerLimitWatts/SetPoint",
        },
      },
    },
  };
  return Dtm.parse({
    deployment_uuid: "123e4567-e89b-12d3-a456-4266141740ff",
    sizing_params: {
      P_compute_total_kW: 1120,
      E_BESS_total_kWh: 8000,
      T_coolant_setpoint_C: 30,
      compute_shed_enabled: shedEnabled,
    },
    devices: {
      compute_module_01: {
        device_id: "compute_module_01",
        template: "compute_module",
      },
      // Both parented under the module, but only the gpu_node is cappable and
      // only the pdu carries input_power — the heterogeneity is the point.
      gpu_node_01: {
        device_id: "gpu_node_01",
        template: "gpu_node",
        parent: "compute_module_01",
        connection: { host: "10.0.0.20", port: 8443 },
      },
      pdu_01: {
        device_id: "pdu_01",
        template: "pdu",
        parent: "compute_module_01",
        connection: { host: "10.0.0.21", port: 161 },
      },
      operating_envelope: {
        device_id: "operating_envelope",
        template: "operating_envelope",
      },
      poi_meter_1: {
        device_id: "poi_meter_1",
        template: "poi_meter",
        connection: { host: "10.0.0.22", port: 502 },
      },
    },
    buses: [],
    templates_used: {
      gpu_node: gpuNode,
      pdu: {
        template: "pdu",
        kind: "leaf",
        equipment_id: "PDU-001",
        vendor: "Raritan",
        model: "PRO3X",
        description: "pdu",
        alarms: [],
        commands: {},
        measurements: {
          input_power: {
            unit: "watts",
            type: "float",
            binding: { protocol: "snmp", oid: "1.3.6.1.4.1.13742.6.5.4.3.1.4" },
          },
        },
      },
      compute_module: {
        template: "compute_module",
        kind: "module",
        description: "compute hall",
        alarms: [],
        measurements: {
          total_power: {
            unit: "watts",
            type: "float",
            publisher: "gateway",
            binding: {
              protocol: "synthetic",
              operation: "sum",
              source_measurement: "input_power",
              child_template: "pdu",
            },
          },
        },
        commands: {
          set_power_limit: {
            verb: "set",
            target: "power_limit",
            unit: "percent",
            payload: "float",
            binding: {
              protocol: "power_cap",
              child_template: "gpu_node",
              child_commands: ["set_gpu_1_power_limit"],
              ramp_rate_per_sec: 0.1,
              hysteresis_margin: 0.05,
              hysteresis_dwell_secs: 30,
            },
          },
        },
      },
      operating_envelope: {
        template: "operating_envelope",
        kind: "leaf",
        equipment_id: "ENV-001",
        vendor: "ARCNODE",
        model: "envelope",
        description: "envelope",
        alarms: [],
        commands: {},
        measurements: {
          import_limit: {
            unit: "watts",
            type: "float",
            publisher: "der_control_api",
          },
          export_limit: {
            unit: "watts",
            type: "float",
            publisher: "der_control_api",
          },
        },
      },
      poi_meter: {
        template: "poi_meter",
        kind: "leaf",
        equipment_id: "MTR-001",
        vendor: "Schneider",
        model: "ION9000",
        description: "poi meter",
        alarms: [],
        commands: {},
        measurements: {
          active_power: {
            unit: "watts",
            type: "float",
            binding: {
              protocol: "modbus_tcp",
              function_code: 3,
              address: 3060,
            },
          },
        },
      },
    },
  });
}

describe("buildSpec compute hall", () => {
  it("rolls up only the children of child_template", () => {
    // Arrange / Act
    const spec = buildSpec(dtmWithComputeHall(false), "1.0.0") as unknown as {
      "x-protocol-source": Record<
        string,
        Record<string, { inputs?: string[] }>
      >;
    };

    // Assert — the pdu carries input_power and the gpu_node does not, so a
    // rollup over every child would have thrown. Declaring the template is what
    // makes a heterogeneous module resolvable at all.
    assert.deepEqual(
      spec["x-protocol-source"].compute_module_01?.total_power?.inputs,
      ["sites/{site_id}/devices/pdu_01/measurements/input_power/watts"],
    );
  });

  it("fans a power_cap out to one child cap per listed command", () => {
    // Arrange / Act
    const spec = buildSpec(dtmWithComputeHall(false), "1.0.0") as unknown as {
      "x-command-source": Record<
        string,
        Record<string, Record<string, unknown>>
      >;
    };
    const entry = spec["x-command-source"].compute_module_01?.set_power_limit;

    // Assert — the range comes from the child's measurement bounds, and the
    // guard is absent because this site has not enabled shedding.
    assert.deepEqual(entry?.children, [
      {
        device_id: "gpu_node_01",
        target: "gpu_1_power_limit",
        min_w: 200,
        max_w: 1000,
      },
    ]);
    assert.equal(entry?.import_limit_topic, undefined);
    assert.equal(entry?.host, undefined);
  });

  it("resolves the envelope topics only when the site enables shedding", () => {
    // Arrange / Act
    const spec = buildSpec(dtmWithComputeHall(true), "1.0.0") as unknown as {
      "x-command-source": Record<
        string,
        Record<string, Record<string, unknown>>
      >;
    };
    const entry = spec["x-command-source"].compute_module_01?.set_power_limit;

    // Assert
    assert.equal(
      entry?.import_limit_topic,
      "sites/{site_id}/devices/operating_envelope/measurements/import_limit/watts",
    );
    assert.equal(
      entry?.poi_active_power_topic,
      "sites/{site_id}/devices/poi_meter_1/measurements/active_power/watts",
    );
    assert.equal(entry?.hysteresis_dwell_secs, 30);
  });
});
