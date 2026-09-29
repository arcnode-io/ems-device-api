/**
 * Unit tests for DTM → HMI-view projection per system_adr §22.
 * Asserts gateway-only fields are stripped and HMI-needed metadata is retained.
 */

import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { projectDtmToView } from "./topology.view";
import type { DtmType } from "./dtm.schema";

const modbusBinding = {
  protocol: "modbus_tcp" as const,
  function_code: 3,
  address: 100,
};

const socBounds = { min: 0, max: 100, nominal: 50 };
const socThresholds = {
  warn_min: 10,
  warn_max: 90,
  alarm_min: 5,
  alarm_max: 95,
};

const baseDtm: DtmType = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
  mode: "sim",
  sizing_ref: null,
  sizing_params: {
    P_compute_total_kW: 100.0,
    E_BESS_total_kWh: 200.0,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {
    bess_01: {
      device_id: "bess_01",
      template: "bess_leaf",
      parent: null,
      display_name: "BESS Unit 1",
      connection: { host: "10.0.0.5", port: 502, unit_id: null },
      blocking: ["live_mode"],
      extra_measurements: null,
    },
  },
  buses: [
    {
      bus_id: "dc_bus_1",
      type: "dc",
      members: [{ device_id: "bess_01", port: null }],
    },
  ],
  templates_used: {
    bess_leaf: {
      template: "bess_leaf",
      kind: "leaf",
      equipment_id: "EQ-001",
      vendor: "Acme",
      model: "X1",
      description: "BESS leaf",
      contains: [],
      measurements: {
        soc: {
          unit: "%",
          type: "float",
          poll_rate_hz: 1,
          display_name_default: "State of Charge",
          iec_61850_ref: "ZBAT.BatChaSt",
          bounds: socBounds,
          thresholds: socThresholds,
          values: null,
          binding: modbusBinding,
          publisher: null,
        },
      },
      commands: {
        set_power: {
          verb: "set",
          target: "active_power",
          unit: "watts",
          payload: "float",
          display_name_default: "Set Power",
          binding: modbusBinding,
          fanout: null,
        },
      },
    },
  },
} as unknown as DtmType;

describe("projectDtmToView", () => {
  it("strips device.connection", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);

    // Assert
    assert.ok(!("connection" in view.devices["bess_01"]!));
  });

  it("strips measurement.binding and measurement.publisher", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);
    const soc = view.templates_used["bess_leaf"]!.measurements["soc"]!;

    // Assert
    assert.ok(!("binding" in soc));
    assert.ok(!("publisher" in soc));
  });

  it("strips command.binding and command.fanout", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);
    const cmd = view.templates_used["bess_leaf"]!.commands["set_power"]!;

    // Assert
    assert.ok(!("binding" in cmd));
    assert.ok(!("fanout" in cmd));
  });

  it("retains measurement.iec_61850_ref", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);
    const soc = view.templates_used["bess_leaf"]!.measurements["soc"]!;

    // Assert
    assert.equal(soc.iec_61850_ref, "ZBAT.BatChaSt");
  });

  it("retains measurement.bounds and measurement.thresholds", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);
    const soc = view.templates_used["bess_leaf"]!.measurements["soc"]!;

    // Assert
    assert.deepEqual(soc.bounds, socBounds);
    assert.deepEqual(soc.thresholds, socThresholds);
  });

  it("retains device.template + parent + display_name + blocking", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);
    const dev = view.devices["bess_01"]!;

    // Assert
    assert.equal(dev.template, "bess_leaf");
    assert.equal(dev.parent, null);
    assert.equal(dev.display_name, "BESS Unit 1");
    // blocking is no longer projected — ADR §25 dropped what it gated.
    assert.equal(dev.provisioned, true);
  });

  it("retains buses[] verbatim", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);

    // Assert
    assert.deepEqual(view.buses, dtm.buses);
  });

  it("retains deployment_uuid, ems_mode, sizing_params", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);

    // Assert
    assert.equal(view.deployment_uuid, dtm.deployment_uuid);
    assert.equal(view.ems_mode, "sim");
    assert.deepEqual(view.sizing_params, dtm.sizing_params);
  });
});

describe("projectDtmToView ems_mode default", () => {
  it("defaults ems_mode to sim when the DTM has no computed mode", () => {
    // Arrange — hand-built DTMs (fixtures, tests) omit edp-api's computed mode.
    const dtm = structuredClone(baseDtm);
    delete (dtm as { mode?: string }).mode;
    // Act
    const view = projectDtmToView(dtm);
    // Assert — the HMI's TopologyView schema REQUIRES ems_mode (sim|live);
    // an absent field rejects the whole view and blanks the SPA.
    assert.equal(view.ems_mode, "sim");
  });
});

describe("projectDtmToView bess reserve floor", () => {
  it("derives pack capacity from the racks, not from sizing_params", () => {
    // Arrange — two racks at 4000 kWh each (8 MWh pack), 1.0 MWh reserved.
    // E_BESS_total_kWh deliberately disagrees: the instantiated racks are what
    // physically exist, so they are the pack.
    const dtm: DtmType = {
      ...baseDtm,
      sizing_params: {
        ...baseDtm.sizing_params,
        E_BESS_total_kWh: 200.0,
        bess_reserve_floor_mwh: 1.0,
      },
      devices: {
        bess_rack_01: {
          ...baseDtm.devices["bess_01"]!,
          device_id: "bess_rack_01",
        },
        bess_rack_02: {
          ...baseDtm.devices["bess_01"]!,
          device_id: "bess_rack_02",
        },
      },
      templates_used: {
        bess_leaf: {
          ...baseDtm.templates_used["bess_leaf"]!,
          capacity_kwh: 4000.0,
        },
      },
      buses: [],
    };

    // Act
    const view = projectDtmToView(dtm);

    // Assert — one derivation, shared with the gateway's own floor percent.
    assert.deepEqual(view.bess, {
      pack_mwh: 8.0,
      reserve_floor_mwh: 1.0,
      reserve_floor_pct: 12.5,
    });
  });

  it("is null when the DTM has no rack capacity to reserve from", () => {
    // Arrange — baseDtm's template leaves capacity_kwh at its null default.
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);

    // Assert
    assert.equal(view.bess, null);
  });
});

describe("projectDtmToView provisioned flag", () => {
  it("is false while a device's address is still the commissioning sentinel", () => {
    // Arrange — how every device ships before commissioning (ADR §25).
    const dtm = structuredClone(baseDtm);
    dtm.devices["bess_01"]!.connection = {
      host: "PROVISIONED_AT_COMMISSIONING",
      port: "PROVISIONED_AT_COMMISSIONING",
      unit_id: null,
    } as unknown as DtmType["devices"][string]["connection"];

    // Act
    const view = projectDtmToView(dtm);

    // Assert — the HMI keys grey off this; /topology/view strips connection
    // fields, so it has no other way to know.
    assert.equal(view.devices["bess_01"]!.provisioned, false);
  });

  it("is false when only one of host or port is provisioned", () => {
    // Arrange
    const dtm = structuredClone(baseDtm);
    dtm.devices["bess_01"]!.connection = {
      host: "10.0.0.5",
      port: "PROVISIONED_AT_COMMISSIONING",
      unit_id: null,
    } as unknown as DtmType["devices"][string]["connection"];

    // Act + Assert
    assert.equal(projectDtmToView(dtm).devices["bess_01"]!.provisioned, false);
  });

  it("is true for a device with no connection — a module, not an unprovisioned leaf", () => {
    // Arrange — a module has no address because it has no physical device.
    // Greying a working synthetic aggregate would be wrong.
    const dtm = structuredClone(baseDtm);
    dtm.devices["bess_01"]!.connection = null;

    // Act + Assert
    assert.equal(projectDtmToView(dtm).devices["bess_01"]!.provisioned, true);
  });

  it("accepts a DTM that still carries blocking, and drops it from the view", () => {
    // Arrange — edp-api still emits blocking until it removes the field, and
    // persisted DTMs carry it indefinitely. Device is strictObject, so the field
    // has to stay accepted.
    const dtm = structuredClone(baseDtm);
    (dtm.devices["bess_01"] as unknown as { blocking: string[] }).blocking = [
      "live_mode",
    ];

    // Act
    const view = projectDtmToView(dtm);

    // Assert
    assert.equal("blocking" in view.devices["bess_01"]!, false);
  });
});
