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
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import type { DeviceTemplateType } from "../src/templates/template.schema";
import { BESS_MODULE_V1 } from "./fixtures/templates";

// Catalog stub — contains exactly the slugs used in DTM_WITH_BESS.
const TEST_CATALOG: Record<string, DeviceTemplateType> = {
  bess_module_v1: BESS_MODULE_V1 as unknown as DeviceTemplateType,
};

const DTM_WITH_BESS = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174002",
  sizing_params: {
    P_compute_total_kW: 100.0,
    E_BESS_total_kWh: 200.0,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {
    bess_001: {
      device_id: "bess_001",
      template: "bess_module_v1",
      display_name: "BESS-001",
    },
  },
  buses: [
    { bus_id: "dc_bus", type: "dc", members: [{ device_id: "bess_001" }] },
  ],
  templates_used: {
    bess_module_v1: BESS_MODULE_V1,
  },
};

interface AsyncApiSpec {
  "x-protocol-source"?: Record<string, Record<string, Record<string, unknown>>>;
  "x-enum-values"?: Record<string, readonly string[]>;
}

describe("AsyncAPI template projection", () => {
  test("DTM device with bess_module.v1 template projects into x-protocol-source", async () => {
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
        .send(DTM_WITH_BESS);
      assert.strictEqual(post.status, 201);

      const res = await client(app.getHttpServer()).get("/asyncapi");
      assert.strictEqual(res.status, 200);
      const spec = res.body as AsyncApiSpec;

      // x-protocol-source: bess_module_v1 uses publisher (not binding) on all
      // measurements, so no entries are emitted — the extension is present but empty.
      const sources = spec["x-protocol-source"];
      assert.ok(sources, "x-protocol-source missing");
      assert.deepStrictEqual(
        sources["bess_001"],
        undefined,
        "bess_module_v1 has no bindings — bess_001 should not appear in source map",
      );

      // x-enum-values keyed by `${template}.${measurement}` (slug, no dots)
      // Values are string → alphabetical order (no register_value on new fixtures)
      const enums = spec["x-enum-values"];
      assert.ok(enums, "x-enum-values missing");
      assert.deepStrictEqual(
        enums["bess_module_v1.alarm_state"],
        ["fault", "ok", "warn"],
        "alarm_state enum vocabulary missing/incorrect",
      );
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
