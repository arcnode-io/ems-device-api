import { describe, it, mock } from "node:test";
import { strict as assert } from "node:assert";
import { S3Client, GetObjectCommand, NoSuchKey } from "@aws-sdk/client-s3";
import { Readable } from "node:stream";
import { BadRequestException, Logger } from "@nestjs/common";
import type { INestApplicationContext } from "@nestjs/common";
import { seedFromS3 } from "./seed_from_s3";
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

// cast to unknown first to sidestep TypeScript's strict mock-return-type checks
/**
 * Wrap a service stub in a minimal INestApplicationContext.
 * @param service Partial service stub to return from app.get()
 * @returns Minimal app context
 */
function makeApp(service: unknown): INestApplicationContext {
  return { get: () => service } as unknown as INestApplicationContext;
}

/**
 * Build a minimal S3Client whose send() delegates to a handler.
 * @param handler Synchronous handler called with the S3 command
 * @returns Minimal S3Client stub
 */
function makeS3Client(handler: (cmd: GetObjectCommand) => unknown): S3Client {
  return {
    send: (cmd: GetObjectCommand) => Promise.resolve(handler(cmd)),
  } as unknown as S3Client;
}

/**
 * Wrap a string in a Readable stream for use as a mock S3 Body.
 * @param text UTF-8 string to stream
 * @returns Readable emitting the string as a single Buffer chunk
 */
function bodyStream(text: string): Readable {
  return Readable.from([Buffer.from(text, "utf8")]);
}

describe("seedFromS3", () => {
  it("url null → skip with info log", async () => {
    const service = { getLatest: mock.fn(), save: mock.fn() };
    const app = makeApp(service);
    const logger = makeLogger();
    const infoSpy = mock.method(logger, "log");
    await seedFromS3(app, null, null, logger);
    assert.equal(service.getLatest.mock.callCount(), 0);
    assert.equal(service.save.mock.callCount(), 0);
    assert.ok(
      infoSpy.mock.calls.some((call) =>
        String(call.arguments[0]).includes("no boot_dtm_s3_url"),
      ),
    );
  });

  it("malformed url → throws", async () => {
    const app = makeApp({});
    await assert.rejects(
      () => seedFromS3(app, "not-a-url", null, makeLogger()),
      /s3:\/\/ url required/,
    );
  });

  it("S3 NotFound → throws", async () => {
    const s3 = makeS3Client(() => {
      throw new NoSuchKey({ message: "not found", $metadata: {} });
    });
    const app = makeApp({});
    await assert.rejects(
      () => seedFromS3(app, "s3://bucket/key.json", null, makeLogger(), s3),
      /not found/i,
    );
  });

  it("body invalid JSON → throws", async () => {
    const s3 = makeS3Client(() => ({ Body: bodyStream("{not json") }));
    const app = makeApp({});
    await assert.rejects(
      () => seedFromS3(app, "s3://bucket/key.json", null, makeLogger(), s3),
      SyntaxError,
    );
  });

  it("body fails Zod → throws", async () => {
    const s3 = makeS3Client(() => ({ Body: bodyStream('{"foo":"bar"}') }));
    const app = makeApp({});
    await assert.rejects(
      () => seedFromS3(app, "s3://bucket/key.json", null, makeLogger(), s3),
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
              binding: { protocol: "modbus_tcp", function_code: 4, address: 1 },
            },
          },
          commands: {},
          contains: [],
        },
      },
    };
    const s3 = makeS3Client(() => ({
      Body: bodyStream(JSON.stringify(dtmWithUnknownSlug)),
    }));
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
      () => seedFromS3(app, "s3://bucket/key.json", null, makeLogger(), s3),
      /not in bundled catalog/,
    );
    assert.equal(service.save.mock.callCount(), 0);
  });

  it("table empty → service.save called", async () => {
    const s3 = makeS3Client(() => ({
      Body: bodyStream(JSON.stringify(STUB_DTM)),
    }));
    const service = {
      validateAgainstCatalog: mock.fn(),
      getLatest: mock.fn(() => Promise.resolve(null)),
      save: mock.fn(() => Promise.resolve({ id: 1 })),
    };
    const app = makeApp(service);
    await seedFromS3(app, "s3://bucket/key.json", null, makeLogger(), s3);
    assert.equal(service.save.mock.callCount(), 1);
    assert.equal(service.validateAgainstCatalog.mock.callCount(), 1);
  });

  it("table populated → service.save NOT called", async () => {
    const s3 = makeS3Client(() => ({
      Body: bodyStream(JSON.stringify(STUB_DTM)),
    }));
    const service = {
      validateAgainstCatalog: mock.fn(),
      getLatest: mock.fn(() => Promise.resolve(STUB_DTM as unknown as DtmType)),
      save: mock.fn(),
    };
    const app = makeApp(service);
    await seedFromS3(app, "s3://bucket/key.json", null, makeLogger(), s3);
    assert.equal(service.save.mock.callCount(), 0);
  });
});
