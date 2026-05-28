/**
 * Unit tests for template.schema.ts — mirrors edp-api Pydantic test coverage.
 * AAA pattern throughout. Zod `.safeParse()` used so failures return structured errors.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import {
  Binding,
  Command,
  ContainsEntry,
  CxLevel,
  DeviceTemplate,
  Fanout,
  InstallTask,
  Measurement,
  Publisher,
  TemplateKind,
} from "./template.schema";

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
// Enum values
// ---------------------------------------------------------------------------

describe("TemplateKind", () => {
  it("has leaf and module values", () => {
    assert.equal(TemplateKind.LEAF, "leaf");
    assert.equal(TemplateKind.MODULE, "module");
  });
});

describe("Publisher", () => {
  it("has line_controller, analyst, and gateway values", () => {
    assert.equal(Publisher.LINE_CONTROLLER, "line_controller");
    assert.equal(Publisher.ANALYST, "analyst");
    assert.equal(Publisher.GATEWAY, "gateway");
  });
});

describe("Fanout", () => {
  it("has line_controller value", () => {
    assert.equal(Fanout.LINE_CONTROLLER, "line_controller");
  });
});

// ---------------------------------------------------------------------------
// Binding discriminated union
// ---------------------------------------------------------------------------

describe("Binding", () => {
  it("parses ModbusBinding", () => {
    const result = ok(Binding, {
      protocol: "modbus_tcp",
      function_code: 3,
      address: 100,
    });
    assert.equal(result.protocol, "modbus_tcp");
  });

  it("ModbusBinding defaults: data_type=int16, word_order=high_low, scale=1.0, offset=0.0", () => {
    const result = ok(Binding, {
      protocol: "modbus_tcp",
      function_code: 3,
      address: 100,
    });
    assert.equal(result.protocol, "modbus_tcp");
    if (result.protocol !== "modbus_tcp")
      throw new Error("expected modbus_tcp");
    assert.equal(result.data_type, "int16");
    assert.equal(result.word_order, "high_low");
    assert.equal(result.scale, 1.0);
    assert.equal(result.offset, 0.0);
  });

  it("parses Dnp3Binding", () => {
    const result = ok(Binding, {
      protocol: "dnp3_tcp",
      point_index: 1,
      point_type: "analog_input",
    });
    assert.equal(result.protocol, "dnp3_tcp");
  });

  it("Dnp3Binding: variation defaults to null (optional audit metadata)", () => {
    const result = ok(Binding, {
      protocol: "dnp3_tcp",
      point_index: 0,
      point_type: "analog_input",
    });
    if (result.protocol !== "dnp3_tcp") throw new Error("expected dnp3_tcp");
    assert.equal(result.variation, null);
  });

  it("Dnp3Binding: accepts explicit variation (e.g. Group 30 Var 5 = float)", () => {
    const result = ok(Binding, {
      protocol: "dnp3_tcp",
      point_index: 0,
      point_type: "analog_input",
      variation: 5,
    });
    if (result.protocol !== "dnp3_tcp") throw new Error("expected dnp3_tcp");
    assert.equal(result.variation, 5);
  });

  it("parses SyntheticBinding", () => {
    const result = ok(Binding, {
      protocol: "synthetic",
      formula: "subtract",
      inputs: [
        "sites/{site_id}/devices/operating_envelope/measurements/import_limit/watts",
        "sites/{site_id}/devices/{device_id}/measurements/active_power/watts",
      ],
    });
    assert.equal(result.protocol, "synthetic");
    if (result.protocol !== "synthetic") throw new Error("expected synthetic");
    assert.equal(result.formula, "subtract");
    assert.equal(result.inputs.length, 2);
  });

  it("SyntheticBinding: rejects formula outside enum", () => {
    const msg = fail(Binding, {
      protocol: "synthetic",
      formula: "divide",
      inputs: ["a", "b"],
    });
    assert.ok(msg.length > 0);
  });

  it("parses SnmpBinding", () => {
    const result = ok(Binding, { protocol: "snmp", oid: "1.3.6.1.2.1" });
    assert.equal(result.protocol, "snmp");
  });

  it("parses RedfishBinding", () => {
    const result = ok(Binding, {
      protocol: "redfish",
      uri: "/redfish/v1/Systems",
    });
    assert.equal(result.protocol, "redfish");
  });

  it("RedfishBinding: json_pointer defaults to null", () => {
    const result = ok(Binding, { protocol: "redfish", uri: "/redfish/v1" });
    if (result.protocol !== "redfish") throw new Error("expected redfish");
    assert.equal(result.json_pointer, null);
  });

  it("parses BacnetIpBinding", () => {
    const result = ok(Binding, {
      protocol: "bacnet_ip",
      device_instance: 11001,
      object_type: "analog_input",
      object_instance: 1,
    });
    assert.equal(result.protocol, "bacnet_ip");
  });

  it("parses BacnetScBinding", () => {
    const result = ok(Binding, {
      protocol: "bacnet_sc",
      hub_url: "wss://hub.example.com:47808/",
      device_vmac: "AA:BB:CC:DD:EE:FF",
      object_type: "analog_input",
      object_instance: 1,
      property_id: "present_value",
    });
    assert.equal(result.protocol, "bacnet_sc");
  });

  it("BacnetScBinding: rejects non-wss hub_url (ASHRAE 135 Annex AB §7.4 — mTLS only)", () => {
    const msg = fail(Binding, {
      protocol: "bacnet_sc",
      hub_url: "https://hub.example.com/",
      device_vmac: "AA:BB:CC:DD:EE:FF",
      object_type: "analog_input",
      object_instance: 1,
      property_id: "present_value",
    });
    assert.ok(msg.length > 0);
  });

  it("BacnetScBinding: rejects malformed device_vmac", () => {
    const msg = fail(Binding, {
      protocol: "bacnet_sc",
      hub_url: "wss://hub.example.com/",
      device_vmac: "AA-BB-CC-DD-EE-FF",
      object_type: "analog_input",
      object_instance: 1,
      property_id: "present_value",
    });
    assert.ok(msg.length > 0);
  });

  it("BacnetScBinding: rejects negative object_instance", () => {
    const msg = fail(Binding, {
      protocol: "bacnet_sc",
      hub_url: "wss://hub.example.com/",
      device_vmac: "AA:BB:CC:DD:EE:FF",
      object_type: "analog_input",
      object_instance: -1,
      property_id: "present_value",
    });
    assert.ok(msg.length > 0);
  });

  it("rejects unknown protocol", () => {
    const msg = fail(Binding, { protocol: "opc_ua", oid: "test" });
    assert.ok(msg.length > 0);
  });

  it("rejects unknown fields on ModbusBinding (strict)", () => {
    const msg = fail(Binding, {
      protocol: "modbus_tcp",
      function_code: 3,
      address: 100,
      unknown_field: true,
    });
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

const modbusBinding = {
  protocol: "modbus_tcp" as const,
  function_code: 3,
  address: 100,
};

const baseBounds = { min: 0, max: 1000, nominal: 500 };
const baseThresholds = {
  warn_min: 100,
  warn_max: 900,
  alarm_min: 50,
  alarm_max: 950,
};

const baseMeasurementWithBinding = {
  unit: "W",
  type: "float" as const,
  iec_61850_ref: "MMXU.W",
  bounds: baseBounds,
  thresholds: baseThresholds,
  binding: modbusBinding,
};

const baseMeasurementWithPublisher = {
  unit: "W",
  type: "float" as const,
  iec_61850_ref: "MMXU.W",
  bounds: baseBounds,
  thresholds: baseThresholds,
  publisher: "line_controller" as const,
};

describe("Measurement", () => {
  it("accepts measurement with binding", () => {
    const result = ok(Measurement, baseMeasurementWithBinding);
    assert.equal(result.unit, "W");
  });

  it("accepts measurement with publisher", () => {
    const result = ok(Measurement, baseMeasurementWithPublisher);
    assert.equal(result.publisher, "line_controller");
  });

  it("rejects measurement with both binding and publisher", () => {
    const msg = fail(Measurement, {
      ...baseMeasurementWithBinding,
      publisher: "line_controller",
    });
    assert.ok(msg.includes("exactly one of binding/publisher"), `got: ${msg}`);
  });

  it("rejects measurement with neither binding nor publisher", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: baseBounds,
      thresholds: baseThresholds,
    });
    assert.ok(msg.includes("exactly one of binding/publisher"), `got: ${msg}`);
  });

  it("synthetic binding requires publisher=gateway", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: baseBounds,
      thresholds: baseThresholds,
      binding: {
        protocol: "synthetic",
        formula: "subtract",
        inputs: ["a", "b"],
      },
    });
    // publisher omitted => fails the synthetic+gateway requirement
    assert.ok(msg.length > 0, `expected validation error, got: ${msg}`);
  });

  it("synthetic binding rejects non-gateway publisher", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: baseBounds,
      thresholds: baseThresholds,
      binding: {
        protocol: "synthetic",
        formula: "subtract",
        inputs: ["a", "b"],
      },
      publisher: "line_controller",
    });
    assert.ok(msg.length > 0, `expected validation error, got: ${msg}`);
  });

  it("accepts synthetic binding with publisher=gateway", () => {
    const result = ok(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: baseBounds,
      thresholds: baseThresholds,
      binding: {
        protocol: "synthetic",
        formula: "subtract",
        inputs: ["a", "b"],
      },
      publisher: "gateway",
    });
    assert.equal(result.publisher, "gateway");
    if (result.binding?.protocol !== "synthetic")
      throw new Error("expected synthetic binding");
    assert.equal(result.binding.formula, "subtract");
  });

  it("type=enum requires values", () => {
    const msg = fail(Measurement, {
      unit: "mode",
      type: "enum",
      iec_61850_ref: "XCBR.Pos.stVal",
      binding: modbusBinding,
    });
    assert.ok(msg.includes("values required for type=enum"), `got: ${msg}`);
  });

  it("type=enum with values passes", () => {
    const result = ok(Measurement, {
      unit: "mode",
      type: "enum",
      iec_61850_ref: "XCBR.Pos.stVal",
      values: { 1: "AUTO", 2: "MANUAL" },
      binding: modbusBinding,
    });
    assert.equal(result.type, "enum");
  });

  it("values with int keys parses correctly", () => {
    const result = ok(Measurement, {
      unit: "mode",
      type: "enum",
      iec_61850_ref: "XCBR.Pos.stVal",
      values: { 1: "AUTO", 2: "MANUAL" },
      binding: modbusBinding,
    });
    const values = result.values as Record<string, string>;
    assert.equal(values["1"], "AUTO");
  });

  it("values forbidden for non-enum type", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: baseBounds,
      thresholds: baseThresholds,
      values: { 1: "A" },
      binding: modbusBinding,
    });
    assert.ok(msg.includes("values forbidden for non-enum"), `got: ${msg}`);
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(Measurement, {
      ...baseMeasurementWithBinding,
      unknown_extra: "oops",
    });
    assert.ok(msg.length > 0);
  });

  it("type=float accepts measurement without iec_61850_ref (now optional)", () => {
    // Matches edp-api Python: iec_61850_ref is optional, defaults to null.
    const result = ok(Measurement, {
      unit: "W",
      type: "float",
      bounds: baseBounds,
      thresholds: baseThresholds,
      binding: modbusBinding,
    });
    assert.equal(result.iec_61850_ref, null);
  });

  it("type=float accepts measurement without bounds (now optional)", () => {
    // Module rollups don't have meaningful bounds; matches edp-api Python.
    const result = ok(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      thresholds: baseThresholds,
      binding: modbusBinding,
    });
    assert.equal(result.bounds, null);
  });

  it("type=float accepts measurement without thresholds (now optional)", () => {
    const result = ok(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: baseBounds,
      binding: modbusBinding,
    });
    assert.equal(result.thresholds, null);
  });

  it("type=bool does NOT require bounds/thresholds", () => {
    const result = ok(Measurement, {
      unit: "none",
      type: "bool",
      iec_61850_ref: "XCBR.Pos.stVal",
      binding: modbusBinding,
    });
    assert.equal(result.type, "bool");
  });

  it("type=enum does NOT require bounds/thresholds", () => {
    const result = ok(Measurement, {
      unit: "none",
      type: "enum",
      iec_61850_ref: "XCBR.Pos.stVal",
      values: { 0: "OPEN", 1: "CLOSED" },
      binding: modbusBinding,
    });
    assert.equal(result.type, "enum");
  });

  it("bounds forbidden for type=bool", () => {
    const msg = fail(Measurement, {
      unit: "none",
      type: "bool",
      iec_61850_ref: "XCBR.Pos.stVal",
      bounds: baseBounds,
      binding: modbusBinding,
    });
    assert.ok(msg.includes("bounds forbidden for non-float"), `got: ${msg}`);
  });

  it("bounds.min must be < bounds.max", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: { min: 100, max: 50, nominal: 75 },
      thresholds: baseThresholds,
      binding: modbusBinding,
    });
    assert.ok(msg.includes("bounds.min must be less"), `got: ${msg}`);
  });

  it("bounds.nominal must lie within [min, max]", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: { min: 0, max: 100, nominal: 200 },
      thresholds: baseThresholds,
      binding: modbusBinding,
    });
    assert.ok(msg.includes("bounds.nominal"), `got: ${msg}`);
  });

  it("thresholds.alarm_min must be ≤ warn_min", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: baseBounds,
      thresholds: {
        warn_min: 100,
        warn_max: 900,
        alarm_min: 200,
        alarm_max: 950,
      },
      binding: modbusBinding,
    });
    assert.ok(msg.includes("alarm_min"), `got: ${msg}`);
  });
});

// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

const baseCommandWithBinding = {
  verb: "set" as const,
  target: "power_setpoint",
  unit: "W",
  payload: "float" as const,
  binding: modbusBinding,
};

const baseCommandWithFanout = {
  verb: "set" as const,
  target: "power_setpoint",
  unit: "W",
  payload: "float" as const,
  fanout: "line_controller" as const,
};

describe("Command", () => {
  it("accepts command with binding", () => {
    const result = ok(Command, baseCommandWithBinding);
    assert.equal(result.verb, "set");
  });

  it("accepts command with fanout", () => {
    const result = ok(Command, baseCommandWithFanout);
    assert.equal(result.fanout, "line_controller");
  });

  it("rejects command with both binding and fanout", () => {
    const msg = fail(Command, {
      ...baseCommandWithBinding,
      fanout: "line_controller",
    });
    assert.ok(msg.includes("exactly one of binding/fanout"), `got: ${msg}`);
  });

  it("rejects command with neither binding nor fanout", () => {
    const msg = fail(Command, {
      verb: "set",
      target: "power",
      unit: "W",
      payload: "float",
    });
    assert.ok(msg.includes("exactly one of binding/fanout"), `got: ${msg}`);
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(Command, {
      ...baseCommandWithBinding,
      extra: "bad",
    });
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// ContainsEntry
// ---------------------------------------------------------------------------

describe("ContainsEntry", () => {
  it("defaults qty to scalable", () => {
    const result = ok(ContainsEntry, { template: "some_module" });
    assert.equal(result.qty, "scalable");
  });

  it("accepts integer qty", () => {
    const result = ok(ContainsEntry, { template: "some_module", qty: 3 });
    assert.equal(result.qty, 3);
  });

  it("rejects negative integer qty", () => {
    const msg = fail(ContainsEntry, { template: "some_module", qty: -1 });
    assert.ok(msg.length > 0);
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(ContainsEntry, { template: "some_module", extra: true });
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// InstallTask
// ---------------------------------------------------------------------------

describe("CxLevel", () => {
  it("accepts L1..L5", () => {
    for (const lvl of ["L1", "L2", "L3", "L4", "L5"]) {
      assert.equal(ok(CxLevel, lvl), lvl);
    }
  });

  it("rejects L0", () => {
    const msg = fail(CxLevel, "L0");
    assert.ok(msg.length > 0);
  });
});

const baseInstallTask = {
  name: "mount_in_rack",
  est_minutes: 20,
  crew_role: "electrician" as const,
  cx_level: "L1" as const,
};

describe("InstallTask", () => {
  it("parses minimal task; depends_on defaults to []", () => {
    const result = ok(InstallTask, baseInstallTask);
    assert.equal(result.name, "mount_in_rack");
    assert.deepEqual(result.depends_on, []);
  });

  it("accepts depends_on list", () => {
    const result = ok(InstallTask, {
      ...baseInstallTask,
      depends_on: ["unbox", "stage"],
    });
    assert.deepEqual(result.depends_on, ["unbox", "stage"]);
  });

  it("rejects est_minutes <= 0", () => {
    const msg = fail(InstallTask, { ...baseInstallTask, est_minutes: 0 });
    assert.ok(msg.length > 0);
  });

  it("rejects non-int est_minutes", () => {
    const msg = fail(InstallTask, { ...baseInstallTask, est_minutes: 1.5 });
    assert.ok(msg.length > 0);
  });

  it("rejects crew_role outside enum", () => {
    const msg = fail(InstallTask, { ...baseInstallTask, crew_role: "welder" });
    assert.ok(msg.length > 0);
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(InstallTask, { ...baseInstallTask, extra: true });
    assert.ok(msg.length > 0);
  });
});

// ---------------------------------------------------------------------------
// DeviceTemplate
// ---------------------------------------------------------------------------

const minimalLeaf = {
  template: "bms_leaf",
  kind: "leaf",
  equipment_id: "EQ-001",
  vendor: "Acme",
  model: "X1",
  description: "Battery Management System",
  measurements: {
    soc: {
      unit: "%",
      type: "float",
      iec_61850_ref: "ZBAT.BatChaSt",
      bounds: { min: 0, max: 100, nominal: 50 },
      thresholds: {
        warn_min: 10,
        warn_max: 90,
        alarm_min: 5,
        alarm_max: 95,
      },
      binding: modbusBinding,
    },
  },
};

const minimalModule = {
  template: "bms_module",
  kind: "module",
  description: "BMS Module aggregation",
  measurements: {
    soc: {
      unit: "%",
      type: "float",
      iec_61850_ref: "ZBAT.BatChaSt",
      bounds: { min: 0, max: 100, nominal: 50 },
      thresholds: {
        warn_min: 10,
        warn_max: 90,
        alarm_min: 5,
        alarm_max: 95,
      },
      publisher: "line_controller",
    },
  },
};

describe("DeviceTemplate", () => {
  it("accepts minimal leaf", () => {
    const result = ok(DeviceTemplate, minimalLeaf);
    assert.equal(result.kind, "leaf");
  });

  it("accepts minimal module", () => {
    const result = ok(DeviceTemplate, minimalModule);
    assert.equal(result.kind, "module");
  });

  it("module allows contains", () => {
    const result = ok(DeviceTemplate, {
      ...minimalModule,
      contains: [{ template: "bms_leaf", qty: 2 }],
    });
    assert.equal(result.contains.length, 1);
  });

  it("leaf without equipment_id is rejected", () => {
    const msg = fail(DeviceTemplate, { ...minimalLeaf, equipment_id: null });
    assert.ok(
      msg.includes("equipment_id required for kind=leaf"),
      `got: ${msg}`,
    );
  });

  it("leaf without vendor is rejected", () => {
    const msg = fail(DeviceTemplate, { ...minimalLeaf, vendor: null });
    assert.ok(msg.includes("vendor required for kind=leaf"), `got: ${msg}`);
  });

  it("leaf without model is rejected", () => {
    const msg = fail(DeviceTemplate, { ...minimalLeaf, model: null });
    assert.ok(msg.includes("model required for kind=leaf"), `got: ${msg}`);
  });

  it("leaf with contains is rejected", () => {
    const msg = fail(DeviceTemplate, {
      ...minimalLeaf,
      contains: [{ template: "child" }],
    });
    assert.ok(msg.includes("contains forbidden for kind=leaf"), `got: ${msg}`);
  });

  it("module with equipment_id is rejected", () => {
    const msg = fail(DeviceTemplate, {
      ...minimalModule,
      equipment_id: "EQ-999",
    });
    assert.ok(
      msg.includes("equipment_id forbidden for kind=module"),
      `got: ${msg}`,
    );
  });

  it("module with vendor is rejected", () => {
    const msg = fail(DeviceTemplate, { ...minimalModule, vendor: "Acme" });
    assert.ok(msg.includes("vendor forbidden for kind=module"), `got: ${msg}`);
  });

  it("module with model is rejected", () => {
    const msg = fail(DeviceTemplate, { ...minimalModule, model: "X1" });
    assert.ok(msg.includes("model forbidden for kind=module"), `got: ${msg}`);
  });

  it("template without measurements OR commands is rejected", () => {
    const msg = fail(DeviceTemplate, {
      ...minimalLeaf,
      measurements: {},
      commands: {},
    });
    assert.ok(
      msg.includes("at least one of measurements or commands"),
      `got: ${msg}`,
    );
  });

  it("slug regex enforced — rejects invalid slug", () => {
    const msg = fail(DeviceTemplate, {
      ...minimalLeaf,
      template: "INVALID-SLUG!",
    });
    assert.ok(msg.toLowerCase().includes("slug"), `got: ${msg}`);
  });

  it("slug regex enforced — rejects slug starting with digit", () => {
    const msg = fail(DeviceTemplate, { ...minimalLeaf, template: "1invalid" });
    assert.ok(msg.toLowerCase().includes("slug"), `got: ${msg}`);
  });

  it("rejects unknown fields (strict)", () => {
    const msg = fail(DeviceTemplate, { ...minimalLeaf, unknown_key: true });
    assert.ok(msg.length > 0);
  });

  it("measurements defaults to empty record", () => {
    const result = ok(DeviceTemplate, {
      ...minimalLeaf,
      measurements: undefined,
      commands: {
        set_power: baseCommandWithBinding,
      },
    });
    assert.deepEqual(result.measurements, {});
  });

  it("commands defaults to empty record", () => {
    const result = ok(DeviceTemplate, minimalLeaf);
    assert.deepEqual(result.commands, {});
  });

  it("contains defaults to empty array", () => {
    const result = ok(DeviceTemplate, minimalLeaf);
    assert.deepEqual(result.contains, []);
  });

  it("install_tasks defaults to empty array", () => {
    const result = ok(DeviceTemplate, minimalLeaf);
    assert.deepEqual(result.install_tasks, []);
  });

  it("accepts install_tasks list", () => {
    const result = ok(DeviceTemplate, {
      ...minimalLeaf,
      install_tasks: [
        baseInstallTask,
        {
          name: "wire_power",
          depends_on: ["mount_in_rack"],
          est_minutes: 45,
          crew_role: "electrician",
          cx_level: "L1",
        },
      ],
    });
    assert.equal(result.install_tasks.length, 2);
    assert.equal(result.install_tasks[1]?.name, "wire_power");
  });

  it("rejects install_task with depends_on pointing at missing task", () => {
    const msg = fail(DeviceTemplate, {
      ...minimalLeaf,
      install_tasks: [
        {
          name: "wire_power",
          depends_on: ["nonexistent"],
          est_minutes: 45,
          crew_role: "electrician",
          cx_level: "L1",
        },
      ],
    });
    assert.ok(
      msg.includes("depends_on") && msg.includes("nonexistent"),
      `got: ${msg}`,
    );
  });
});
