import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deviceBounds } from "./device_bounds";
import { projectDtmToView } from "./topology.view";
import type { DtmType } from "./dtm.schema";

const RACK_W = 1_927_000;

/**
 * A bess_module whose set_active_power distributes to `rackCount` racks rated ±RACK_W,
 * shaped like edp-api's bess_module + bess_rack.
 * @param rackCount How many racks sit under the module
 * @returns A DTM fixture (not schema-parsed — the projection never re-parses)
 */
function dtmWithRacks(rackCount: number): DtmType {
  const devices: Record<string, unknown> = {
    bess_module_1: {
      device_id: "bess_module_1",
      template: "bess_module",
      parent: null,
      connection: null,
    },
  };
  for (let index = 1; index <= rackCount; index += 1) {
    devices[`bess_rack_${index}`] = {
      device_id: `bess_rack_${index}`,
      template: "bess_rack",
      parent: "bess_module_1",
      connection: null,
    };
  }
  const float = { unit: "watts", type: "float", bounds: null };
  return {
    deployment_uuid: "00000000-0000-0000-0000-000000000ddd",
    sizing_params: { bess_reserve_floor_mwh: 0 },
    devices,
    buses: [],
    templates_used: {
      bess_module: {
        template: "bess_module",
        kind: "module",
        measurements: { active_power: float },
        commands: {
          set_active_power: {
            verb: "set",
            target: "active_power",
            unit: "watts",
            payload: "float",
            binding: { protocol: "distribute" },
          },
        },
      },
      bess_rack: {
        template: "bess_rack",
        kind: "leaf",
        measurements: {
          active_power: {
            ...float,
            bounds: { min: -RACK_W, max: RACK_W, nominal: 0 },
          },
          state_of_charge: { unit: "percent", type: "float", bounds: null },
          operating_state: { unit: "none", type: "enum", bounds: null },
        },
        commands: {
          set_active_power: {
            verb: "set",
            target: "active_power",
            unit: "watts",
            payload: "float",
          },
        },
      },
    },
  } as unknown as DtmType;
}

describe("deviceBounds", () => {
  it("sums the racks a module distributes to", () => {
    // Arrange
    const dtm = dtmWithRacks(3);

    // Act
    const bounds = deviceBounds(dtm, "bess_module_1");

    // Assert
    assert.deepEqual(bounds, {
      active_power: { min: -3 * RACK_W, max: 3 * RACK_W, nominal: 0 },
    });
  });

  it("is null for a module with no racks under it", () => {
    assert.equal(deviceBounds(dtmWithRacks(0), "bess_module_1"), null);
  });

  it("is null for a device that distributes nothing", () => {
    assert.equal(deviceBounds(dtmWithRacks(2), "bess_rack_1"), null);
  });

  it("is null when a rack carries no rated range to sum", () => {
    // Arrange — the gateway can't dispatch this module either; /asyncapi says why.
    const dtm = dtmWithRacks(2);
    dtm.templates_used["bess_rack"]!.measurements["active_power"]!.bounds =
      null;

    // Act + Assert
    assert.equal(deviceBounds(dtm, "bess_module_1"), null);
  });
});

describe("projectDtmToView bounds", () => {
  it("puts the module's derived range on its device", () => {
    // Act
    const view = projectDtmToView(dtmWithRacks(2));

    // Assert
    assert.deepEqual(view.devices["bess_module_1"]!.bounds, {
      active_power: { min: -2 * RACK_W, max: 2 * RACK_W, nominal: 0 },
    });
    assert.equal(view.devices["bess_rack_1"]!.bounds, null);
  });
});
