/**
 * Unit tests for TemplateLoaderService — mirrors edp-api test_template_loader.py.
 */

import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  TemplateLoaderService,
  TemplateLoadError,
} from "./template_loader.service";

/**
 * Writes a known-good poi_meter leaf YAML into `dir` for use in tests.
 * @param dir Absolute path to the directory where the file should be written
 */
function _writeRevenueMeter(dir: string): void {
  writeFileSync(
    join(dir, "poi_meter.yaml"),
    [
      "template: poi_meter",
      "kind: leaf",
      "equipment_id: GRD-MTR-001",
      "vendor: Schneider Electric",
      "model: ION9000",
      "description: test",
      "measurements:",
      "  voltage_a:",
      "    unit: volts",
      "    type: float",
      "    iec_61850_ref: MMXU.PhV.phsA",
      "    bounds: { min: 0, max: 500, nominal: 277 }",
      "    thresholds:",
      "      warn_min: 250",
      "      warn_max: 300",
      "      alarm_min: 230",
      "      alarm_max: 320",
      "    binding:",
      "      protocol: modbus_tcp",
      "      function_code: 4",
      "      address: 100",
    ].join("\n"),
  );
}

describe("TemplateLoaderService", () => {
  let root: string;
  let service: TemplateLoaderService;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "tpl-test-"));
    service = new TemplateLoaderService();
  });

  afterEach(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  });

  it("empty leaf+module dirs → empty catalog", () => {
    // Arrange
    mkdirSync(join(root, "leaf"));
    mkdirSync(join(root, "module"));

    // Act
    const catalog = service.loadCatalog(root);

    // Assert
    assert.deepEqual(catalog, {});
  });

  it("one well-formed poi_meter.yaml → catalog has it", () => {
    // Arrange
    mkdirSync(join(root, "leaf"));
    mkdirSync(join(root, "module"));
    _writeRevenueMeter(join(root, "leaf"));

    // Act
    const catalog = service.loadCatalog(root);

    // Assert
    assert.ok("poi_meter" in catalog);
    assert.equal(catalog["poi_meter"].equipment_id, "GRD-MTR-001");
  });

  it("invalid YAML → TemplateLoadError matching 'invalid YAML'", () => {
    // Arrange
    mkdirSync(join(root, "leaf"));
    mkdirSync(join(root, "module"));
    writeFileSync(join(root, "leaf", "broken.yaml"), "template: : :\n");

    // Act / Assert
    assert.throws(
      () => service.loadCatalog(root),
      (err: unknown) => {
        assert.ok(err instanceof TemplateLoadError);
        assert.match(err.message, /invalid YAML/);
        return true;
      },
    );
  });

  it("schema validation failure (module with no measurements/commands) → TemplateLoadError matching 'validation'", () => {
    // Arrange — a module, not a leaf: a leaf may legitimately be passive (drawn
    // on the SLD, never polled), but a module exists only to roll up or
    // distribute across children.
    mkdirSync(join(root, "leaf"));
    mkdirSync(join(root, "module"));
    writeFileSync(
      join(root, "module", "bad.yaml"),
      ["template: empty_tpl", "kind: module", "description: empty"].join("\n"),
    );

    // Act / Assert
    assert.throws(
      () => service.loadCatalog(root),
      (err: unknown) => {
        assert.ok(err instanceof TemplateLoadError);
        assert.match(err.message, /validation/);
        return true;
      },
    );
  });

  it("duplicate slug → TemplateLoadError matching 'duplicate'", () => {
    // Arrange
    mkdirSync(join(root, "leaf"));
    mkdirSync(join(root, "module"));
    _writeRevenueMeter(join(root, "leaf"));
    writeFileSync(
      join(root, "leaf", "poi_meter_dup.yaml"),
      [
        "template: poi_meter",
        "kind: leaf",
        "equipment_id: GRD-MTR-001",
        "vendor: Schneider Electric",
        "model: ION9000",
        "description: dup",
        "measurements:",
        "  v:",
        "    unit: volts",
        "    type: float",
        "    iec_61850_ref: MMXU.PhV.phsA",
        "    bounds: { min: 0, max: 500, nominal: 277 }",
        "    thresholds: { warn_min: 250, warn_max: 300, alarm_min: 230, alarm_max: 320 }",
        "    binding: { protocol: modbus_tcp, function_code: 4, address: 100 }",
      ].join("\n"),
    );

    // Act / Assert
    assert.throws(
      () => service.loadCatalog(root),
      (err: unknown) => {
        assert.ok(err instanceof TemplateLoadError);
        assert.match(err.message, /duplicate/);
        return true;
      },
    );
  });

  it("unresolved contains ref → TemplateLoadError matching 'not in catalog'", () => {
    // Arrange
    mkdirSync(join(root, "leaf"));
    mkdirSync(join(root, "module"));
    _writeRevenueMeter(join(root, "leaf"));
    writeFileSync(
      join(root, "module", "broken_module.yaml"),
      [
        "template: broken_module",
        "kind: module",
        "description: refs a leaf that does not exist",
        "contains:",
        "  - template: nonexistent_leaf",
        "    qty: 1",
        "measurements:",
        "  rollup:",
        "    unit: watts",
        "    type: float",
        "    iec_61850_ref: MMXU.W",
        "    bounds: { min: -1000000, max: 1000000, nominal: 0 }",
        "    thresholds: { warn_min: -800000, warn_max: 800000, alarm_min: -950000, alarm_max: 950000 }",
        "    publisher: local_process",
      ].join("\n"),
    );

    // Act / Assert
    assert.throws(
      () => service.loadCatalog(root),
      (err: unknown) => {
        assert.ok(err instanceof TemplateLoadError);
        assert.match(err.message, /not in catalog/);
        return true;
      },
    );
  });
});

describe("TemplateLoaderService against the real catalog", () => {
  // Regression guard: nothing in the app boot path actually exercises this
  // loader against the real device_templates/ (the check job clones edp-api's
  // current main there — see .gitlab-ci.yml — but every AppModuleWithDatabase
  // test overrides TEMPLATE_CATALOG with a stub, and AppModule, which
  // app.test.ts boots unstubbed, doesn't import TemplatesModule at all). A real
  // edp-api template change can silently 400/500 in a deployed device-api until
  // someone hits it by hand. This test is the fix: run the loader for real, in
  // CI, on every push.
  it("loads every template in device_templates/, and finds some", () => {
    // Arrange / Act — no doesNotThrow wrapper: a TemplateLoadError names the
    // offending file and field, and that message is the whole diagnostic.
    const service = new TemplateLoaderService();
    const catalog = service.loadCatalog("device_templates");

    // Assert — non-empty is the point. loadCatalog skips a missing leaf/module
    // dir and returns {}, so "didn't throw" also passes when it validated
    // nothing, which is how a catalog this test never read looked green.
    assert.ok(
      Object.keys(catalog).length > 0,
      "device_templates/ resolved to no templates — the catalog the check job " +
        "clones from edp-api is missing, so this test validated nothing",
    );
  });
});
