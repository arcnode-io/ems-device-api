/** Integration test — viewFromFile(dtm) is exactly what GET /topology/view serves for that DTM. */

import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import type { NestExpressApplication } from "@nestjs/platform-express";
import * as client from "supertest";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, test } from "node:test";
import { AppModuleWithDatabase, MAX_BODY_SIZE } from "../src/app.module";
import { startPostgres } from "./fixtures/containers";
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import type { DeviceTemplateType } from "../src/templates/template.schema";
import { viewFromFile } from "../src/topology/view_from_file";

const DTM_PATH = path.join(__dirname, "fixtures", "dtm_no_envelope.json");

describe("viewFromFile", () => {
  test("matches GET /topology/view for the same DTM", async () => {
    // Arrange — the fixture's own templates are the catalog; the check only needs the slugs.
    const dtm = JSON.parse(fs.readFileSync(DTM_PATH, "utf8")) as {
      templates_used: Record<string, DeviceTemplateType>;
    };
    const pg = await startPostgres();
    process.env["DOCUMENT_URL"] = pg.url;
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModuleWithDatabase],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: <T = string>(_key: string, defaultValue?: T): T =>
          defaultValue as T,
      })
      .overrideProvider(TEMPLATE_CATALOG)
      .useValue(dtm.templates_used)
      .compile();
    const app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useBodyParser("json", { limit: MAX_BODY_SIZE });
    await app.init();

    try {
      const post = await client(app.getHttpServer())
        .post("/topology")
        .send(dtm);
      assert.equal(post.status, 201, JSON.stringify(post.body));

      // Act
      const served = await client(app.getHttpServer()).get("/topology/view");
      const local = viewFromFile(DTM_PATH, dtm.templates_used);

      // Assert — compared as JSON, the form the HMI commits.
      assert.equal(served.status, 200);
      assert.deepEqual(served.body, JSON.parse(JSON.stringify(local)));
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
