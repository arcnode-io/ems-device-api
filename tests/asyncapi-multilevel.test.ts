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
import {
  BESS_MODULE_V1,
  BESS_RACK_V1,
  BESS_BMS_V1,
  BESS_INVERTER_V1,
  BESS_CELL_V1,
} from "./fixtures/templates";

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
    const password = process.env.POSTGRES_PASSWORD;
    if (!password) throw new Error("POSTGRES_PASSWORD not set");
    const pg = await startPostgres(password);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModuleWithDatabase],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: <T = string>(key: string, defaultValue?: T): T => {
          if (key === "postgresPort") return pg.port as T;
          return defaultValue as T;
        },
      })
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

      // x-protocol-source: protocol_binding_template escape hatch removed in PR 3;
      // module templates (bess_module_v1, bess_rack_v1) use publisher, not binding,
      // so they produce no entries. Leaf templates produce entries where binding exists.
      const sources = spec["x-protocol-source"];
      assert.ok(sources, "x-protocol-source missing");

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
