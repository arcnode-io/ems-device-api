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
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import type { DeviceTemplateType } from "../src/templates/template.schema";

// Minimal templates for round-trip — canonical DeviceTemplate shape.
const TEMPLATE_BESS = {
  template: "bess_module_v1",
  kind: "module" as const,
  description: "BESS module aggregate.",
  measurements: {
    voltage_dc: {
      unit: "volts",
      type: "float" as const,
      publisher: "line_controller" as const,
    },
  },
};
const TEMPLATE_COMPUTE = {
  template: "compute_module_v1",
  kind: "module" as const,
  description: "Compute module aggregate.",
  measurements: {
    total_power_draw: {
      unit: "watts",
      type: "float" as const,
      publisher: "line_controller" as const,
    },
  },
};

// Catalog stub — contains exactly the slugs used in SAMPLE_DTM.
// Reason: integration tests only need the record key to be present;
// cast via unknown because the fixtures omit optional fields that strict DeviceTemplateType requires.
const STUB_CATALOG: Record<string, DeviceTemplateType> = {
  bess_module_v1: TEMPLATE_BESS as unknown as DeviceTemplateType,
  compute_module_v1: TEMPLATE_COMPUTE as unknown as DeviceTemplateType,
};

// Mirror of edp-api's Dtm Pydantic shape (src/shared/schemas/dtm.py).
const SAMPLE_DTM = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174004",
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
    compute_001: {
      device_id: "compute_001",
      template: "compute_module_v1",
      display_name: "COMPUTE-001",
      parent: "bess_001",
    },
  },
  buses: [
    {
      bus_id: "dc_bus_main",
      type: "dc",
      members: [{ device_id: "bess_001" }, { device_id: "compute_001" }],
    },
  ],
  templates_used: {
    bess_module_v1: TEMPLATE_BESS,
    compute_module_v1: TEMPLATE_COMPUTE,
  },
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
      .overrideProvider(TEMPLATE_CATALOG)
      .useValue(STUB_CATALOG)
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
      .overrideProvider(TEMPLATE_CATALOG)
      .useValue(STUB_CATALOG)
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
      .overrideProvider(TEMPLATE_CATALOG)
      .useValue(STUB_CATALOG)
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

  test("POST /topology bumps version monotonically; GET /asyncapi reflects info.version", async () => {
    // Arrange — fresh Postgres
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
      .overrideProvider(TEMPLATE_CATALOG)
      .useValue(STUB_CATALOG)
      .compile();

    const app: INestApplication<App> = moduleFixture.createNestApplication();
    await app.init();
    const http = client(app.getHttpServer());

    try {
      // Act 1 — first POST → bootstrap to 1.0.0
      const post1 = await http.post("/topology").send(SAMPLE_DTM);
      assert.strictEqual(post1.status, 201, JSON.stringify(post1.body));
      let asyncapi = (await http.get("/asyncapi").expect(200)).body as {
        info: { version: string };
      };
      assert.equal(asyncapi.info.version, "1.0.0");

      // Act 2 — same DTM → bumps to 1.0.1 (monotonic, no diff)
      const post2 = await http.post("/topology").send(SAMPLE_DTM);
      assert.strictEqual(post2.status, 201, JSON.stringify(post2.body));
      asyncapi = (await http.get("/asyncapi").expect(200)).body as {
        info: { version: string };
      };
      assert.equal(asyncapi.info.version, "1.0.1");

      // Act 3 — change display_name → bumps to 1.0.2
      // Reason: cast through unknown to mutate display_name without noUncheckedIndexedAccess noise.
      const renamed = JSON.parse(JSON.stringify(SAMPLE_DTM)) as {
        devices: { bess_001: { display_name: string } };
      };
      renamed.devices.bess_001.display_name = "Renamed";
      const post3 = await http.post("/topology").send(renamed);
      assert.strictEqual(post3.status, 201, JSON.stringify(post3.body));
      asyncapi = (await http.get("/asyncapi").expect(200)).body as {
        info: { version: string };
      };
      assert.equal(asyncapi.info.version, "1.0.2");
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
