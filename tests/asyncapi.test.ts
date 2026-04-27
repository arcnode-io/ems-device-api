/** Integration test — AsyncAPI v3 spec served three ways from the persisted DTM. */

import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as client from "supertest";
import { App } from "supertest/types";
import * as assert from "assert";
import * as yaml from "yaml";
import { describe, test } from "node:test";
import { AppModuleWithDatabase } from "../src/app.module";
import { startPostgres } from "./fixtures/containers";

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

interface AsyncApiSpec {
  asyncapi: string;
  info: { title: string; version: string };
  channels: Record<string, { address: string }>;
  components: {
    messages: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
}

/**
 * Stand up a Nest app + testcontainer postgres for one test case.
 * @returns The running app + a handle to stop the postgres container.
 */
async function bootstrap(): Promise<{
  app: INestApplication<App>;
  pg: { stop: () => Promise<unknown> };
}> {
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
  return { app, pg };
}

describe("AsyncAPI", () => {
  test("GET /asyncapi returns AsyncAPI 3.0.0 JSON with a channel per device", async () => {
    const { app, pg } = await bootstrap();
    try {
      // Arrange — persist a DTM
      const post = await client(app.getHttpServer())
        .post("/topology")
        .send(SAMPLE_DTM);
      assert.strictEqual(post.status, 201);

      // Act
      const res = await client(app.getHttpServer()).get("/asyncapi");

      // Assert — top-level shape + per-device channels
      assert.strictEqual(res.status, 200);
      assert.match(res.headers["content-type"] ?? "", /application\/json/);
      const spec = res.body as AsyncApiSpec;
      assert.strictEqual(spec.asyncapi, "3.0.0");
      assert.ok(spec.info.title.length > 0);
      // Each device gets at least one channel; topic per ADR-002 includes device id.
      assert.ok(
        Object.values(spec.channels).some((ch) =>
          ch.address.includes("bess_001"),
        ),
        "no channel for bess_001",
      );
      assert.ok(
        Object.values(spec.channels).some((ch) =>
          ch.address.includes("compute_001"),
        ),
        "no channel for compute_001",
      );
      // Reading schema is registered in components
      assert.ok(spec.components.schemas["Reading"], "missing Reading schema");
    } finally {
      await app.close();
      await pg.stop();
    }
  });

  test("GET /asyncapi/yaml returns the same spec as YAML", async () => {
    const { app, pg } = await bootstrap();
    try {
      await client(app.getHttpServer()).post("/topology").send(SAMPLE_DTM);

      const res = await client(app.getHttpServer()).get("/asyncapi/yaml");
      assert.strictEqual(res.status, 200);
      assert.match(res.headers["content-type"] ?? "", /yaml/);
      // body is bytes; supertest puts it in res.text for non-JSON content-types
      const parsed = yaml.parse(res.text) as AsyncApiSpec;
      assert.strictEqual(parsed.asyncapi, "3.0.0");
    } finally {
      await app.close();
      await pg.stop();
    }
  });

  test("GET /asyncapi/docs returns HTML embedding the spec", async () => {
    const { app, pg } = await bootstrap();
    try {
      await client(app.getHttpServer()).post("/topology").send(SAMPLE_DTM);

      const res = await client(app.getHttpServer()).get("/asyncapi/docs");
      assert.strictEqual(res.status, 200);
      assert.match(res.headers["content-type"] ?? "", /text\/html/);
      // Page mentions our deployment_uuid (came from the rendered spec)
      assert.ok(
        res.text.includes("test-deployment-001"),
        "deployment_uuid not in rendered HTML",
      );
      // Loads the AsyncAPI viewer (web component or hand-rolled — at minimum
      // mentions 'asyncapi' in the markup)
      assert.match(res.text.toLowerCase(), /asyncapi/);
    } finally {
      await app.close();
      await pg.stop();
    }
  });

  test("GET /asyncapi returns 404 when no DTM has been submitted", async () => {
    const { app, pg } = await bootstrap();
    try {
      const res = await client(app.getHttpServer()).get("/asyncapi");
      assert.strictEqual(res.status, 404);
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
