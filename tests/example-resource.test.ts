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

describe("Example Resource", () => {
  test("can create and retrieve example from database via HTTP", async () => {
    // Arrange: Start testcontainer
    const password = process.env.POSTGRES_PASSWORD;
    if (!password) throw new Error("POSTGRES_PASSWORD not set");
    const pg = await startPostgres(password);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModuleWithDatabase],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: <T = string>(key: string, defaultValue?: T): T => {
          if (key === "postgresPort") {
            return pg.port as T;
          }
          return defaultValue as T;
        },
      })
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
