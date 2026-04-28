/**
 * Minimal template fixtures for tests. Self-contained — no filesystem deps.
 *
 * Mirror just enough shape from `arcnode/device_templates/` for the spec
 * generator's projections (x-protocol-source, x-enum-values) to land
 * deterministic values. Tests embed these in `dtm.templates_used`.
 */

export const BESS_MODULE_V1 = {
  template: "bess_module",
  version: "v1",
  measurements: {
    voltage_dc: {
      unit: "volts",
      type: "float" as const,
      poll_rate_hz: 0.5,
      display_name_default: "DC Voltage",
    },
    alarm_state: {
      unit: "none",
      type: "enum" as const,
      values: {
        ok: { severity: "ok", register_value: 0 },
        warn: { severity: "warn", register_value: 1 },
        fault: { severity: "alarm", register_value: 2 },
      },
      display_name_default: "Alarm",
    },
  },
  commands: {
    set_active_power: {
      verb: "set" as const,
      target: "active_power",
      unit: "watts",
      payload: "float" as const,
      display_name_default: "Active Power Setpoint",
    },
  },
  protocol_binding_template: {
    type: "modbus_tcp",
    register_map: {
      voltage_dc: { addr: 3000, type: "int16", scale: 0.1 },
      alarm_state: { addr: 3010, type: "uint8" },
    },
  },
};

export const BESS_RACK_V1 = {
  template: "bess_rack",
  version: "v1",
  measurements: {
    rack_voltage_dc: {
      unit: "volts",
      type: "float" as const,
      poll_rate_hz: 0.5,
    },
    rack_alarm: {
      unit: "none",
      type: "enum" as const,
      values: {
        ok: { severity: "ok", register_value: 0 },
        warn: { severity: "warn", register_value: 1 },
        fault: { severity: "alarm", register_value: 2 },
      },
    },
  },
  protocol_binding_template: {
    type: "modbus_tcp",
    register_map: {
      rack_voltage_dc: { addr: 4000, type: "int16", scale: 0.1 },
      rack_alarm: { addr: 4010, type: "uint8" },
    },
  },
};

export const BESS_BMS_V1 = {
  template: "bess_bms",
  version: "v1",
  measurements: {
    bms_state_of_charge: {
      unit: "percent",
      type: "float" as const,
      poll_rate_hz: 1.0,
    },
  },
  protocol_binding_template: {
    type: "modbus_tcp",
    register_map: {
      bms_state_of_charge: { addr: 6000, type: "uint16", scale: 0.01 },
    },
  },
};

export const BESS_INVERTER_V1 = {
  template: "bess_inverter",
  version: "v1",
  measurements: {
    active_power: {
      unit: "watts",
      type: "float" as const,
      poll_rate_hz: 1.0,
    },
    inverter_state: {
      unit: "none",
      type: "enum" as const,
      values: {
        idle: { severity: "ok", register_value: 0 },
        running: { severity: "ok", register_value: 1 },
        fault: { severity: "alarm", register_value: 2 },
      },
    },
  },
  commands: {
    set_active_power: {
      verb: "set" as const,
      target: "active_power",
      unit: "watts",
      payload: "float" as const,
    },
  },
  protocol_binding_template: {
    type: "modbus_tcp",
    register_map: {
      active_power: { addr: 7000, type: "int32" },
      inverter_state: { addr: 7010, type: "uint8" },
    },
  },
};

export const BESS_CELL_V1 = {
  template: "bess_cell",
  version: "v1",
  measurements: {
    cell_voltage: {
      unit: "volts",
      type: "float" as const,
      poll_rate_hz: 0.1,
    },
  },
  protocol_binding_template: {
    type: "modbus_tcp",
    register_map: {
      cell_voltage: { addr: 5000, type: "int16", scale: 0.001 },
    },
  },
};

export const COMPUTE_MODULE_V1 = {
  template: "compute_module",
  version: "v1",
  measurements: {
    total_power_draw: { unit: "watts", type: "float" as const },
    utilization: { unit: "percent", type: "float" as const },
  },
};
