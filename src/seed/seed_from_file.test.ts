import { describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { BadRequestException, Logger } from "@nestjs/common";
import type { INestApplicationContext } from "@nestjs/common";
import { seedFromFile } from "./seed_from_file";
import type { DtmType } from "../topology/dtm.schema";

const STUB_DTM = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
  sizing_params: {
    P_compute_total_kW: 100.0,
    E_BESS_total_kWh: 200.0,
    T_coolant_setpoint_C: 18.0,
  },
  devices: {},
  buses: [],
  templates_used: {},
};

/**
 * Build a minimal NestJS logger for the "test" context.
 * @returns Logger instance scoped to "test"
 */
function makeLogger(): Logger {
  return new Logger("test");
}

/**
 * Wrap a service stub in a minimal INestApplicationContext.
 * @param service Partial service stub to return from app.get()
 * @returns Minimal app context
 */
function makeApp(service: unknown): INestApplicationContext {
  return { get: () => service } as unknown as INestApplicationContext;
}

/**
 * Write the given body to a fresh temp dtm.json and return its path.
 * @param body UTF-8 string body to write
 * @returns Absolute path to the temp file
 */
async function writeTemp(body: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dtm-"));
  const file = path.join(dir, "dtm.json");
  await fs.writeFile(file, body, "utf8");
  return file;
}

describe("seedFromFile", () => {
  it("path null → skip with info log", async () => {
    const service = { getLatest: mock.fn(), save: mock.fn() };
    const app = makeApp(service);
    const logger = makeLogger();
    const infoSpy = mock.method(logger, "log");
    await seedFromFile(app, null, logger);
    assert.equal(service.getLatest.mock.callCount(), 0);
    assert.equal(service.save.mock.callCount(), 0);
    assert.ok(
      infoSpy.mock.calls.some((call) =>
        String(call.arguments[0]).includes("no boot_dtm_path"),
      ),
    );
  });

  it("missing file → throws", async () => {
    const app = makeApp({});
    await assert.rejects(
      () => seedFromFile(app, "/nonexistent/path/dtm.json", makeLogger()),
      /ENOENT/,
    );
  });

  it("body invalid JSON → throws", async () => {
    const file = await writeTemp("{not json");
    const app = makeApp({});
    await assert.rejects(
      () => seedFromFile(app, file, makeLogger()),
      SyntaxError,
    );
  });

  it("body fails Zod → throws", async () => {
    const file = await writeTemp('{"foo":"bar"}');
    const app = makeApp({});
    await assert.rejects(
      () => seedFromFile(app, file, makeLogger()),
      /deployment_uuid/,
    );
  });

  it("catalog rejects slug → throws", async () => {
    const dtmWithUnknownSlug = {
      ...STUB_DTM,
      devices: {
        rev_1: {
          device_id: "rev_1",
          template: "ghost",
          parent: null,
          connection: { host: "h", port: 1, unit_id: null },
          blocking: ["live_mode"],
          extra_measurements: null,
        },
      },
      templates_used: {
        ghost: {
          template: "ghost",
          kind: "leaf",
          equipment_id: "X-1",
          vendor: "v",
          model: "m",
          description: "x",
          measurements: {
            volt: {
              unit: "volts",
              type: "float",
              iec_61850_ref: "MMXU.PhV.phsA",
              bounds: { min: 0, max: 500, nominal: 277 },
              thresholds: {
                warn_min: 250,
                warn_max: 300,
                alarm_min: 230,
                alarm_max: 320,
              },
              binding: { protocol: "modbus_tcp", function_code: 4, address: 1 },
            },
          },
          commands: {},
          contains: [],
        },
      },
    };
    const file = await writeTemp(JSON.stringify(dtmWithUnknownSlug));
    const service = {
      validateAgainstCatalog: (): never => {
        throw new BadRequestException(
          "templates_used contains slug(s) not in bundled catalog: ghost",
        );
      },
      getLatest: mock.fn(),
      save: mock.fn(),
    };
    const app = makeApp(service);
    await assert.rejects(
      () => seedFromFile(app, file, makeLogger()),
      /not in bundled catalog/,
    );
    assert.equal(service.save.mock.callCount(), 0);
  });

  it("table empty → service.save called", async () => {
    const file = await writeTemp(JSON.stringify(STUB_DTM));
    const service = {
      validateAgainstCatalog: mock.fn(),
      getLatest: mock.fn(() => Promise.resolve(null)),
      save: mock.fn(() => Promise.resolve({ id: 1 })),
    };
    const app = makeApp(service);
    await seedFromFile(app, file, makeLogger());
    assert.equal(service.save.mock.callCount(), 1);
    assert.equal(service.validateAgainstCatalog.mock.callCount(), 1);
  });

  it("table populated → service.save NOT called", async () => {
    const file = await writeTemp(JSON.stringify(STUB_DTM));
    const service = {
      validateAgainstCatalog: mock.fn(),
      getLatest: mock.fn(() => Promise.resolve(STUB_DTM as unknown as DtmType)),
      save: mock.fn(),
    };
    const app = makeApp(service);
    await seedFromFile(app, file, makeLogger());
    assert.equal(service.save.mock.callCount(), 0);
  });
});
