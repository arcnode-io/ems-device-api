/** Integration — the LOTO contract over HTTP: set, clear, read, auth, subtree. */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import * as client from "supertest";
import type { App } from "supertest/types";
import * as assert from "assert";
import { describe, test, before, after } from "node:test";
import {
  startHivemq,
  startPostgres,
  type Container,
} from "./fixtures/containers";
import {
  JWT_SECRET,
  bearer,
  bootLotoApp,
  clearAs,
  lockAs,
  seedLotoDtm,
} from "./fixtures/loto";

interface Lock {
  id: number;
  device_id: string;
  holder_name: string;
  permit_ref: string | null;
  set_at: string;
  set_by_role: string;
  cleared_at: string | null;
  cleared_by_role: string | null;
}
interface Active {
  locks: Lock[];
  locked_devices: string[];
}

let app: INestApplication<App>;
let pg: Container;
let broker: Container;

before(async () => {
  process.env["AUTH_JWT_SECRET"] = JWT_SECRET;
  pg = await startPostgres();
  broker = await startHivemq();
  process.env["DOCUMENT_URL"] = pg.url;
  app = (await bootLotoApp(broker.url)) as INestApplication<App>;
  await seedLotoDtm(app);
});

after(async () => {
  await app.close();
  await pg.stop();
  await broker.stop();
});

/**
 * POST a lock as the operator.
 * @param deviceId Device to lock
 * @param holder holder_name
 * @returns supertest request
 */
function lock(deviceId: string, holder: string): client.Test {
  return lockAs(app, deviceId, holder);
}

/**
 * DELETE a lock as the operator.
 * @param id Lock id
 * @returns supertest request
 */
function clear(id: number): client.Test {
  return clearAs(app, id);
}

/**
 * GET /loto.
 * @returns Parsed body
 */
async function active(): Promise<Active> {
  const res = await client(app.getHttpServer()).get("/loto");
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  return res.body as Active;
}

describe("LOTO", () => {
  test("set → 201 Lock; GET /loto lists it and expands the module's racks", async () => {
    // Act
    const res = await lock("bess_001", "Tech One");

    // Assert
    assert.strictEqual(res.status, 201, JSON.stringify(res.body));
    const row = res.body as Lock;
    assert.strictEqual(row.device_id, "bess_001");
    assert.strictEqual(row.holder_name, "Tech One");
    assert.strictEqual(row.permit_ref, "WO-1");
    assert.strictEqual(row.set_by_role, "operator");
    assert.strictEqual(row.cleared_at, null);
    assert.match(row.set_at, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    const now = await active();
    assert.deepStrictEqual(
      now.locks.map((row) => row.id),
      [row.id],
    );
    assert.deepStrictEqual(now.locked_devices, [
      "bess_001",
      "rack_001",
      "rack_002",
    ]);
  });

  test("two locks, clear one → still locked; clear the other → free", async () => {
    // Arrange
    const second = (await lock("bess_001", "Tech Two")).body as Lock;
    const first = (await active()).locks.find((row) => row.id !== second.id)!;

    // Act
    const cleared = await clear(first.id);

    // Assert
    assert.strictEqual(cleared.status, 200, JSON.stringify(cleared.body));
    assert.strictEqual((cleared.body as Lock).cleared_by_role, "operator");
    assert.notStrictEqual((cleared.body as Lock).cleared_at, null);
    let now = await active();
    assert.deepStrictEqual(
      now.locks.map((row) => row.id),
      [second.id],
    );
    assert.ok(now.locked_devices.includes("rack_002"));
    await clear(second.id);
    now = await active();
    assert.deepStrictEqual(now, { locks: [], locked_devices: [] });
  });

  test("clear twice → 409; unknown id → 404", async () => {
    const row = (await lock("bess_002", "Tech Three")).body as Lock;
    await clear(row.id);
    assert.strictEqual((await clear(row.id)).status, 409);
    assert.strictEqual((await clear(999999)).status, 404);
  });

  test("duplicate active holder (case-insensitive) → 409", async () => {
    const first = (await lock("bess_002", "Tech Four")).body as Lock;
    assert.strictEqual((await lock("bess_002", "tech four ")).status, 409);
    await clear(first.id);
  });

  test("unknown device → 404; blank holder → 400", async () => {
    assert.strictEqual((await lock("nope_001", "Tech")).status, 404);
    assert.strictEqual((await lock("bess_002", "   ")).status, 400);
  });

  test("viewer → 403 on set and clear; no token → 401", async () => {
    const viewer = await client(app.getHttpServer())
      .post("/devices/bess_002/loto")
      .set("Authorization", bearer("viewer"))
      .send({ holder_name: "Viewer" });
    assert.strictEqual(viewer.status, 403);
    const anon = await client(app.getHttpServer())
      .post("/devices/bess_002/loto")
      .send({ holder_name: "Nobody" });
    assert.strictEqual(anon.status, 401);
    const viewerClear = await client(app.getHttpServer())
      .delete("/loto/1")
      .set("Authorization", bearer("viewer"));
    assert.strictEqual(viewerClear.status, 403);
  });

  test("history is every row for the device, newest first; no device_id → 400", async () => {
    const res = await client(app.getHttpServer()).get(
      "/loto/history?device_id=bess_001",
    );
    assert.strictEqual(res.status, 200);
    const rows = res.body as Lock[];
    assert.strictEqual(rows.length, 2);
    assert.ok(rows.every((row) => row.cleared_at !== null));
    assert.ok(rows[0]!.id > rows[1]!.id);
    const bad = await client(app.getHttpServer()).get("/loto/history");
    assert.strictEqual(bad.status, 400);
  });
});
