/**
 * Minimal template fixtures for tests — canonical DeviceTemplate shape.
 * Self-contained — no filesystem deps.
 *
 * Cascade note (PR 3): templates are now validated against the strict DeviceTemplate
 * Zod schema (extra="forbid"). Old `version` and `protocol_binding_template` fields
 * have been removed. Leaf templates require kind, equipment_id, vendor, model.
 * Module templates require kind and description; equipment_id/vendor/model forbidden.
 */

const modbusBinding = {
  protocol: "modbus_tcp" as const,
  function_code: 3,
  address: 3000,
};

export const BESS_MODULE_V1 = {
  template: "bess_module_v1",
  kind: "module" as const,
  description: "BESS container module — aggregate DC bus readings.",
  measurements: {
    voltage_dc: {
      unit: "volts",
      type: "float" as const,
      poll_rate_hz: 0.5,
      display_name_default: "DC Voltage",
      publisher: "line_controller" as const,
    },
    alarm_state: {
      unit: "none",
      type: "enum" as const,
      values: {
        ok: "ok",
        warn: "warn",
        fault: "fault",
      },
      display_name_default: "Alarm",
      publisher: "line_controller" as const,
    },
  },
  commands: {
    set_active_power: {
      verb: "set" as const,
      target: "active_power",
      unit: "watts",
      payload: "float" as const,
      display_name_default: "Active Power Setpoint",
      fanout: "line_controller" as const,
    },
  },
};

export const BESS_RACK_V1 = {
  template: "bess_rack_v1",
  kind: "module" as const,
  description: "BESS rack — contains BMS, inverter, and cells.",
  measurements: {
    rack_voltage_dc: {
      unit: "volts",
      type: "float" as const,
      poll_rate_hz: 0.5,
      publisher: "line_controller" as const,
    },
    rack_alarm: {
      unit: "none",
      type: "enum" as const,
      values: {
        ok: "ok",
        warn: "warn",
        fault: "fault",
      },
      publisher: "line_controller" as const,
    },
  },
};

export const BESS_BMS_V1 = {
  template: "bess_bms_v1",
  kind: "leaf" as const,
  equipment_id: "EQ-BMS",
  vendor: "Acme",
  model: "BMS-100",
  description: "Battery Management System leaf device.",
  measurements: {
    bms_state_of_charge: {
      unit: "percent",
      type: "float" as const,
      poll_rate_hz: 1.0,
      binding: {
        protocol: "modbus_tcp" as const,
        function_code: 3,
        address: 6000,
      },
    },
  },
};

export const BESS_INVERTER_V1 = {
  template: "bess_inverter_v1",
  kind: "leaf" as const,
  equipment_id: "EQ-INV",
  vendor: "Acme",
  model: "INV-200",
  description: "DC-AC inverter leaf device.",
  measurements: {
    active_power: {
      unit: "watts",
      type: "float" as const,
      poll_rate_hz: 1.0,
      binding: {
        protocol: "modbus_tcp" as const,
        function_code: 3,
        address: 7000,
      },
    },
    inverter_state: {
      unit: "none",
      type: "enum" as const,
      values: {
        idle: "idle",
        running: "running",
        fault: "fault",
      },
      binding: {
        protocol: "modbus_tcp" as const,
        function_code: 3,
        address: 7010,
      },
    },
  },
  commands: {
    set_active_power: {
      verb: "set" as const,
      target: "active_power",
      unit: "watts",
      payload: "float" as const,
      binding: modbusBinding,
    },
  },
};

export const BESS_CELL_V1 = {
  template: "bess_cell_v1",
  kind: "leaf" as const,
  equipment_id: "EQ-CELL",
  vendor: "Acme",
  model: "CELL-48V",
  description: "Individual battery cell leaf device.",
  measurements: {
    cell_voltage: {
      unit: "volts",
      type: "float" as const,
      poll_rate_hz: 0.1,
      binding: {
        protocol: "modbus_tcp" as const,
        function_code: 3,
        address: 5000,
      },
    },
  },
};

export const COMPUTE_MODULE_V1 = {
  template: "compute_module_v1",
  kind: "module" as const,
  description: "Compute module aggregate — power and utilization rolled up.",
  measurements: {
    total_power_draw: {
      unit: "watts",
      type: "float" as const,
      publisher: "line_controller" as const,
    },
    utilization: {
      unit: "percent",
      type: "float" as const,
      publisher: "line_controller" as const,
    },
  },
};
