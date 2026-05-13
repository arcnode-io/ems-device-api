/**
 * Integration test — 3-level BESS-shaped DTM (module -> rack -> equipment)
 * projects into x-protocol-source at every level.
 *
 * Validates the ADR-002 §7 amendment: parent-chain trees are arbitrary depth,
 * topic addressing stays flat, every level can declare its own measurements.
 * The same shape applies to compute (cluster -> chassis -> server -> GPU)
 * hierarchies.
 */

import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as client from "supertest";
import { App } from "supertest/types";
import * as assert from "assert";
import { describe, test } from "node:test";
import { AppModuleWithDatabase } from "../src/app.module";
import { startPostgres } from "./fixtures/containers";
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import type { DeviceTemplateType } from "../src/templates/template.schema";
import {
  BESS_MODULE_V1,
  BESS_RACK_V1,
  BESS_BMS_V1,
  BESS_INVERTER_V1,
  BESS_CELL_V1,
} from "./fixtures/templates";

// Catalog stub — contains exactly the slugs used in MULTILEVEL_BESS_DTM.
const TEST_CATALOG: Record<string, DeviceTemplateType> = {
  bess_module_v1: BESS_MODULE_V1 as unknown as DeviceTemplateType,
  bess_rack_v1: BESS_RACK_V1 as unknown as DeviceTemplateType,
  bess_bms_v1: BESS_BMS_V1 as unknown as DeviceTemplateType,
  bess_inverter_v1: BESS_INVERTER_V1 as unknown as DeviceTemplateType,
  bess_cell_v1: BESS_CELL_V1 as unknown as DeviceTemplateType,
};

const MULTILEVEL_BESS_DTM = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174003",
  sizing_params: {
    P_compute_total_kW: 0,
    E_BESS_total_kWh: 3900,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {
    bess_module_01: {
      device_id: "bess_module_01",
      template: "bess_module_v1",
      display_name: "BESS Module 01",
    },
    rack_01: {
      device_id: "rack_01",
      template: "bess_rack_v1",
      parent: "bess_module_01",
      display_name: "Rack 01",
    },
    bms_01: {
      device_id: "bms_01",
      template: "bess_bms_v1",
      parent: "rack_01",
      display_name: "BMS 01",
    },
    inverter_01: {
      device_id: "inverter_01",
      template: "bess_inverter_v1",
      parent: "rack_01",
      display_name: "Inverter 01",
    },
    cell_001: {
      device_id: "cell_001",
      template: "bess_cell_v1",
      parent: "rack_01",
      display_name: "Cell 001",
    },
    cell_002: {
      device_id: "cell_002",
      template: "bess_cell_v1",
      parent: "rack_01",
      display_name: "Cell 002",
    },
  },
  buses: [
    {
      bus_id: "rack_dc_bus",
      type: "dc",
      members: [
        { device_id: "bms_01" },
        { device_id: "inverter_01" },
        { device_id: "cell_001" },
        { device_id: "cell_002" },
      ],
    },
  ],
  templates_used: {
    bess_module_v1: BESS_MODULE_V1,
    bess_rack_v1: BESS_RACK_V1,
    bess_bms_v1: BESS_BMS_V1,
    bess_inverter_v1: BESS_INVERTER_V1,
    bess_cell_v1: BESS_CELL_V1,
  },
};

interface AsyncApiSpec {
  "x-protocol-source"?: Record<string, Record<string, Record<string, unknown>>>;
  "x-enum-values"?: Record<string, readonly string[]>;
}

describe("AsyncAPI multi-level (BESS-shaped)", () => {
  test("3-level DTM projects into x-protocol-source at every level", async () => {
    const pg = await startPostgres();
    process.env["DOCUMENT_URL"] = pg.url;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModuleWithDatabase],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: <T = string>(_key: string, defaultValue?: T): T => {
          return defaultValue as T;
        },
      })
      .overrideProvider(TEMPLATE_CATALOG)
      .useValue(TEST_CATALOG)
      .compile();

    const app: INestApplication<App> = moduleFixture.createNestApplication();
    await app.init();

    try {
      const post = await client(app.getHttpServer())
        .post("/topology")
        .send(MULTILEVEL_BESS_DTM);
      assert.strictEqual(post.status, 201);

      const res = await client(app.getHttpServer()).get("/asyncapi");
      assert.strictEqual(res.status, 200);
      const spec = res.body as AsyncApiSpec;

      // x-protocol-source: module templates (bess_module_v1, bess_rack_v1) use
      // publisher, not binding, so they produce no entries. Leaf templates (bess_bms_v1,
      // bess_inverter_v1, bess_cell_v1) emit entries for each bound channel.
      const sources = spec["x-protocol-source"];
      assert.ok(sources, "x-protocol-source missing");

      // Modbus default fields filled by Zod: data_type=int16, word_order=high_low, scale=1, offset=0
      const MODBUS_DEFAULTS = {
        data_type: "int16",
        word_order: "high_low",
        scale: 1,
        offset: 0,
      };

      // Strong assertion: bms_01 uses bess_bms_v1 → bms_state_of_charge has modbus binding
      assert.deepStrictEqual(
        sources["bms_01"]?.["bms_state_of_charge"],
        {
          protocol: "modbus_tcp",
          function_code: 3,
          address: 6000,
          ...MODBUS_DEFAULTS,
          unit: "percent",
          poll_rate_hz: 1,
        },
        "bms_01.bms_state_of_charge binding mismatch",
      );

      // inverter_01 — both a float measurement and an enum measurement have bindings
      assert.deepStrictEqual(
        sources["inverter_01"]?.["active_power"],
        {
          protocol: "modbus_tcp",
          function_code: 3,
          address: 7000,
          ...MODBUS_DEFAULTS,
          unit: "watts",
          poll_rate_hz: 1,
        },
        "inverter_01.active_power binding mismatch",
      );
      assert.deepStrictEqual(
        sources["inverter_01"]?.["inverter_state"],
        {
          protocol: "modbus_tcp",
          function_code: 3,
          address: 7010,
          ...MODBUS_DEFAULTS,
          unit: "none",
          poll_rate_hz: null,
        },
        "inverter_01.inverter_state binding mismatch",
      );

      // cell_001 + cell_002 both derive from bess_cell_v1
      assert.deepStrictEqual(
        sources["cell_001"]?.["cell_voltage"],
        {
          protocol: "modbus_tcp",
          function_code: 3,
          address: 5000,
          ...MODBUS_DEFAULTS,
          unit: "volts",
          poll_rate_hz: 0.1,
        },
        "cell_001.cell_voltage binding mismatch",
      );
      assert.deepStrictEqual(
        sources["cell_002"]?.["cell_voltage"],
        {
          protocol: "modbus_tcp",
          function_code: 3,
          address: 5000,
          ...MODBUS_DEFAULTS,
          unit: "volts",
          poll_rate_hz: 0.1,
        },
        "cell_002.cell_voltage binding mismatch",
      );

      // Module-level devices produce no entries (publisher only)
      assert.strictEqual(
        sources["bess_module_01"],
        undefined,
        "bess_module_v1 should not appear in source map",
      );
      assert.strictEqual(
        sources["rack_01"],
        undefined,
        "bess_rack_v1 should not appear in source map",
      );

      // Enum values — multiple levels declare enums independently
      // Keys now use underscore slugs (no dots); values alphabetical (no register_value)
      const enums = spec["x-enum-values"];
      assert.ok(enums, "x-enum-values missing");
      assert.deepStrictEqual(enums["bess_module_v1.alarm_state"], [
        "fault",
        "ok",
        "warn",
      ]);
      assert.deepStrictEqual(enums["bess_rack_v1.rack_alarm"], [
        "fault",
        "ok",
        "warn",
      ]);
      assert.deepStrictEqual(enums["bess_inverter_v1.inverter_state"], [
        "fault",
        "idle",
        "running",
      ]);
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
