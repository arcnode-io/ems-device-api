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
    assert.deepEqual(dev.blocking, ["live_mode"]);
  });

  it("retains buses[] verbatim", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);

    // Assert
    assert.deepEqual(view.buses, dtm.buses);
  });

  it("retains deployment_uuid, mode, sizing_params", () => {
    // Arrange
    const dtm = baseDtm;

    // Act
    const view = projectDtmToView(dtm);

    // Assert
    assert.equal(view.deployment_uuid, dtm.deployment_uuid);
    assert.equal(view.mode, "sim");
    assert.deepEqual(view.sizing_params, dtm.sizing_params);
  });
});
