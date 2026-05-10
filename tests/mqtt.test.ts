/** Integration — TopologyService.save broadcasts via emqx. */

import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { connect, type MqttClient } from "mqtt";
import * as assert from "assert";
import { describe, test } from "node:test";
import { AppModuleWithDatabase } from "../src/app.module";
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import { TopologyService } from "../src/topology/topology.service";
import type { DeviceTemplateType } from "../src/templates/template.schema";
import { startEmqx, startPostgres } from "./fixtures/containers";

const TEMPLATE_BESS = {
  template: "bess_module_v1",
  kind: "module" as const,
  description: "BESS aggregate.",
  contains: [],
  measurements: {
    voltage_dc: {
      unit: "volts",
      type: "float" as const,
      publisher: "line_controller" as const,
    },
  },
  commands: {},
};

const STUB_CATALOG: Record<string, DeviceTemplateType> = {
  bess_module_v1: TEMPLATE_BESS as unknown as DeviceTemplateType,
};

const SAMPLE_DTM = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174099",
  ems_mode: "sim",
  sizing_ref: null,
  sizing_params: {
    P_compute_total_kW: 100,
    E_BESS_total_kWh: 200,
    T_coolant_setpoint_C: 18,
  },
  devices: {
    bess_001: {
      device_id: "bess_001",
      template: "bess_module_v1",
      parent: null,
      display_name: null,
      connection: { host: "10.0.0.1", port: 502, unit_id: null },
      blocking: ["live_mode"],
      extra_measurements: null,
    },
  },
  buses: [],
  templates_used: { bess_module_v1: TEMPLATE_BESS },
};

interface BootstrapOpts {
  dbHost: string;
  dbPort: number;
  brokerUrl: string;
}

/**
 * Build the Nest app with overridden Config + catalog so the broker URL
 * points at the testcontainer.
 * @param opts dbHost / dbPort / brokerUrl from running testcontainers
 * @returns The initialized Nest app + TopologyService instance
 */
async function bootstrap(opts: BootstrapOpts): Promise<{
  app: import("@nestjs/common").INestApplication;
  service: TopologyService;
}> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModuleWithDatabase],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: <T>(key: string): T | undefined => {
        if (key === "postgresHost") return opts.dbHost as unknown as T;
        if (key === "postgresPort") return opts.dbPort as unknown as T;
        if (key === "mqttBrokerUrl") return opts.brokerUrl as unknown as T;
        return undefined;
      },
    })
    .overrideProvider(TEMPLATE_CATALOG)
    .useValue(STUB_CATALOG)
    .compile();

  const app = await moduleRef.createNestApplication().init();
  const service = app.get(TopologyService);
  return { app, service };
}

/**
 * Tagged log line for testcontainer scaffolding visibility.
 * @param tag short tag like "🐳 emqx" / "🐘 pg" / "📡 sub"
 * @param msg what just happened
 */
function log(tag: string, msg: string): void {
  console.log(`[${new Date().toISOString()}] ${tag} ${msg}`);
}

describe("MQTT topology_changed broadcast integration", () => {
  test("save → emqx broadcasts system/topology_changed { ts, version }", async () => {
    // Arrange — emqx + postgres testcontainers (dynamic ports)
    const broker = await startEmqx();
    const pg = await startPostgres("test", { dbname: "postgres" });
    log("🐳", `emqx @ ${broker.url} | 🐘 postgres @ ${pg.host}:${pg.port}`);

    process.env["POSTGRES_PASSWORD"] = "test";
    process.env["POSTGRES_PORT"] = String(pg.port);

    const { app, service } = await bootstrap({
      dbHost: pg.host,
      dbPort: pg.port,
      brokerUrl: broker.url,
    });

    let subscriber: MqttClient | undefined;
    try {
      // Subscribe with a separate client to verify the broadcast reaches the broker
      subscriber = connect(broker.url);
      const messages: string[] = [];
      await new Promise<void>((res, rej) => {
        subscriber!.on("connect", () => {
          subscriber!.subscribe("system/topology_changed", (err) =>
            err ? rej(err) : res(),
          );
        });
      });
      subscriber.on("message", (topic, payload) => {
        log("📨", `${topic}: ${payload.toString()}`);
        messages.push(payload.toString());
      });

      // Let the device-api MQTT client finish its async connect before publishing
      await new Promise((r) => setTimeout(r, 1000));

      // Act
      await service.save(SAMPLE_DTM as never);

      // Wait for publish round-trip
      await new Promise((r) => setTimeout(r, 1000));

      // Assert
      assert.equal(
        messages.length,
        1,
        `expected 1 message, got ${messages.length}`,
      );
      const parsed = JSON.parse(messages[0]!) as {
        ts: string;
        version: string;
      };
      assert.equal(parsed.version, "1.0.0");
      assert.match(parsed.ts, /^\d{4}-\d{2}-\d{2}T/);
    } finally {
      if (subscriber !== undefined) {
        await subscriber.endAsync();
      }
      await app.close();
      await pg.stop();
      await broker.stop();
    }
  });
});
