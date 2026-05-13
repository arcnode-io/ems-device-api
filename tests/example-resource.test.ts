import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as client from "supertest";
import { App } from "supertest/types";
import { AppModuleWithDatabase } from "../src/app.module";
import * as assert from "assert";
import { ExampleService } from "../src/example/example.service";
import { describe, test } from "node:test";
import { Example } from "../src/example/entities/example.entity";
import { startPostgres } from "./fixtures/containers";
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import type { DeviceTemplateType } from "../src/templates/template.schema";

// Empty catalog stub — ExampleResource tests don't submit any DTMs.
const STUB_CATALOG: Record<string, DeviceTemplateType> = {};

describe("Example Resource", () => {
  test("can create and retrieve example from database via HTTP", async () => {
    // Arrange: Start testcontainer
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
      .useValue(STUB_CATALOG)
      .compile();

    const app: INestApplication<App> = moduleFixture.createNestApplication();
    await app.init();

    const exampleService = moduleFixture.get<ExampleService>(ExampleService);

    // Arrange: Create test data via service layer
    const createdExample = await exampleService.create({
      name: "Test Example Item",
    });

    // Act: GET the example via HTTP endpoint
    const response = await client(app.getHttpServer()).get(
      `/example/${createdExample.id}`,
    );

    // Assert: Verify the HTTP response
    const responseBody = response.body as Example;
    assert.strictEqual(responseBody.name, "Test Example Item");

    await app.close();
    await pg.stop();
  });
});
