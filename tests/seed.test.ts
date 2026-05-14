/** Integration — seedFromFile against a real Postgres testcontainer. */

import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Logger } from "@nestjs/common";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as assert from "assert";
import { describe, test } from "node:test";
import { AppModuleWithDatabase } from "../src/app.module";
import { seedFromFile } from "../src/seed/seed_from_file";
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import { TopologyService } from "../src/topology/topology.service";
import type { DeviceTemplateType } from "../src/templates/template.schema";
import { startPostgres } from "./fixtures/containers";

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

/**
 * Bootstrap a NestJS test app with real Postgres + stubbed template catalog.
 * @returns Initialized NestJS application
 */
async function bootstrap(): Promise<INestApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModuleWithDatabase],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: <T = string>(_key: string, defaultValue?: T): T => {
        return defaultValue as T;
      },
    })
    .overrideProvider(TEMPLATE_CATALOG)
    .useValue(STUB_CATALOG)
    .compile();

  return moduleRef.createNestApplication().init();
}

/**
 * Serialize the given DTM body to a fresh temp dtm.json and return its path.
 * @param body DTM-shaped object to serialize as JSON
 * @returns Absolute path to the temp file
 */
async function writeDtmFile(body: unknown): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtm-"));
  const file = path.join(dir, "dtm.json");
  await fs.writeFile(file, JSON.stringify(body), "utf8");
  return file;
}

describe("seedFromFile integration", () => {
  test("empty DB + dtm.json present → topology seeded", async () => {
    // Arrange
    const pg = await startPostgres(undefined, { dbname: "postgres" });
    process.env["DOCUMENT_URL"] = pg.url;
    const file = await writeDtmFile(SAMPLE_DTM);
    const app = await bootstrap();
    try {
      // Act
      await seedFromFile(app, file, new Logger("seed-test"));
      // Assert — DTM was written to DB
      const service = app.get(TopologyService);
      const latest = await service.getLatest();
      assert.notEqual(latest, null);
      assert.equal(latest!.deployment_uuid, SAMPLE_DTM.deployment_uuid);
    } finally {
      await app.close();
      await pg.stop();
    }
  });

  test("populated DB → seed skipped (idempotent restart)", async () => {
    // Arrange
    const pg = await startPostgres(undefined, { dbname: "postgres" });
    process.env["DOCUMENT_URL"] = pg.url;
    // File on disk has a different DTM — should NOT overwrite the pre-seeded one
    const newDtm = {
      ...SAMPLE_DTM,
      deployment_uuid: "999e4567-e89b-12d3-a456-426614174099",
    };
    const file = await writeDtmFile(newDtm);
    const app = await bootstrap();
    const service = app.get(TopologyService);
    // Pre-seed DB with original DTM (simulates operator-set topology)
    await service.save(SAMPLE_DTM as never);
    try {
      // Act
      await seedFromFile(app, file, new Logger("seed-test"));
      // Assert — original retained, NOT replaced by file contents
      const latest = await service.getLatest();
      assert.equal(latest!.deployment_uuid, SAMPLE_DTM.deployment_uuid);
    } finally {
      await app.close();
      await pg.stop();
    }
  });

  test("path null → empty topology", async () => {
    // Arrange
    const pg = await startPostgres(undefined, { dbname: "postgres" });
    process.env["DOCUMENT_URL"] = pg.url;
    const app = await bootstrap();
    try {
      // Act
      await seedFromFile(app, null, new Logger("seed-test"));
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
