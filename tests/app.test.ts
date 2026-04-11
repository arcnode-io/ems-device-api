import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "../src/app.module";
import * as assert from "assert";
import { describe, test, beforeEach } from "node:test";

describe("App Controller", () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  test("healthcheck endpoint", async () => {
    // Arrange
    const expectedText = "ok";
    // Act
    const response = await request(app.getHttpServer()).get("/");
    // Assert
    assert.strictEqual(response.text, expectedText);
  });
});
