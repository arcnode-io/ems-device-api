import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import * as request from "supertest";
import { App } from "supertest/types";
import { AppModule } from "../src/app.module";
import { ApiResponseDto } from "../src/call-api/dto/api-response.dto";
import * as assert from "assert";
import * as nock from "nock";
import { loadConfig } from "../src/config";
import { describe, test, beforeEach } from "node:test";

describe("API Call Example", () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  interface MockResponse {
    url: string;
  }

  interface ClientOpts {
    baseUrl: string;
    path: string;
    method?: "get" | "post" | "put" | "delete";
    mockResponse: MockResponse;
    responseCode?: number;
  }

  /**
   * Creates a mockable HTTP client for testing external API calls.
   * @param opts Configuration options for the HTTP client
   * @returns SuperTest instance for making HTTP requests
   */
  function mockableHttpClient(opts: ClientOpts): ReturnType<typeof request> {
    const {
      baseUrl,
      path,
      method = "get",
      mockResponse,
      responseCode = 200,
    } = opts;

    const cfg = loadConfig();
    if (!cfg.e2e) {
      nock(baseUrl)[method](path).reply(responseCode, mockResponse);
    }
    return request(app.getHttpServer());
  }

  test("should call external API and return mocked response", async () => {
    const client = mockableHttpClient({
      baseUrl: "https://httpbin.org",
      path: "/get",
      mockResponse: {
        url: "https://mocked-api.example.com/get",
      },
    });

    const res = await client.get("/call-api");

    assert.strictEqual(res.status, 200);
    assert.strictEqual(typeof res.body, "object");

    const responseBody = res.body as ApiResponseDto;
    assert.strictEqual(responseBody.url, "https://mocked-api.example.com/get");
  });
});
