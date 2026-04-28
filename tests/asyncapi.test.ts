/** Integration test — AsyncAPI v3 spec served three ways from the persisted DTM. */

import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as client from "supertest";
import { App } from "supertest/types";
import * as assert from "assert";
import * as yaml from "yaml";
import { Parser } from "@asyncapi/parser";

const DIAGNOSTIC_SEVERITY_ERROR = 0;
import { describe, test } from "node:test";
import { AppModuleWithDatabase } from "../src/app.module";
import { startPostgres } from "./fixtures/containers";
import { BESS_MODULE_V1, COMPUTE_MODULE_V1 } from "./fixtures/templates";

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
      template: "bess_module.v1",
      display_name: "BESS-001",
    },
    compute_001: {
      template: "compute_module.v1",
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
  templates_used: {
    "bess_module.v1": BESS_MODULE_V1,
    "compute_module.v1": COMPUTE_MODULE_V1,
  },
};

interface AsyncApiSpec {
  asyncapi: string;
  info: { title: string; version: string };
  channels: Record<
    string,
    { address: string; parameters?: Record<string, unknown> }
  >;
  operations: Record<
    string,
    { action: string; bindings?: Record<string, unknown>; channel: unknown }
  >;
  components: {
    messages: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
  "x-protocol-source"?: Record<string, Record<string, unknown>>;
  "x-enum-values"?: Record<string, readonly string[]>;
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
  test("GET /asyncapi returns 3.0.0 JSON with templated channels and components", async () => {
    const { app, pg } = await bootstrap();
    try {
      const post = await client(app.getHttpServer())
        .post("/topology")
        .send(SAMPLE_DTM);
      assert.strictEqual(post.status, 201);

      const res = await client(app.getHttpServer()).get("/asyncapi");

      assert.strictEqual(res.status, 200);
      assert.match(res.headers["content-type"] ?? "", /application\/json/);
      const spec = res.body as AsyncApiSpec;
      assert.strictEqual(spec.asyncapi, "3.0.0");
      assert.ok(spec.info.title.length > 0);

      // Templated channels — one per (family × wire-type), addresses contain {param}s
      for (const key of [
        "measurementFloat",
        "measurementBool",
        "measurementEnum",
        "commandFloat",
        "commandBool",
        "commandEnum",
        "commandTrigger",
        "topologyChanged",
      ]) {
        assert.ok(spec.channels[key], `missing channel template ${key}`);
      }
      const floatChannel = spec.channels["measurementFloat"];
      assert.ok(floatChannel, "measurementFloat channel missing");
      assert.match(
        floatChannel.address,
        /\{site_id\}.*\{device_id\}.*\{measurement\}.*\{unit\}/,
      );
      assert.ok(floatChannel.parameters);

      // Components — 4 sample schemas + 4 messages + topology + ProtocolSource schema
      for (const msgName of [
        "FloatSampleMsg",
        "BooleanSampleMsg",
        "EnumSampleMsg",
        "TriggerSampleMsg",
        "TopologyChangedMsg",
      ]) {
        assert.ok(
          spec.components.messages[msgName],
          `missing message ${msgName}`,
        );
      }
      for (const schemaName of [
        "FloatSample",
        "BooleanSample",
        "EnumSample",
        "TriggerSample",
        "ProtocolSource",
      ]) {
        assert.ok(
          spec.components.schemas[schemaName],
          `missing schema ${schemaName}`,
        );
      }
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
      assert.ok(
        res.text.includes("test-deployment-001"),
        "deployment_uuid not in rendered HTML",
      );
      assert.match(res.text.toLowerCase(), /asyncapi/);
    } finally {
      await app.close();
      await pg.stop();
    }
  });

  test("Generated spec validates against the AsyncAPI 3.0.0 schema", async () => {
    const { app, pg } = await bootstrap();
    try {
      await client(app.getHttpServer()).post("/topology").send(SAMPLE_DTM);
      const res = await client(app.getHttpServer()).get("/asyncapi");
      assert.strictEqual(res.status, 200);

      const parser = new Parser();
      const { document, diagnostics } = await parser.parse(
        JSON.stringify(res.body),
      );
      const errors = diagnostics.filter(
        (diag) => Number(diag.severity) === DIAGNOSTIC_SEVERITY_ERROR,
      );
      assert.deepStrictEqual(
        errors,
        [],
        `parser flagged errors: ${JSON.stringify(errors, null, 2)}`,
      );
      assert.ok(document, "parser returned no document");
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

  test("Operations carry MQTT bindings per family (ADR-002 §11)", async () => {
    const { app, pg } = await bootstrap();
    try {
      await client(app.getHttpServer()).post("/topology").send(SAMPLE_DTM);
      const res = await client(app.getHttpServer()).get("/asyncapi");
      const spec = res.body as AsyncApiSpec;

      const measOp = spec.operations["publishMeasurementFloat"];
      assert.ok(measOp, "publishMeasurementFloat operation missing");
      const measBindings = (
        measOp.bindings as { mqtt: Record<string, unknown> }
      ).mqtt;
      assert.strictEqual(measBindings.qos, 0);
      assert.strictEqual(measBindings.retain, true);
      assert.strictEqual(measBindings.bindingVersion, "0.2.0");

      const cmdOp = spec.operations["receiveCommandFloat"];
      assert.ok(cmdOp, "receiveCommandFloat operation missing");
      const cmdBindings = (cmdOp.bindings as { mqtt: Record<string, unknown> })
        .mqtt;
      assert.strictEqual(cmdBindings.qos, 1);
      assert.strictEqual(cmdBindings.retain, false);

      // In AsyncAPI 3.0 the operation key IS the identifier.
      for (const [key, op] of Object.entries(spec.operations)) {
        assert.ok(key.length > 0, "operation has empty key");
        assert.ok(op.action, "operation missing action");
        assert.ok(op.channel, "operation missing channel ref");
      }
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
