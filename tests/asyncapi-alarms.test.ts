/**
 * Integration test — DTM with populated alarm catalogs (real edp-api emit
 * against pilot equipment_specs) round-trips into AsyncAPI x-alarms.
 *
 * Fixture sourced from /tmp by power-engineer via real edp-api collect_templates_used
 * against ~/arcnode/edp-module-assemblies/equipment/{GRD-SWG-001,EXT-BESS-002,CMP-CDU-001}.
 * Catches cross-repo schema drift between edp-api Pydantic emit and device-api Zod parse.
 */

import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as fs from "node:fs";
import * as path from "node:path";
import * as client from "supertest";
import { App } from "supertest/types";
import * as assert from "assert";
import { describe, test } from "node:test";
import { AppModuleWithDatabase } from "../src/app.module";
import { startPostgres } from "./fixtures/containers";
import { TEMPLATE_CATALOG } from "../src/templates/templates.module";
import type { DeviceTemplateType } from "../src/templates/template.schema";
import type { AlarmType } from "../src/templates/template.alarms.schema";

const FIXTURE = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "fixtures", "dtm_with_pilot_alarms.json"),
    "utf-8",
  ),
) as {
  templates_used: Record<string, DeviceTemplateType>;
};

const TEST_CATALOG: Record<string, DeviceTemplateType> = FIXTURE.templates_used;

interface AsyncApiSpec {
  "x-alarms"?: Record<string, readonly AlarmType[]>;
}

/**
 * Assert every expected alarm id is present in the device's alarm catalog.
 * Collapsed helper so the test body stays under the max-statements lint cap.
 * @param alarms Alarm catalog under a single x-alarms[device_id] key
 * @param expectedIds Alarm ids that must all be present
 */
function expectAlarmIds(
  alarms: readonly AlarmType[] | undefined,
  expectedIds: readonly string[],
): void {
  const ids = new Set((alarms ?? []).map((alarm) => alarm.id));
  for (const expected of expectedIds) {
    assert.ok(ids.has(expected), `missing alarm id: ${expected}`);
  }
}

describe("AsyncAPI x-alarms (pilot DTM round-trip)", () => {
  test("DTM with populated alarms surfaces under x-alarms keyed by device_id", async () => {
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
      .useValue(TEST_CATALOG)
      .compile();

    const app: INestApplication<App> = moduleFixture.createNestApplication();
    await app.init();

    try {
      const post = await client(app.getHttpServer())
        .post("/topology")
        .send(FIXTURE);
      assert.strictEqual(post.status, 201, JSON.stringify(post.body));

      const res = await client(app.getHttpServer()).get("/asyncapi");
      assert.strictEqual(res.status, 200);
      const spec = res.body as AsyncApiSpec;

      const xAlarms = spec["x-alarms"];
      assert.ok(xAlarms, "x-alarms missing from AsyncAPI spec");

      // Each pilot SKU has exactly 4 alarms in its spec.yaml
      assert.strictEqual(
        xAlarms["switchgear_1"]?.length,
        4,
        "switchgear_1 alarm count",
      );
      assert.strictEqual(
        xAlarms["bess_rack_1"]?.length,
        4,
        "bess_rack_1 alarm count",
      );
      assert.strictEqual(xAlarms["cdu_1"]?.length, 4, "cdu_1 alarm count");

      // Strong assertion on alarm IDs — catches drift in field naming or omission
      expectAlarmIds(xAlarms["switchgear_1"], [
        "arc_flash_detected",
        "breaker_failure_50bf",
        "protective_overcurrent_trip",
        "breaker_close_coil_failure",
      ]);
      expectAlarmIds(xAlarms["bess_rack_1"], [
        "pack_overtemperature",
        "cell_voltage_imbalance",
      ]);
      expectAlarmIds(xAlarms["cdu_1"], [
        "secondary_loop_leak",
        "pump_failure_primary",
      ]);

      // condition_source variants come through correctly (P1 SKU sanity check)
      const arcFlash = xAlarms["switchgear_1"].find(
        (alarm) => alarm.id === "arc_flash_detected",
      )!;
      assert.strictEqual(arcFlash.priority, "P1");
      assert.strictEqual(arcFlash.condition_source.type, "discrete_register");

      const cduLeak = xAlarms["cdu_1"].find(
        (alarm) => alarm.id === "secondary_loop_leak",
      )!;
      assert.strictEqual(cduLeak.condition_source.type, "redfish_event");
    } finally {
      await app.close();
      await pg.stop();
    }
  });
});
