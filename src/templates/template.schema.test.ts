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
  DeviceTemplate,
  Fanout,
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
  it("has line_controller and analyst values", () => {
    assert.equal(Publisher.LINE_CONTROLLER, "line_controller");
    assert.equal(Publisher.ANALYST, "analyst");
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

  it("type=float requires iec_61850_ref", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      bounds: baseBounds,
      thresholds: baseThresholds,
      binding: modbusBinding,
    });
    assert.ok(msg.length > 0);
  });

  it("type=float requires bounds", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      thresholds: baseThresholds,
      binding: modbusBinding,
    });
    assert.ok(msg.includes("bounds required for type=float"), `got: ${msg}`);
  });

  it("type=float requires thresholds", () => {
    const msg = fail(Measurement, {
      unit: "W",
      type: "float",
      iec_61850_ref: "MMXU.W",
      bounds: baseBounds,
      binding: modbusBinding,
    });
    assert.ok(
      msg.includes("thresholds required for type=float"),
      `got: ${msg}`,
    );
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
});
