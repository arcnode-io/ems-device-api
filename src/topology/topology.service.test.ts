/**
 * Unit tests for TopologyService.validateAgainstCatalog.
 * The repo is unused by this method; pass an empty object stub.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { TopologyService } from "./topology.service";
import type { DeviceType, DtmType } from "./dtm.schema";
import type { DeviceTemplateType } from "../templates/template.schema";
import type { Repository } from "typeorm";
import type { Topology } from "./topology.entity";

/** Stub — validateAgainstCatalog never touches the repo. */
const stubRepo = {} as Repository<Topology>;

/**
 * Minimal DtmType fixture — only templates_used matters for catalog validation.
 * @param templateSlugs List of template slug strings to populate in templates_used
 * @returns Partial DtmType cast — safe for validateAgainstCatalog which only reads templates_used
 */
function makeDtm(templateSlugs: string[]): DtmType {
  const templates_used: Record<string, DeviceTemplateType> = {};
  for (const slug of templateSlugs) {
    // Reason: we only need the record key present; DeviceTemplateType is unused by validateAgainstCatalog
    templates_used[slug] = {} as DeviceTemplateType;
  }
  return {
    deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
    ems_mode: "sim",
    sizing_params: {
      P_compute_total_kW: 100,
      E_BESS_total_kWh: 200,
      T_coolant_setpoint_C: 18,
    },
    devices: {},
    buses: [],
    templates_used,
  } as unknown as DtmType;
}

describe("TopologyService.validateAgainstCatalog", () => {
  it("passes when every slug in templates_used is in the catalog", () => {
    // Arrange
    const catalog: Record<string, DeviceTemplateType> = {
      revenue_meter: {} as DeviceTemplateType,
      bess_module_v1: {} as DeviceTemplateType,
    };
    const svc = new TopologyService(stubRepo, catalog);
    const dtm = makeDtm(["revenue_meter", "bess_module_v1"]);

    // Act / Assert — must not throw
    assert.doesNotThrow(() => svc.validateAgainstCatalog(dtm));
  });

  it("throws BadRequestException when a slug is missing from the catalog", () => {
    // Arrange
    const catalog: Record<string, DeviceTemplateType> = {
      revenue_meter: {} as DeviceTemplateType,
    };
    const svc = new TopologyService(stubRepo, catalog);
    const dtm = makeDtm(["revenue_meter", "unknown_template"]);

    // Act / Assert
    assert.throws(
      () => svc.validateAgainstCatalog(dtm),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        assert.match(err.message, /unknown_template/);
        return true;
      },
    );
  });

  it("throws BadRequestException listing all unknown slugs", () => {
    // Arrange
    const catalog: Record<string, DeviceTemplateType> = {};
    const svc = new TopologyService(stubRepo, catalog);
    const dtm = makeDtm(["foo_tpl", "bar_tpl"]);

    // Act / Assert
    assert.throws(
      () => svc.validateAgainstCatalog(dtm),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        const msg = err.message;
        assert.match(msg, /foo_tpl/);
        assert.match(msg, /bar_tpl/);
        return true;
      },
    );
  });

  it("passes when templates_used is empty", () => {
    // Arrange
    const catalog: Record<string, DeviceTemplateType> = {
      revenue_meter: {} as DeviceTemplateType,
    };
    const svc = new TopologyService(stubRepo, catalog);
    const dtm = makeDtm([]);

    // Act / Assert — empty templates_used has no unknown slugs
    assert.doesNotThrow(() => svc.validateAgainstCatalog(dtm));
  });
});

describe("TopologyService.save — version bump", () => {
  const TEMPLATE = {
    template: "bess_module",
    kind: "module" as const,
    description: "BESS",
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

  /** Builds a minimal single-device DTM fixture for version-bump tests. */
  function baseDtm(): DtmType & { devices: Record<string, DeviceType> } {
    return {
      deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
      ems_mode: "sim" as const,
      sizing_ref: null,
      sizing_params: {
        P_compute_total_kW: 100,
        E_BESS_total_kWh: 200,
        T_coolant_setpoint_C: 18,
      },
      devices: {
        bess_module_1: {
          device_id: "bess_module_1",
          template: "bess_module",
          parent: null,
          display_name: null,
          connection: null,
          blocking: ["live_mode" as const],
          extra_measurements: null,
        },
      } as Record<string, DeviceType>,
      buses: [],
      templates_used: { bess_module: TEMPLATE as never },
    };
  }

  it("first save → version 1.0.0", async () => {
    // Arrange — repo returns no prior rows
    const repo = {
      findOne: mock.fn(() => Promise.resolve(null)),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn((row: { dtm: unknown; version: string }) =>
        Promise.resolve({ ...row, id: 1, receivedAt: new Date() }),
      ),
    };
    const svc = new TopologyService(repo as never, {});
    // Act
    const row = await svc.save(baseDtm() as never);
    // Assert
    assert.equal((row as { version: string }).version, "1.0.0");
  });

  it("identical DTM → version unchanged", async () => {
    // Arrange — repo returns prior row with version 1.0.0
    const prior = { dtm: baseDtm(), version: "1.0.0" };
    const repo = {
      findOne: mock.fn(() => Promise.resolve(prior)),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn((row: { dtm: unknown; version: string }) =>
        Promise.resolve({ ...row, id: 2, receivedAt: new Date() }),
      ),
    };
    const svc = new TopologyService(repo as never, {});
    // Act
    const row = await svc.save(baseDtm() as never);
    // Assert
    assert.equal((row as { version: string }).version, "1.0.0");
  });

  it("device added → version 1.1.0", async () => {
    // Arrange
    const prior = { dtm: baseDtm(), version: "1.0.0" };
    const repo = {
      findOne: mock.fn(() => Promise.resolve(prior)),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn((row: { dtm: unknown; version: string }) =>
        Promise.resolve({ ...row, id: 2, receivedAt: new Date() }),
      ),
    };
    const svc = new TopologyService(repo as never, {});
    const next = baseDtm();
    next.devices.bess_module_2 = {
      ...next.devices.bess_module_1!,
      device_id: "bess_module_2",
    };
    // Act
    const row = await svc.save(next as never);
    // Assert
    assert.equal((row as { version: string }).version, "1.1.0");
  });

  it("device removed → version 2.0.0", async () => {
    // Arrange
    const priorDtm = baseDtm();
    priorDtm.devices.bess_module_2 = {
      ...priorDtm.devices.bess_module_1!,
      device_id: "bess_module_2",
    };
    const prior = { dtm: priorDtm, version: "1.0.0" };
    const repo = {
      findOne: mock.fn(() => Promise.resolve(prior)),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn((row: { dtm: unknown; version: string }) =>
        Promise.resolve({ ...row, id: 2, receivedAt: new Date() }),
      ),
    };
    const svc = new TopologyService(repo as never, {});
    // Act
    const row = await svc.save(baseDtm() as never);
    // Assert
    assert.equal((row as { version: string }).version, "2.0.0");
  });
});

describe("TopologyService.getLatestRow", () => {
  it("returns full row with version", async () => {
    // Arrange
    const stored = {
      dtm: { deployment_uuid: "x" },
      version: "1.4.2",
      id: 7,
      receivedAt: new Date(),
    };
    const repo = { findOne: mock.fn(() => Promise.resolve(stored)) };
    const svc = new TopologyService(repo as never, {});
    // Act
    const row = await svc.getLatestRow();
    // Assert
    assert.equal(row?.version, "1.4.2");
  });

  it("returns null when no rows", async () => {
    // Arrange
    const repo = { findOne: mock.fn(() => Promise.resolve(null)) };
    const svc = new TopologyService(repo as never, {});
    // Act
    const row = await svc.getLatestRow();
    // Assert
    assert.equal(row, null);
  });
});
