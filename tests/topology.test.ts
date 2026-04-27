/** Integration test — DTM round-trips through POST /topology → GET /topology. */

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

// Mirror of edp-api's Dtm Pydantic shape (src/generators/dtm_models.py).
const SAMPLE_DTM = {
  dtm_version: "1.0",
  deployment_uuid: "test-deployment-001",
  generated_at: "2026-04-26T00:00:00Z",
  sizing_ref: "sizing-001",
  sizing_params: {
    P_compute_total_kW: 100.0,
    E_BESS_total_kWh: 200.0,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {
    bess_001: {
      class: "bess_module.tesla_megapack_xl",
      display_name: "BESS-001",
    },
    compute_001: {
      class: "compute_module.nvidia_dgx_h100",
      display_name: "COMPUTE-001",
      parent: "bess_001",
    },
  },
  buses: [
    {
      id: "dc_bus_main",
      type: "dc",
      members: [{ device_id: "bess_001" }, { device_id: "compute_001" }],
    },
  ],
};

describe("Topology", () => {
  test("POST /topology persists the DTM; GET /topology returns the latest", async () => {
    // Arrange — testcontainer postgres
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
      // Act — submit DTM
      const post = await client(app.getHttpServer())
        .post("/topology")
        .send(SAMPLE_DTM);
      assert.strictEqual(post.status, 201, JSON.stringify(post.body));

      // Act — read it back
      const get = await client(app.getHttpServer()).get("/topology");
      assert.strictEqual(get.status, 200);

      // Assert — round-tripped values land verbatim
      const body = get.body as typeof SAMPLE_DTM;
      assert.strictEqual(body.dtm_version, SAMPLE_DTM.dtm_version);
      assert.strictEqual(body.deployment_uuid, SAMPLE_DTM.deployment_uuid);
      assert.strictEqual(
        Object.keys(body.devices).length,
        Object.keys(SAMPLE_DTM.devices).length,
      );
      assert.strictEqual(body.buses.length, SAMPLE_DTM.buses.length);
      assert.strictEqual(body.buses[0]?.type, "dc");
    } finally {
      await app.close();
      await pg.stop();
    }
  });

  test("POST /topology rejects malformed DTM with 400", async () => {
    // Arrange
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
      // Act — missing required fields
      const post = await client(app.getHttpServer())
        .post("/topology")
        .send({ dtm_version: "1.0" });

      // Assert — Zod rejects, NestJS maps to 400
      assert.strictEqual(post.status, 400);
    } finally {
      await app.close();
      await pg.stop();
    }
  });

  test("GET /topology returns 404 when no DTM has been submitted", async () => {
    // Arrange
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
      const get = await client(app.getHttpServer()).get("/topology");
      assert.strictEqual(get.status, 404);
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
