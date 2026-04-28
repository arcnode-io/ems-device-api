/**
 * Integration test — embedded `templates_used` projects into x-protocol-source
 * and x-enum-values extensions on the spec.
 *
 * The DTM-instance side (which devices, which templates) drives
 * x-protocol-source. The template vocabulary in `templates_used` drives
 * x-enum-values. Channel templates themselves are template-agnostic.
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
import { BESS_MODULE_V1 } from "./fixtures/templates";

const DTM_WITH_BESS = {
  dtm_version: "1.0",
  deployment_uuid: "expansion-test-001",
  generated_at: "2026-04-26T00:00:00Z",
  sizing_ref: "sizing-001",
  sizing_params: {
    P_compute_total_kW: 100.0,
    E_BESS_total_kWh: 200.0,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {
    bess_001: { template: "bess_module.v1", display_name: "BESS-001" },
  },
  buses: [{ id: "dc_bus", type: "dc", members: [{ device_id: "bess_001" }] }],
  templates_used: {
    "bess_module.v1": BESS_MODULE_V1,
  },
};

interface AsyncApiSpec {
  "x-protocol-source"?: Record<string, Record<string, Record<string, unknown>>>;
  "x-enum-values"?: Record<string, readonly string[]>;
}

describe("AsyncAPI template projection", () => {
  test("DTM device with bess_module.v1 template projects into x-protocol-source", async () => {
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
        .send(DTM_WITH_BESS);
      assert.strictEqual(post.status, 201);

      const res = await client(app.getHttpServer()).get("/asyncapi");
      assert.strictEqual(res.status, 200);
      const spec = res.body as AsyncApiSpec;

      // x-protocol-source keyed by device_id, then by measurement/command name
      const sources = spec["x-protocol-source"];
      assert.ok(sources, "x-protocol-source missing");
      assert.ok(sources["bess_001"], "bess_001 absent from x-protocol-source");
      assert.ok(sources["bess_001"]["voltage_dc"], "voltage_dc binding absent");
      const voltage = sources["bess_001"]["voltage_dc"];
      assert.strictEqual(voltage.protocol, "modbus_tcp");
      assert.strictEqual(voltage.address, 3000);
      assert.strictEqual(voltage.scale, 0.1);

      // x-enum-values keyed by `${class}.${version}.${measurement}`
      const enums = spec["x-enum-values"];
      assert.ok(enums, "x-enum-values missing");
      assert.deepStrictEqual(
        enums["bess_module.v1.alarm_state"],
        ["ok", "warn", "fault"],
        "alarm_state enum vocabulary missing/incorrect",
      );
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
