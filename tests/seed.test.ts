/** Integration — seedFromS3 against LocalStack S3 + Postgres testcontainers. */

import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import {
  S3Client,
  CreateBucketCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import * as assert from "assert";
import { describe, test } from "node:test";
import { AppModuleWithDatabase } from "../src/app.module";
import { seedFromS3 } from "../src/seed/seed_from_s3";
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import { TopologyService } from "../src/topology/topology.service";
import type { DeviceTemplateType } from "../src/templates/template.schema";
import { startLocalStack, startPostgres } from "./fixtures/containers";

const TEMPLATE_BESS = {
  template: "bess_module_v1",
  kind: "module" as const,
  description: "BESS aggregate.",
  measurements: {
    voltage_dc: {
      unit: "volts",
      type: "float" as const,
      publisher: "line_controller" as const,
    },
  },
};

// Catalog stub — contains exactly the slugs used in SAMPLE_DTM.
// Reason: validateAgainstCatalog checks that every templates_used slug is in this catalog.
const STUB_CATALOG: Record<string, DeviceTemplateType> = {
  bess_module_v1: TEMPLATE_BESS as unknown as DeviceTemplateType,
};

const SAMPLE_DTM = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174099",
  sizing_params: {
    P_compute_total_kW: 100.0,
    E_BESS_total_kWh: 200.0,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {
    bess_001: {
      device_id: "bess_001",
      template: "bess_module_v1",
      parent: null,
      connection: { host: "10.0.0.1", port: 502, unit_id: null },
      blocking: ["live_mode"],
      extra_measurements: null,
    },
  },
  buses: [],
  templates_used: { bess_module_v1: TEMPLATE_BESS },
};

const BUCKET = "test-artifacts";
const KEY = "deployments/sample/dtm.json";

/**
 * Bootstrap a NestJS test app with real Postgres + stubbed template catalog.
 * @param opts Container options
 * @param opts.port Mapped Postgres port from testcontainer
 * @returns Initialized NestJS application
 */
async function bootstrap(opts: { port: number }): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModuleWithDatabase],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: <T = string>(key: string, defaultValue?: T): T => {
        if (key === "postgresPort") return opts.port as T;
        return defaultValue as T;
      },
    })
    .overrideProvider(TEMPLATE_CATALOG)
    .useValue(STUB_CATALOG)
    .compile();

  return moduleRef.createNestApplication().init();
}

describe("seedFromS3 integration", () => {
  test("empty DB + S3 object present → topology seeded", async () => {
    // Arrange
    const password = process.env["POSTGRES_PASSWORD"];
    if (!password) throw new Error("POSTGRES_PASSWORD not set");
    const pg = await startPostgres(password, { dbname: "postgres" });
    const ls = await startLocalStack();
    const s3 = new S3Client({
      endpoint: ls.url,
      forcePathStyle: true,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: KEY,
        Body: JSON.stringify(SAMPLE_DTM),
      }),
    );
    const app = await bootstrap({ port: pg.port });
    try {
      // Act
      await seedFromS3(
        app,
        `s3://${BUCKET}/${KEY}`,
        ls.url,
        new Logger("seed-test"),
        s3,
      );
      // Assert — DTM was written to DB
      const service = app.get(TopologyService);
      const latest = await service.getLatest();
      assert.notEqual(latest, null);
      assert.equal(latest!.deployment_uuid, SAMPLE_DTM.deployment_uuid);
    } finally {
      await app.close();
      await pg.stop();
      await ls.stop();
    }
  });

  test("populated DB → seed skipped (idempotent restart)", async () => {
    // Arrange
    const password = process.env["POSTGRES_PASSWORD"];
    if (!password) throw new Error("POSTGRES_PASSWORD not set");
    const pg = await startPostgres(password, { dbname: "postgres" });
    const ls = await startLocalStack();
    const s3 = new S3Client({
      endpoint: ls.url,
      forcePathStyle: true,
      region: "us-east-1",
      credentials: { accessKeyId: "test", secretAccessKey: "test" },
    });
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
    // Upload a different DTM to S3 — should NOT overwrite the pre-seeded one
    const newDtm = {
      ...SAMPLE_DTM,
      deployment_uuid: "999e4567-e89b-12d3-a456-426614174099",
    };
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: KEY,
        Body: JSON.stringify(newDtm),
      }),
    );
    const app = await bootstrap({ port: pg.port });
    const service = app.get(TopologyService);
    // Pre-seed DB with original DTM (simulates operator-set topology)
    await service.save(SAMPLE_DTM as never);
    try {
      // Act
      await seedFromS3(
        app,
        `s3://${BUCKET}/${KEY}`,
        ls.url,
        new Logger("seed-test"),
        s3,
      );
      // Assert — original retained, NOT replaced by S3 contents
      const latest = await service.getLatest();
      assert.equal(latest!.deployment_uuid, SAMPLE_DTM.deployment_uuid);
    } finally {
      await app.close();
      await pg.stop();
      await ls.stop();
    }
  });

  test("url null → empty topology", async () => {
    // Arrange
    const password = process.env["POSTGRES_PASSWORD"];
    if (!password) throw new Error("POSTGRES_PASSWORD not set");
    const pg = await startPostgres(password, { dbname: "postgres" });
    const app = await bootstrap({ port: pg.port });
    try {
      // Act
      await seedFromS3(app, null, null, new Logger("seed-test"));
      // Assert — nothing written, table still empty
      const service = app.get(TopologyService);
      const latest = await service.getLatest();
      assert.equal(latest, null);
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
