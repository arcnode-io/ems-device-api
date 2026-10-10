/** Integration — system/loto_changed beacons, and locks outliving a restart. */

import "reflect-metadata";
import type { INestApplication } from "@nestjs/common";
import { connect, type MqttClient } from "mqtt";
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
  LOTO_DTM,
  bootLotoApp,
  clearAs,
  lockAs,
  seedLotoDtm,
  settle,
} from "./fixtures/loto";

interface Active {
  locks: { id: number }[];
  locked_devices: string[];
}

let app: INestApplication<App>;
let pg: Container;
let broker: Container;
let sub: MqttClient;
const seen: string[] = [];

/**
 * Subscribe a bare client to the beacon topic, collecting payloads into `seen`.
 * @param url Broker URL
 * @returns The subscribed client
 */
async function listen(url: string): Promise<MqttClient> {
  const mqtt = connect(url);
  await new Promise<void>((res, rej) => {
    mqtt.on("connect", () => {
      mqtt.subscribe("system/loto_changed", (err) => (err ? rej(err) : res()));
    });
  });
  mqtt.on("message", (_topic, payload) => seen.push(payload.toString()));
  return mqtt;
}

// Reason: the subscriber goes up before the app so the boot beacon is observable.
before(async () => {
  process.env["AUTH_JWT_SECRET"] = JWT_SECRET;
  pg = await startPostgres();
  broker = await startHivemq();
  process.env["DOCUMENT_URL"] = pg.url;
  sub = await listen(broker.url);
  app = (await bootLotoApp(broker.url)) as INestApplication<App>;
  await seedLotoDtm(app);
  await settle();
});

after(async () => {
  await app.close();
  await sub.endAsync();
  await pg.stop();
  await broker.stop();
});

describe("LOTO beacon + persistence", () => {
  test("a beacon on broker connect, after a set, after a clear", async () => {
    // Arrange
    const atBoot = seen.length;
    assert.ok(atBoot >= 1, "expected a beacon on broker connect");
    const first = JSON.parse(seen[0]!) as { ts: string };
    assert.match(first.ts, /^\d{4}-\d{2}-\d{2}T.*Z$/);

    // Act — set
    const set = (await lockAs(app, "bess_002", "Tech Five")).body as {
      id: number;
    };
    await settle();

    // Assert
    assert.strictEqual(seen.length, atBoot + 1, "beacon after set");

    // Act — clear
    await clearAs(app, set.id);
    await settle();

    // Assert
    assert.strictEqual(seen.length, atBoot + 2, "beacon after clear");
  });

  test("a restart keeps the lock and beacons again", async () => {
    // Arrange
    const kept = (await lockAs(app, "bess_001", "Tech Six")).body as {
      id: number;
    };
    await settle();
    const beforeRestart = seen.length;

    // Act — restart against the same database
    await app.close();
    app = (await bootLotoApp(broker.url)) as INestApplication<App>;
    await settle();

    // Assert
    const res = await client(app.getHttpServer()).get("/loto");
    const body = res.body as Active;
    assert.deepStrictEqual(
      body.locks.map((row) => row.id),
      [kept.id],
    );
    assert.deepStrictEqual(body.locked_devices, [
      "bess_001",
      "rack_001",
      "rack_002",
    ]);
    assert.strictEqual(seen.length, beforeRestart + 1, "beacon after restart");
  });

  test("a DTM re-POST beacons, and a rack added under a locked module is locked", async () => {
    // Arrange — bess_001 is still held by Tech Six from the test above
    const beforeSave = seen.length;
    const grown = {
      ...LOTO_DTM,
      devices: {
        ...LOTO_DTM.devices,
        rack_003: {
          device_id: "rack_003",
          template: "bess_rack_v1",
          parent: "bess_001",
        },
      },
    };

    // Act
    await seedLotoDtm(app, grown);
    await settle();

    // Assert
    assert.strictEqual(seen.length, beforeSave + 1, "beacon after DTM save");
    const res = await client(app.getHttpServer()).get("/loto");
    assert.deepStrictEqual((res.body as Active).locked_devices, [
      "bess_001",
      "rack_001",
      "rack_002",
      "rack_003",
    ]);
  });
});
