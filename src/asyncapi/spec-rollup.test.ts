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
  resolveEnvelopeGuard,
  resolveStateOfChargeFloor,
  resolveOperatorReserve,
  resolveReadiness,
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

  it("treats a null child_template as every child", () => {
    // Reason: edp-api emits absent optionals as explicit null, so a synthetic
    // binding that rolls up every child arrives carrying child_template: null.
    // Reading that null as a slug matches no device, and the rollup then throws
    // "none were found" for a binding that is perfectly well formed.
    const dtm = dtmWithRackChildren();

    const children = resolveChildren(dtm, "bess_module_1", null);

    assert.deepEqual(
      children.map((child) => child.device_id),
      ["bess_rack_a", "bess_rack_b"],
    );
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
      () =>
        resolveSourceMeasurement(dtm, "bess_module_1", "reactive_power", "sum"),
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
      () =>
        resolveDistributeChildren(
          dtm,
          "bess_module_1",
          "set",
          "reactive_power",
        ),
      /set\/reactive_power/,
    );
  });

  it("throws when a child lacks operating_state", () => {
    const dtm = dtmWithRackChildren();
    delete (
      dtm.templates_used.bess_rack!.measurements as Record<string, unknown>
    ).operating_state;
    assert.throws(
      () =>
        resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
      /operating_state/,
    );
  });

  it("throws when a child lacks state_of_charge", () => {
    const dtm = dtmWithRackChildren();
    delete (
      dtm.templates_used.bess_rack!.measurements as Record<string, unknown>
    ).state_of_charge;
    assert.throws(
      () =>
        resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
      /state_of_charge/,
    );
  });

  it("throws when the target measurement lacks bounds", () => {
    const dtm = dtmWithRackChildren();
    dtm.templates_used.bess_rack!.measurements.active_power!.bounds = null;
    assert.throws(
      () =>
        resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
      /bounds/,
    );
  });
});

/**
 * Adds an `operating_envelope` singleton device + template (import_limit/
 * export_limit, matching the real edp-api convention) and a real
 * `active_power` measurement on bess_module's own template (needed for
 * `active_power_topic`) to an existing rack-children fixture, in place.
 * @param dtm A DTM built by dtmWithRackChildren(), mutated in place
 */
function addEnvelopeGuardFixtures(dtm: DtmType): void {
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
  dtm.templates_used.bess_module!.measurements = {
    active_power: { unit: "watts", type: "float", publisher: "local_process" },
  } as unknown as DtmType["templates_used"][string]["measurements"];
  addPoiMeter(dtm, "poi_meter_1");
}

/**
 * Add a `poi_meter`-templated device. Resolution is by template slug rather than
 * device_id, so the id is a parameter — real deployments differ (`poi_meter_1`
 * from edp-api, `meter_01` in platform's fixture).
 * @param dtm A DTM built by dtmWithRackChildren(), mutated in place
 * @param deviceId The meter's device id
 */
function addPoiMeter(dtm: DtmType, deviceId: string): void {
  dtm.devices[deviceId] = {
    device_id: deviceId,
    template: "poi_meter",
    blocking: [],
    parent: null,
    display_name: null,
    connection: null,
  } as unknown as DtmType["devices"][string];
  dtm.templates_used.poi_meter = {
    template: "poi_meter",
    kind: "leaf",
    equipment_id: "MTR-001",
    vendor: "Test",
    model: "Test Meter",
    capacity_kwh: null,
    description: "poi meter fixture",
    contains: [],
    commands: {},
    measurements: {
      active_power: { unit: "watts", type: "float", publisher: "gateway" },
    },
    alarms: [],
  } as unknown as DtmType["templates_used"][string];
}

describe("resolveEnvelopeGuard", () => {
  it("sums each child's power_min/power_max and resolves the envelope/active_power topics", () => {
    const dtm = dtmWithRackChildren();
    addEnvelopeGuardFixtures(dtm);
    const children = resolveDistributeChildren(
      dtm,
      "bess_module_1",
      "set",
      "active_power",
    );

    const result = resolveEnvelopeGuard(
      dtm,
      "bess_module_1",
      "active_power",
      children,
    );

    assert.deepEqual(result, {
      power_min: -8000000,
      power_max: 8000000,
      import_limit_topic:
        "sites/{site_id}/devices/operating_envelope/measurements/import_limit/watts",
      export_limit_topic:
        "sites/{site_id}/devices/operating_envelope/measurements/export_limit/watts",
      active_power_topic:
        "sites/{site_id}/devices/bess_module_1/measurements/active_power/watts",
      poi_active_power_topic:
        "sites/{site_id}/devices/poi_meter_1/measurements/active_power/watts",
    });
  });

  it("resolves the POI meter by template slug, whatever its device_id", () => {
    // Arrange — platform's fixture names its meter meter_01, edp-api names it
    // poi_meter_1. Neither should have to change for resolution to work.
    const dtm = dtmWithRackChildren();
    addEnvelopeGuardFixtures(dtm);
    delete dtm.devices.poi_meter_1;
    addPoiMeter(dtm, "meter_01");
    const children = resolveDistributeChildren(
      dtm,
      "bess_module_1",
      "set",
      "active_power",
    );

    // Act
    const result = resolveEnvelopeGuard(
      dtm,
      "bess_module_1",
      "active_power",
      children,
    );

    // Assert
    assert.equal(
      result.poi_active_power_topic,
      "sites/{site_id}/devices/meter_01/measurements/active_power/watts",
    );
  });

  it("throws when the deployment has no POI meter", () => {
    // Arrange — every site has a POI meter (Joe, 2026-09-28), so its absence is
    // a malformed DTM rather than a supported shape to degrade into.
    const dtm = dtmWithRackChildren();
    addEnvelopeGuardFixtures(dtm);
    delete dtm.devices.poi_meter_1;
    const children = resolveDistributeChildren(
      dtm,
      "bess_module_1",
      "set",
      "active_power",
    );

    // Act + Assert
    assert.throws(
      () =>
        resolveEnvelopeGuard(dtm, "bess_module_1", "active_power", children),
      /poi_meter/,
    );
  });

  it("throws when the deployment has more than one POI meter", () => {
    // Arrange — two meters leaves it ambiguous which one bounds the envelope,
    // and guessing would silently clamp against the wrong connection point.
    const dtm = dtmWithRackChildren();
    addEnvelopeGuardFixtures(dtm);
    addPoiMeter(dtm, "meter_02");
    const children = resolveDistributeChildren(
      dtm,
      "bess_module_1",
      "set",
      "active_power",
    );

    // Act + Assert
    assert.throws(
      () =>
        resolveEnvelopeGuard(dtm, "bess_module_1", "active_power", children),
      /more than one/,
    );
  });

  it("throws when there's no operating_envelope device in this deployment", () => {
    const dtm = dtmWithRackChildren();
    dtm.templates_used.bess_module!.measurements = {
      active_power: {
        unit: "watts",
        type: "float",
        publisher: "local_process",
      },
    } as unknown as DtmType["templates_used"][string]["measurements"];
    const children = resolveDistributeChildren(
      dtm,
      "bess_module_1",
      "set",
      "active_power",
    );

    assert.throws(
      () =>
        resolveEnvelopeGuard(dtm, "bess_module_1", "active_power", children),
      /operating_envelope/,
    );
  });

  it("throws when the module lacks its own target measurement", () => {
    const dtm = dtmWithRackChildren();
    addEnvelopeGuardFixtures(dtm);
    dtm.templates_used.bess_module!.measurements =
      {} as unknown as DtmType["templates_used"][string]["measurements"];
    const children = resolveDistributeChildren(
      dtm,
      "bess_module_1",
      "set",
      "active_power",
    );

    assert.throws(
      () =>
        resolveEnvelopeGuard(dtm, "bess_module_1", "active_power", children),
      /active_power/,
    );
  });
});

describe("resolveStateOfChargeFloor", () => {
  /**
   * The rack-children fixture with a chosen reserve floor. Accepts `undefined`
   * to stand in for a DTM written before `bess_reserve_floor_mwh` existed.
   * @param floorMwh The reserve floor to put in sizing_params
   * @returns The rack-children fixture with that reserve floor
   */
  function withFloor(floorMwh: number | undefined): DtmType {
    const dtm = dtmWithRackChildren();
    (
      dtm.sizing_params as { bess_reserve_floor_mwh?: number }
    ).bess_reserve_floor_mwh = floorMwh;
    return dtm;
  }

  it("expresses the reserve as a percent of site-wide rack capacity", () => {
    // Arrange: 4 MWh reserve against two 4000 kWh racks
    const dtm = withFloor(4.0);

    // Act
    const resolved = resolveStateOfChargeFloor(dtm, "bess_module_1");

    // Assert: 4000 kWh / 8000 kWh = 50%
    assert.equal(resolved.state_of_charge_floor_percent, 50);
  });

  it("holds the same fraction in every rack so the rack reserves sum to the site floor", () => {
    // Arrange
    const dtm = withFloor(2.0);

    // Act
    const percent = resolveStateOfChargeFloor(
      dtm,
      "bess_module_1",
    ).state_of_charge_floor_percent!;

    // Assert: sum(percent/100 * capacity) across both racks == the site floor in kWh
    const reservedKwh = 2 * ((percent / 100) * 4000);
    assert.equal(reservedKwh, 2.0 * 1000);
  });

  it("omits the field when no reserve is configured", () => {
    // Arrange
    const dtm = withFloor(0);

    // Act
    const resolved = resolveStateOfChargeFloor(dtm, "bess_module_1");

    // Assert: absent rather than an explicit zero, so an old gateway keeps working
    assert.deepEqual(resolved, {});
  });

  it("omits the field when sizing_params predates the reserve floor", () => {
    // Arrange: a DTM written before bess_reserve_floor_mwh existed
    const dtm = withFloor(undefined);

    // Act
    const resolved = resolveStateOfChargeFloor(dtm, "bess_module_1");

    // Assert
    assert.deepEqual(resolved, {});
  });

  it("throws when the reserve exceeds total rack capacity", () => {
    // Arrange: 9 MWh reserve against 8 MWh of racks
    const dtm = withFloor(9.0);

    // Act / Assert
    assert.throws(
      () => resolveStateOfChargeFloor(dtm, "bess_module_1"),
      /exceeds/,
    );
  });

  it("throws rather than emitting NaN when there is no rack capacity to reserve from", () => {
    // Arrange: a reserve configured against a device with no children at all
    const dtm = withFloor(4.0);

    // Act / Assert
    assert.throws(
      () => resolveStateOfChargeFloor(dtm, "bess_rack_a"),
      /capacity/,
    );
  });

  it("rejects a rack whose template has no capacity_kwh rather than skipping its reserve", () => {
    // Arrange: every distribute binding already requires state_of_charge on each child, so a child
    // without capacity_kwh is a malformed battery, not a non-battery device
    const dtm = withFloor(4.0);
    (
      dtm.templates_used.bess_rack as { capacity_kwh: number | null }
    ).capacity_kwh = null;

    // Act / Assert
    assert.throws(
      () => resolveStateOfChargeFloor(dtm, "bess_module_1"),
      /capacity_kwh/,
    );
  });
});

/**
 * Adds a der_dispatch device carrying the operator_reserve measurement, as a real deployment does
 * — it is onboarded at commissioning rather than emitted by the generator.
 * @param dtm A DTM fixture to extend
 * @returns The same DTM, with der_dispatch present
 */
function withDerDispatch(dtm: DtmType): DtmType {
  dtm.devices["der_dispatch"] = {
    device_id: "der_dispatch",
    template: "der_dispatch",
    parent: null,
  };
  dtm.templates_used["der_dispatch"] = {
    template: "der_dispatch",
    kind: "leaf",
    equipment_id: null,
    vendor: null,
    model: null,
    capacity_kwh: null,
    description: "dispatch policy fixture",
    contains: [],
    commands: {},
    measurements: {
      operator_reserve: {
        unit: "watt_hours",
        type: "float",
        publisher: "der_control_api",
      },
    },
    alarms: [],
  } as unknown as DtmType["templates_used"][string];
  return dtm;
}

describe("resolveReadiness", () => {
  it("converts the derived sizing figures to a percent of capacity and watts", () => {
    // Arrange: the demo's real ERCOT heavy numbers — readiness is the ride-through floor plus
    // the curtailment-response energy, and the recharge rate refills the latter between events.
    // Two racks at 4000 kWh, so 7.07 MWh of 8 MWh installed
    const dtm = dtmWithRackChildren();
    dtm.sizing_params.bess_readiness_mwh = 7.0736842105263165;
    dtm.sizing_params.bess_recharge_mw = 0.24819944598337954;

    // Act
    const resolved = resolveReadiness(
      dtm,
      resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
    );

    // Assert: the manifest authors MWh and MW; both conversions happen once here rather than in
    // the gateway's charge arithmetic, exactly as site_capacity_wh does for kWh
    assert.equal(resolved.readiness_soc_percent, 88.42105263157896);
    assert.equal(resolved.recharge_power_w, 248_199.44598337953);
  });

  it("shares the rate between modules but gives them the same target percent", () => {
    // Arrange: three equal racks, two under module 1 and one under module 2. This is the case
    // the shapes differ on — site-scoped power repeated on every binding would have the plant
    // charging at N times its sized rate, which the import servo would then have to fight.
    const dtm = dtmWithRackChildren();
    dtm.sizing_params.bess_readiness_mwh = 6;
    dtm.sizing_params.bess_recharge_mw = 0.3;
    dtm.devices["bess_module_2"] = {
      device_id: "bess_module_2",
      template: dtm.devices["bess_module_1"]!.template,
      parent: null,
    } as unknown as DtmType["devices"][string];
    dtm.devices["bess_rack_3"] = {
      device_id: "bess_rack_3",
      template: "bess_rack",
      parent: "bess_module_2",
    } as unknown as DtmType["devices"][string];

    // Act
    const two = resolveReadiness(
      dtm,
      resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
    );
    const one = resolveReadiness(
      dtm,
      resolveDistributeChildren(dtm, "bess_module_2", "set", "active_power"),
    );

    // Assert: 6 of 12 MWh installed is 50% whichever module asks — the target is a percent of
    // the site precisely so it needs no module capacity to compare against. The rate is the
    // module's own share, because two modules charging at 0.3 MW each is 0.6 MW
    assert.equal(two.readiness_soc_percent, 50);
    assert.equal(one.readiness_soc_percent, 50);
    assert.equal(two.recharge_power_w, 200_000);
    assert.equal(one.recharge_power_w, 100_000);
  });

  it("holds the target at full charge when the racks installed cannot reach it", () => {
    // Arrange: 20 MWh asked of 8 MWh installed — a site mid-commissioning, where the obligation
    // edp-api sized is real but the racks it will be met with are still being added by hand
    const dtm = dtmWithRackChildren();
    dtm.sizing_params.bess_readiness_mwh = 20;
    dtm.sizing_params.bess_recharge_mw = 0.3;

    // Act
    const resolved = resolveReadiness(
      dtm,
      resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
    );

    // Assert: 100, not 250 — a half-built site charges to full rather than failing the whole
    // manifest, which is what validating the sized obligation against the rack list would do
    assert.equal(resolved.readiness_soc_percent, 100);
  });

  it("omits both fields when the site has no readiness target", () => {
    // Arrange: a site with no flex obligation emits zero, which is every deployment today
    const dtm = dtmWithRackChildren();
    dtm.sizing_params.bess_readiness_mwh = 0;
    dtm.sizing_params.bess_recharge_mw = 0;

    // Act / Assert: absent must mean no charging — a site that never asked for this cannot be
    // made to start importing by shipping the field
    assert.deepEqual(
      resolveReadiness(
        dtm,
        resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
      ),
      {},
    );
  });

  it("omits both fields when no device carries capacity", () => {
    // Arrange: a readiness target with nothing to charge is meaningless
    const dtm = dtmWithRackChildren();
    dtm.sizing_params.bess_readiness_mwh = 7.07;
    dtm.sizing_params.bess_recharge_mw = 0.25;
    dtm.templates_used.bess_rack!.capacity_kwh = null;

    // Act / Assert
    assert.deepEqual(
      resolveReadiness(
        dtm,
        resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
      ),
      {},
    );
  });

  it("omits the recharge rate's sibling rather than emitting a target with no rate", () => {
    // Arrange: a target the site has no sized rate to reach is not actionable, and emitting it
    // alone would leave the gateway to invent a rate
    const dtm = dtmWithRackChildren();
    dtm.sizing_params.bess_readiness_mwh = 7.07;
    dtm.sizing_params.bess_recharge_mw = 0;

    // Act / Assert
    assert.deepEqual(
      resolveReadiness(
        dtm,
        resolveDistributeChildren(dtm, "bess_module_1", "set", "active_power"),
      ),
      {},
    );
  });
});

describe("resolveOperatorReserve", () => {
  it("resolves the topic and sums site capacity into watt-hours", () => {
    // Arrange: two racks at 4000 kWh each
    const dtm = withDerDispatch(dtmWithRackChildren());

    // Act
    const resolved = resolveOperatorReserve(dtm);

    // Assert: watt-hours, not the kWh the template authors — the conversion happens once here
    // rather than in every consumer's floor arithmetic
    assert.equal(
      resolved.operator_reserve_topic,
      "sites/{site_id}/devices/der_dispatch/measurements/operator_reserve/watt_hours",
    );
    assert.equal(resolved.site_capacity_wh, 8_000_000);
  });

  it("omits both fields when the deployment has no der_dispatch", () => {
    // Arrange: storage present, but nothing publishes an operator reserve
    const dtm = dtmWithRackChildren();

    // Act / Assert: absent means no operator reserve, which is not an error
    assert.deepEqual(resolveOperatorReserve(dtm), {});
  });

  it("omits both fields when no device carries capacity", () => {
    // Arrange: a deployment with no storage at all
    const dtm = withDerDispatch(dtmWithRackChildren());
    dtm.templates_used.bess_rack!.capacity_kwh = null;

    // Act / Assert: a reserve expressed as a fraction of nothing is meaningless, so neither
    // field is emitted rather than emitting a zero a consumer would divide by
    assert.deepEqual(resolveOperatorReserve(dtm), {});
  });
});
