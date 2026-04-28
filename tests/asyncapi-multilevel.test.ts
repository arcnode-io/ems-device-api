/**
 * Integration test — Megapack-shaped 3-level DTM (module -> rack -> cell)
 * projects into x-protocol-source at every level.
 *
 * Validates the ADR-002 §7 amendment: parent-chain trees are arbitrary depth,
 * topic addressing stays flat, every level can declare its own measurements.
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

const MEGAPACK_DTM = {
  dtm_version: "1.0",
  deployment_uuid: "megapack-test-001",
  generated_at: "2026-04-27T00:00:00Z",
  sizing_ref: "sizing-mp-001",
  sizing_params: {
    P_compute_total_kW: 0,
    E_BESS_total_kWh: 3900,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {
    megapack_01: { class: "bess_module.v1", display_name: "Megapack 01" },
    rack_01: {
      class: "bess_rack.v1",
      parent: "megapack_01",
      display_name: "Rack 01",
    },
    bms_01: {
      class: "bess_bms.v1",
      parent: "rack_01",
      display_name: "BMS 01",
    },
    inverter_01: {
      class: "bess_inverter.v1",
      parent: "rack_01",
      display_name: "Inverter 01",
    },
    cell_001: {
      class: "bess_cell.v1",
      parent: "rack_01",
      display_name: "Cell 001",
    },
    cell_002: {
      class: "bess_cell.v1",
      parent: "rack_01",
      display_name: "Cell 002",
    },
  },
  buses: [
    {
      id: "rack_dc_bus",
      type: "dc",
      members: [
        { device_id: "bms_01" },
        { device_id: "inverter_01" },
        { device_id: "cell_001" },
        { device_id: "cell_002" },
      ],
    },
  ],
};

interface AsyncApiSpec {
  "x-protocol-source"?: Record<string, Record<string, Record<string, unknown>>>;
  "x-enum-values"?: Record<string, readonly string[]>;
}

describe("AsyncAPI multi-level (Megapack-shaped)", () => {
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
        .send(MEGAPACK_DTM);
      assert.strictEqual(post.status, 201);

      const res = await client(app.getHttpServer()).get("/asyncapi");
      assert.strictEqual(res.status, 200);
      const spec = res.body as AsyncApiSpec;

      const sources = spec["x-protocol-source"];
      assert.ok(sources, "x-protocol-source missing");

      // Module level
      assert.ok(
        sources["megapack_01"]?.voltage_dc,
        "module voltage_dc binding absent",
      );

      // Rack level
      assert.ok(
        sources["rack_01"]?.rack_voltage_dc,
        "rack rack_voltage_dc binding absent",
      );
      assert.strictEqual(sources["rack_01"]?.rack_voltage_dc.address, 4000);

      // Equipment level — BMS + inverter
      assert.ok(
        sources["bms_01"]?.bms_state_of_charge,
        "bms_state_of_charge binding absent",
      );
      assert.ok(
        sources["inverter_01"]?.active_power,
        "inverter active_power binding absent",
      );

      // Cell level (×2 — same class, same bindings)
      assert.ok(
        sources["cell_001"]?.cell_voltage,
        "cell_001 cell_voltage binding absent",
      );
      assert.ok(
        sources["cell_002"]?.cell_voltage,
        "cell_002 cell_voltage binding absent",
      );
      assert.strictEqual(sources["cell_001"]?.cell_voltage.address, 5000);

      // Enum values — multiple levels declare enums independently
      const enums = spec["x-enum-values"];
      assert.ok(enums, "x-enum-values missing");
      assert.deepStrictEqual(enums["bess_module.v1.alarm_state"], [
        "ok",
        "warn",
        "fault",
      ]);
      assert.deepStrictEqual(enums["bess_rack.v1.rack_alarm"], [
        "ok",
        "warn",
        "fault",
      ]);
      assert.deepStrictEqual(enums["bess_inverter.v1.inverter_state"], [
        "idle",
        "running",
        "fault",
      ]);
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
