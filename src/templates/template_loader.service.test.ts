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
 * Writes a known-good revenue_meter leaf YAML into `dir` for use in tests.
 * @param dir Absolute path to the directory where the file should be written
 */
function _writeRevenueMeter(dir: string): void {
  writeFileSync(
    join(dir, "revenue_meter.yaml"),
    [
      "template: revenue_meter",
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

  it("one well-formed revenue_meter.yaml → catalog has it", () => {
    // Arrange
    mkdirSync(join(root, "leaf"));
    mkdirSync(join(root, "module"));
    _writeRevenueMeter(join(root, "leaf"));

    // Act
    const catalog = service.loadCatalog(root);

    // Assert
    assert.ok("revenue_meter" in catalog);
    assert.equal(catalog["revenue_meter"].equipment_id, "GRD-MTR-001");
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

  it("schema validation failure (no measurements/commands) → TemplateLoadError matching 'validation'", () => {
    // Arrange
    mkdirSync(join(root, "leaf"));
    mkdirSync(join(root, "module"));
    writeFileSync(
      join(root, "leaf", "bad.yaml"),
      [
        "template: empty_tpl",
        "kind: leaf",
        "equipment_id: GRD-MTR-001",
        "vendor: Test",
        "model: T-1",
        "description: empty",
      ].join("\n"),
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
      join(root, "leaf", "revenue_meter_dup.yaml"),
      [
        "template: revenue_meter",
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
        "    publisher: line_controller",
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
