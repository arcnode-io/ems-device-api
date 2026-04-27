/** Integration test — class catalog expands AsyncAPI channels per device. */

import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as client from "supertest";
import { App } from "supertest/types";
import * as assert from "assert";
import { describe, test } from "node:test";
import { AppModuleWithDatabase } from "../src/app.module";
import { startPostgres } from "./fixtures/containers";

const DTM_WITH_BESS = {
  dtm_version: "1.0",
  deployment_uuid: "expansion-test-001",
  generated_at: "2026-04-26T00:00:00Z",
  sizing_ref: "sizing-001",
  sizing_params: {
    P_compute_total_kW: 100.0,
    E_BESS_total_kWh: 200.0,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {
    bess_001: { class: "bess_module.v1", display_name: "BESS-001" },
  },
  buses: [{ id: "dc_bus", type: "dc", members: [{ device_id: "bess_001" }] }],
};

interface AsyncApiSpec {
  channels: Record<string, { address: string }>;
}

describe("AsyncAPI class expansion", () => {
  test("device with class bess_module.v1 expands to channels per measurement + command", async () => {
    const password = process.env.POSTGRES_PASSWORD;
    if (!password) throw new Error("POSTGRES_PASSWORD not set");
    const pg = await startPostgres(password);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModuleWithDatabase],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: <T = string>(key: string, defaultValue?: T): T => {
          if (key === "postgresPort") return pg.port as T;
          return defaultValue as T;
        },
      })
      .compile();

    const app: INestApplication<App> = moduleFixture.createNestApplication();
    await app.init();

    try {
      // Arrange — submit a DTM whose device has a known class
      const post = await client(app.getHttpServer())
        .post("/topology")
        .send(DTM_WITH_BESS);
      assert.strictEqual(post.status, 201);

      // Act
      const res = await client(app.getHttpServer()).get("/asyncapi");
      assert.strictEqual(res.status, 200);
      const spec = res.body as AsyncApiSpec;
      const addresses = Object.values(spec.channels).map((ch) => ch.address);

      // Assert — bess_module.v1 has voltage_dc + alarm_state measurements,
      // set_active_power + reset_alarm commands. Each becomes a channel.
      assert.ok(
        addresses.some((addr) =>
          addr.includes("/devices/bess_001/measurements/voltage_dc/volts"),
        ),
        `missing voltage_dc channel; got: ${addresses.join(", ")}`,
      );
      assert.ok(
        addresses.some((addr) =>
          addr.includes("/devices/bess_001/measurements/alarm_state/none"),
        ),
        `missing alarm_state channel; got: ${addresses.join(", ")}`,
      );
      assert.ok(
        addresses.some((addr) =>
          addr.includes("/devices/bess_001/commands/set/active_power/watts"),
        ),
        `missing set_active_power channel; got: ${addresses.join(", ")}`,
      );
      assert.ok(
        addresses.some((addr) =>
          addr.includes("/devices/bess_001/commands/reset/alarm/none"),
        ),
        `missing reset_alarm channel; got: ${addresses.join(", ")}`,
      );
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
