/**
 * Unit tests for dtm.schema.ts — mirrors edp-api Pydantic test coverage.
 * AAA pattern throughout. Zod `.safeParse()` used so failures return structured errors.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  Bus,
  BusMember,
  Connection,
  Device,
  Dtm,
  PROVISIONED_AT_COMMISSIONING,
} from "./dtm.schema";
import { DeviceTemplate } from "../templates/template.schema";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse and assert success, returning the typed value.
 * @param schema - Zod schema with a `parse` method
 * @param schema.parse - Zod parse method
 * @param input - Raw input value to parse
 * @returns The parsed and typed value
 */
function ok<T>(schema: { parse: (v: unknown) => T }, input: unknown): T {
  return schema.parse(input);
}

/**
 * Parse and assert failure, returning all joined error messages.
 * @param schema - Zod schema with a `safeParse` method
 * @param schema.safeParse - Zod safeParse method
 * @param input - Raw input value expected to fail
 * @returns Semicolon-joined issue messages
 */
function fail(
  schema: {
    safeParse: (v: unknown) => {
      success: boolean;
      error?: { issues: { message: string }[] };
    };
  },
  input: unknown,
): string {
  const result = schema.safeParse(input);
  assert.equal(result.success, false);
  return result.error!.issues.map((issue) => issue.message).join("; ");
}

// ---------------------------------------------------------------------------
// Minimal fixtures
// ---------------------------------------------------------------------------

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

const minimalLeafTemplate = {
  template: "bess_leaf",
  kind: "leaf" as const,
  equipment_id: "EQ-001",
  vendor: "Acme",
  model: "X1",
  description: "Battery leaf device",
  measurements: {
    soc: {
      unit: "%",
      type: "float" as const,
      iec_61850_ref: "ZBAT.BatChaSt",
      bounds: socBounds,
      thresholds: socThresholds,
      binding: modbusBinding,
    },
  },
};

const minimalModuleTemplate = {
  template: "bess_module",
  kind: "module" as const,
  description: "Battery module aggregation",
  measurements: {
    soc: {
      unit: "%",
      type: "float" as const,
      iec_61850_ref: "ZBAT.BatChaSt",
      bounds: socBounds,
      thresholds: socThresholds,
      publisher: "line_controller" as const,
    },
  },
};

const minimalDevice = {
  device_id: "bess_01",
  template: "bess_leaf",
};

const minimalSizingParams = {
  P_compute_total_kW: 100.0,
  E_BESS_total_kWh: 200.0,
  T_coolant_setpoint_C: 18.0,
};

const minimalDtm = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
  sizing_params: minimalSizingParams,
  devices: { bess_01: minimalDevice },
  buses: [],
  templates_used: { bess_leaf: minimalLeafTemplate },
};

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

describe("Connection", () => {
  it("accepts standard connection", () => {
    const result = ok(Connection, { host: "192.168.1.10", port: 502 });
    assert.equal(result.host, "192.168.1.10");
    assert.equal(result.port, 502);
  });

  it("accepts PROVISIONED_AT_COMMISSIONING sentinel as host", () => {
    const result = ok(Connection, {
      host: PROVISIONED_AT_COMMISSIONING,
      port: PROVISIONED_AT_COMMISSIONING,
    });
    assert.equal(result.host, PROVISIONED_AT_COMMISSIONING);
    assert.equal(result.port, PROVISIONED_AT_COMMISSIONING);
  });

  it("unit_id is optional / nullish", () => {
    const result = ok(Connection, { host: "10.0.0.1", port: 502 });
    assert.equal(result.unit_id, undefined);
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(Connection, {
      host: "10.0.0.1",
      port: 502,
      unknown: "bad",
    });
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Device
// ---------------------------------------------------------------------------

describe("Device", () => {
  it("accepts minimal device", () => {
    const result = ok(Device, minimalDevice);
    assert.equal(result.device_id, "bess_01");
  });

  it("device_id slug regex enforced — rejects uppercase", () => {
    const msg = fail(Device, { ...minimalDevice, device_id: "BessModule" });
    assert.ok(msg.toLowerCase().includes("slug"), `got: ${msg}`);
  });

  it("device_id slug regex enforced — rejects starting with digit", () => {
    const msg = fail(Device, { ...minimalDevice, device_id: "1bess" });
    assert.ok(msg.toLowerCase().includes("slug"), `got: ${msg}`);
  });

  it("device_id slug regex enforced — rejects hyphens", () => {
    const msg = fail(Device, { ...minimalDevice, device_id: "bess-module" });
    assert.ok(msg.toLowerCase().includes("slug"), `got: ${msg}`);
  });

  it("blocking defaults to ['live_mode']", () => {
    const result = ok(Device, minimalDevice);
    assert.deepEqual(result.blocking, ["live_mode"]);
  });

  it("blocking can be overridden to empty array", () => {
    const result = ok(Device, { ...minimalDevice, blocking: [] });
    assert.deepEqual(result.blocking, []);
  });

  it("blocking accepts commissioning_complete", () => {
    const result = ok(Device, {
      ...minimalDevice,
      blocking: ["commissioning_complete"],
    });
    assert.deepEqual(result.blocking, ["commissioning_complete"]);
  });

  it("module-kind device may have null connection", () => {
    const result = ok(Device, { ...minimalDevice, connection: null });
    assert.equal(result.connection, null);
  });

  it("connection may be omitted", () => {
    const result = ok(Device, minimalDevice);
    assert.equal(result.connection, undefined);
  });

  it("parent may be set to another device_id string", () => {
    const result = ok(Device, { ...minimalDevice, parent: "parent_device" });
    assert.equal(result.parent, "parent_device");
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(Device, { ...minimalDevice, unknown_key: true });
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// BusMember
// ---------------------------------------------------------------------------

describe("BusMember", () => {
  it("accepts minimal bus member", () => {
    const result = ok(BusMember, { device_id: "bess_01" });
    assert.equal(result.device_id, "bess_01");
  });

  it("port is optional", () => {
    const result = ok(BusMember, { device_id: "bess_01", port: "dc_out" });
    assert.equal(result.port, "dc_out");
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(BusMember, { device_id: "bess_01", extra: true });
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Bus
// ---------------------------------------------------------------------------

describe("Bus", () => {
  it("accepts dc bus", () => {
    const result = ok(Bus, {
      bus_id: "dc_main",
      type: "dc",
      members: [{ device_id: "bess_01" }],
    });
    assert.equal(result.type, "dc");
  });

  it("accepts ac bus", () => {
    const result = ok(Bus, {
      bus_id: "ac_grid",
      type: "ac",
      members: [],
    });
    assert.equal(result.type, "ac");
  });

  it("rejects invalid bus type", () => {
    const msg = fail(Bus, {
      bus_id: "dc_main",
      type: "hvdc",
      members: [],
    });
    assert.ok(msg.length > 0);
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(Bus, {
      bus_id: "dc_main",
      type: "dc",
      members: [],
      extra: true,
    });
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Dtm
// ---------------------------------------------------------------------------

describe("Dtm", () => {
  it("accepts minimal valid DTM", () => {
    const result = ok(Dtm, minimalDtm);
    assert.equal(result.deployment_uuid, minimalDtm.deployment_uuid);
  });

  it("ems_mode defaults to 'sim'", () => {
    const result = ok(Dtm, minimalDtm);
    assert.equal(result.ems_mode, "sim");
  });

  it("ems_mode can be set to 'live'", () => {
    const result = ok(Dtm, { ...minimalDtm, ems_mode: "live" });
    assert.equal(result.ems_mode, "live");
  });

  it("devices keyed by device_id", () => {
    const result = ok(Dtm, minimalDtm);
    assert.ok("bess_01" in result.devices);
    assert.equal(result.devices["bess_01"]?.device_id, "bess_01");
  });

  it("rejects orphan parent — parent chain integrity", () => {
    const msg = fail(Dtm, {
      ...minimalDtm,
      devices: {
        bess_01: { ...minimalDevice, parent: "nonexistent_parent" },
      },
    });
    assert.ok(msg.includes("parent") || msg.includes("resolve"), `got: ${msg}`);
  });

  it("rejects orphan template ref — template integrity", () => {
    const msg = fail(Dtm, {
      ...minimalDtm,
      devices: {
        bess_01: { ...minimalDevice, template: "missing_template" },
      },
    });
    assert.ok(
      msg.includes("template") || msg.includes("resolve"),
      `got: ${msg}`,
    );
  });

  it("rejects orphan bus member — bus member integrity", () => {
    const msg = fail(Dtm, {
      ...minimalDtm,
      buses: [
        {
          bus_id: "dc_main",
          type: "dc",
          members: [{ device_id: "nonexistent_device" }],
        },
      ],
    });
    assert.ok(
      msg.includes("device_id") ||
        msg.includes("bus") ||
        msg.includes("resolve"),
      `got: ${msg}`,
    );
  });

  it("sizing_ref is optional", () => {
    const result = ok(Dtm, minimalDtm);
    assert.equal(result.sizing_ref, undefined);
  });

  it("accepts sizing_ref when provided", () => {
    const result = ok(Dtm, { ...minimalDtm, sizing_ref: "sizing-001" });
    assert.equal(result.sizing_ref, "sizing-001");
  });

  it("rejects invalid UUID for deployment_uuid", () => {
    const msg = fail(Dtm, {
      ...minimalDtm,
      deployment_uuid: "not-a-uuid",
    });
    assert.ok(msg.length > 0);
  });

  it("rejects unknown top-level fields (strict)", () => {
    const msg = fail(Dtm, { ...minimalDtm, dtm_version: "1.0" });
    assert.ok(msg.length > 0);
  });

  it("parent chain with valid parent passes", () => {
    const result = ok(Dtm, {
      ...minimalDtm,
      devices: {
        parent_device: {
          device_id: "parent_device",
          template: "bess_leaf",
        },
        child_device: {
          device_id: "child_device",
          template: "bess_leaf",
          parent: "parent_device",
        },
      },
    });
    assert.ok("child_device" in result.devices);
  });

  it("templates_used keyed by template slug", () => {
    const result = ok(Dtm, minimalDtm);
    assert.ok("bess_leaf" in result.templates_used);
  });

  it("accepts module template with null connection on device", () => {
    const result = ok(Dtm, {
      ...minimalDtm,
      devices: {
        bess_module_01: {
          device_id: "bess_module_01",
          template: "bess_module",
          connection: null,
        },
      },
      templates_used: {
        bess_module: minimalModuleTemplate,
      },
    });
    assert.equal(result.devices["bess_module_01"]?.connection, null);
  });

  it("DeviceTemplate imported from template.schema works inside Dtm", () => {
    // Verify that DeviceTemplate parses the fixture correctly
    const tpl = ok(DeviceTemplate, minimalLeafTemplate);
    assert.equal(tpl.template, "bess_leaf");
  });
});
