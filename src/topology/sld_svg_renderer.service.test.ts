/** Unit tests for SldSvgRendererService — covers happy path + failure mapping. */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it, mock, before, after } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import axios from "axios";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { SldSvgRendererService } from "./sld_svg_renderer.service";
import type { DtmType } from "./dtm.schema";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;

before(() => {
  // Reason: loadConfig() reads cfg.yml from cwd; isolate so we don't depend on
  // the repo's real cfg.yml (which lives in the device-api root, not src/).
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "sld-renderer-test-"));
  fs.writeFileSync(
    path.join(tempDir, "cfg.yml"),
    [
      "local:",
      "  logLevel: DEBUG",
      "  port: 3000",
      "  host: 127.0.0.1",
      "  e2e: false",
      "  templateCatalogRoot: device_templates",
      "  mqttBrokerUrl: mqtt://localhost:1883",
      "  edpApiUrl: http://edp-api.test:8000",
      "beta:",
      "  logLevel: INFO",
      "  port: 3000",
      "  host: 0.0.0.0",
      "  e2e: true",
      "  templateCatalogRoot: /app/device_templates",
      "  mqttBrokerUrl: mqtt://hivemq:1883",
      "  edpApiUrl: http://edp-api:8000",
      "",
    ].join("\n"),
  );
  process.chdir(tempDir);
});

after(() => {
  process.chdir(ORIGINAL_CWD);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const minimalDtm: DtmType = {} as DtmType;

describe("SldSvgRendererService.render", () => {
  it("posts the DTM to edp-api and returns the SVG bytes", async () => {
    // Arrange
    const expected = Buffer.from('<?xml version="1.0"?><svg/>');
    const postMock = mock.method(axios, "post", () =>
      Promise.resolve({
        data: expected.buffer.slice(
          expected.byteOffset,
          expected.byteOffset + expected.byteLength,
        ),
      }),
    );
    const svc = new SldSvgRendererService();

    // Act
    const got = await svc.render(minimalDtm);

    // Assert
    assert.equal(got.toString("utf8"), expected.toString("utf8"));
    assert.equal(postMock.mock.callCount(), 1);
    const [url] = postMock.mock.calls[0]!.arguments as [string];
    assert.equal(url, "http://edp-api.test:8000/edp-api/sld-hmi-svg");
    postMock.mock.restore();
  });

  it("maps axios failure to ServiceUnavailableException", async () => {
    // Arrange — axios.post rejects (edp-api down or non-2xx)
    const postMock = mock.method(axios, "post", () =>
      Promise.reject(new Error("ECONNREFUSED")),
    );
    const svc = new SldSvgRendererService();

    // Act / Assert
    await assert.rejects(
      () => svc.render(minimalDtm),
      (err: unknown) => {
        assert.ok(err instanceof ServiceUnavailableException);
        assert.match((err as Error).message, /ECONNREFUSED/);
        return true;
      },
    );
    postMock.mock.restore();
  });
});
