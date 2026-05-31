/**
 * Integration test — login round-trip + role-mapped broker credential fetch.
 * Boots the full AppModuleWithDatabase so the JWT guard + DI factories run
 * end-to-end against env-loaded secrets.
 */

import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as client from "supertest";
import { App } from "supertest/types";
import * as assert from "assert";
import { describe, test, before, after } from "node:test";
import * as bcrypt from "bcrypt";
import { JwtService } from "@nestjs/jwt";
import { AppModuleWithDatabase } from "../src/app.module";
import { startPostgres } from "./fixtures/containers";
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";

const OPERATOR_PW = "operator-test-pw";
const VIEWER_PW = "viewer-test-pw";
const OPERATOR_BROKER_PW = "broker-pw-for-operator";
const VIEWER_BROKER_PW = "broker-pw-for-viewer";
const JWT_SECRET = "test-secret-bytes-for-hs256-signing";

let app: INestApplication<App>;
let pg: { stop: () => Promise<unknown>; url: string };

before(async () => {
  process.env["AUTH_JWT_SECRET"] = JWT_SECRET;
  process.env["AUTH_OPERATOR_PWHASH"] = await bcrypt.hash(OPERATOR_PW, 4);
  process.env["AUTH_VIEWER_PWHASH"] = await bcrypt.hash(VIEWER_PW, 4);
  process.env["MQTT_OPERATOR_PASSWORD"] = OPERATOR_BROKER_PW;
  process.env["MQTT_VIEWER_PASSWORD"] = VIEWER_BROKER_PW;

  pg = await startPostgres();
  process.env["DOCUMENT_URL"] = pg.url;

  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModuleWithDatabase],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: <T = string>(_key: string, defaultValue?: T): T => defaultValue as T,
    })
    .overrideProvider(TEMPLATE_CATALOG)
    .useValue({})
    .compile();

  app = moduleFixture.createNestApplication();
  await app.init();
});

after(async () => {
  await app.close();
  await pg.stop();
});

describe("Auth", () => {
  test("operator login → mqtt-credentials returns operator broker cred", async () => {
    const login = await client(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "operator", password: OPERATOR_PW });
    assert.strictEqual(login.status, 201, JSON.stringify(login.body));
    const token = (login.body as { token: string }).token;
    assert.ok(token, "expected token in login response");

    const fetch = await client(app.getHttpServer())
      .get("/auth/mqtt-credentials")
      .set("Authorization", `Bearer ${token}`);
    assert.strictEqual(fetch.status, 200);
    assert.deepStrictEqual(fetch.body, {
      username: "arcnode_operator",
      password: OPERATOR_BROKER_PW,
      url: "",
    });
  });

  test("viewer login → mqtt-credentials returns viewer broker cred", async () => {
    const login = await client(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "viewer", password: VIEWER_PW });
    assert.strictEqual(login.status, 201);
    const token = (login.body as { token: string }).token;

    const fetch = await client(app.getHttpServer())
      .get("/auth/mqtt-credentials")
      .set("Authorization", `Bearer ${token}`);
    assert.strictEqual(fetch.status, 200);
    assert.strictEqual(
      (fetch.body as { username: string }).username,
      "arcnode_viewer",
    );
    assert.strictEqual(
      (fetch.body as { password: string }).password,
      VIEWER_BROKER_PW,
    );
  });

  test("bad password → 401", async () => {
    const login = await client(app.getHttpServer())
      .post("/auth/login")
      .send({ username: "operator", password: "wrong" });
    assert.strictEqual(login.status, 401);
  });

  test("missing bearer → 401 on mqtt-credentials", async () => {
    const fetch = await client(app.getHttpServer()).get(
      "/auth/mqtt-credentials",
    );
    assert.strictEqual(fetch.status, 401);
  });

  test("expired token → 401 on mqtt-credentials", async () => {
    const jwt = new JwtService({ secret: JWT_SECRET });
    const expired = jwt.sign(
      { sub: "operator", role: "operator" },
      { secret: JWT_SECRET, expiresIn: -1 },
    );
    const fetch = await client(app.getHttpServer())
      .get("/auth/mqtt-credentials")
      .set("Authorization", `Bearer ${expired}`);
    assert.strictEqual(fetch.status, 401);
  });
});
