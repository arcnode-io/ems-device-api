/**
 * Unit tests for TopologyService.validateAgainstCatalog.
 * The repo is unused by this method; pass an empty object stub.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { TopologyService } from "./topology.service";
import type { DtmType } from "./dtm.schema";
import type { DeviceTemplateType } from "../templates/template.schema";
import type { Repository } from "typeorm";
import type { Topology } from "./topology.entity";

import type { MqttClientService } from "../mqtt/mqtt.client.service";
import type { SldSvgRendererService } from "./sld_svg_renderer.service";

/** Stub — validateAgainstCatalog never touches the repo. */
const stubRepo = {} as Repository<Topology>;

/** Stub — most tests don't care about broadcast; pass a no-op. */
const stubMqtt = {
  publishTopologyChanged: () => undefined,
} as unknown as MqttClientService;

/** Stub — most tests don't exercise the SLD render path. */
const stubRenderer = {
  render: () => Promise.resolve(Buffer.from("")),
} as unknown as SldSvgRendererService;

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
    const svc = new TopologyService(stubRepo, catalog, stubMqtt, stubRenderer);
    const dtm = makeDtm(["revenue_meter", "bess_module_v1"]);

    // Act / Assert — must not throw
    assert.doesNotThrow(() => svc.validateAgainstCatalog(dtm));
  });

  it("throws BadRequestException when a slug is missing from the catalog", () => {
    // Arrange
    const catalog: Record<string, DeviceTemplateType> = {
      revenue_meter: {} as DeviceTemplateType,
    };
    const svc = new TopologyService(stubRepo, catalog, stubMqtt, stubRenderer);
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
    const svc = new TopologyService(stubRepo, catalog, stubMqtt, stubRenderer);
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
    const svc = new TopologyService(stubRepo, catalog, stubMqtt, stubRenderer);
    const dtm = makeDtm([]);

    // Act / Assert — empty templates_used has no unknown slugs
    assert.doesNotThrow(() => svc.validateAgainstCatalog(dtm));
  });
});

describe("TopologyService.save — monotonic version bump", () => {
  /** Minimal DTM fixture — only version bookkeeping fields matter here. */
  function baseDtm(): DtmType {
    return {
      deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
      ems_mode: "sim" as const,
      sizing_ref: null,
      sizing_params: {
        P_compute_total_kW: 100,
        E_BESS_total_kWh: 200,
        T_coolant_setpoint_C: 18,
      },
      devices: {},
      buses: [],
      templates_used: {},
    } as unknown as DtmType;
  }

  it("first save → version 1.0.0", async () => {
    const repo = {
      findOne: mock.fn(() => Promise.resolve(null)),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn((row: { dtm: unknown; version: string }) =>
        Promise.resolve({ ...row, id: 1, receivedAt: new Date() }),
      ),
    };
    const svc = new TopologyService(repo as never, {}, stubMqtt, stubRenderer);
    const row = await svc.save(baseDtm() as never);
    assert.equal((row as { version: string }).version, "1.0.0");
  });

  it("second save (any change or no change) → patch + 1", async () => {
    const prior = { dtm: baseDtm(), version: "1.0.0" };
    const repo = {
      findOne: mock.fn(() => Promise.resolve(prior)),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn((row: { dtm: unknown; version: string }) =>
        Promise.resolve({ ...row, id: 2, receivedAt: new Date() }),
      ),
    };
    const svc = new TopologyService(repo as never, {}, stubMqtt, stubRenderer);
    const row = await svc.save(baseDtm() as never);
    assert.equal((row as { version: string }).version, "1.0.1");
  });

  it("Nth save → patch + (N-1)", async () => {
    const prior = { dtm: baseDtm(), version: "1.0.41" };
    const repo = {
      findOne: mock.fn(() => Promise.resolve(prior)),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn((row: { dtm: unknown; version: string }) =>
        Promise.resolve({ ...row, id: 42, receivedAt: new Date() }),
      ),
    };
    const svc = new TopologyService(repo as never, {}, stubMqtt, stubRenderer);
    const row = await svc.save(baseDtm() as never);
    assert.equal((row as { version: string }).version, "1.0.42");
  });
});

describe("TopologyService.getLatestSld — lazy render + cache", () => {
  /**
   * Minimal Topology row stub.
   * @param version Semver assigned to the row.
   * @returns Topology-shaped row with the given version.
   */
  function row(version: string): {
    dtm: Record<string, unknown>;
    version: string;
    id: number;
    receivedAt: Date;
  } {
    return { dtm: {}, version, id: 1, receivedAt: new Date() };
  }

  it("returns null when no DTM has been submitted", async () => {
    // Arrange
    const repo = { findOne: mock.fn(() => Promise.resolve(null)) };
    const svc = new TopologyService(repo as never, {}, stubMqtt, stubRenderer);

    // Act
    const result = await svc.getLatestSld();

    // Assert
    assert.equal(result, null);
  });

  it("calls renderer on first GET, caches, skips renderer on second GET", async () => {
    // Arrange — repo always returns the same version row
    const repo = { findOne: mock.fn(() => Promise.resolve(row("1.0.0"))) };
    const renderer = {
      render: mock.fn(() => Promise.resolve(Buffer.from("<svg id=cached/>"))),
    } as unknown as SldSvgRendererService;
    const svc = new TopologyService(repo as never, {}, stubMqtt, renderer);

    // Act
    const first = await svc.getLatestSld();
    const second = await svc.getLatestSld();

    // Assert — bytes match + renderer called exactly once
    assert.equal(first?.toString("utf8"), "<svg id=cached/>");
    assert.equal(second?.toString("utf8"), "<svg id=cached/>");
    const renderMock = (
      renderer.render as unknown as { mock: { callCount: () => number } }
    ).mock;
    assert.equal(renderMock.callCount(), 1);
  });

  it("re-renders when DTM version advances (cache stale)", async () => {
    // Arrange — repo returns v1 then v2
    let version = "1.0.0";
    const repo = { findOne: mock.fn(() => Promise.resolve(row(version))) };
    const renderer = {
      render: mock.fn(() => Promise.resolve(Buffer.from(`svg@${version}`))),
    } as unknown as SldSvgRendererService;
    const svc = new TopologyService(repo as never, {}, stubMqtt, renderer);

    // Act
    const first = await svc.getLatestSld();
    version = "1.0.1";
    const second = await svc.getLatestSld();

    // Assert
    assert.equal(first?.toString("utf8"), "svg@1.0.0");
    assert.equal(second?.toString("utf8"), "svg@1.0.1");
    const renderMock = (
      renderer.render as unknown as { mock: { callCount: () => number } }
    ).mock;
    assert.equal(renderMock.callCount(), 2);
  });
});

describe("TopologyService.save — MQTT broadcast", () => {
  /** Minimal DTM fixture for broadcast tests. */
  function baseDtm(): DtmType {
    return {
      deployment_uuid: "123e4567-e89b-12d3-a456-426614174000",
      ems_mode: "sim" as const,
      sizing_ref: null,
      sizing_params: {
        P_compute_total_kW: 100,
        E_BESS_total_kWh: 200,
        T_coolant_setpoint_C: 18,
      },
      devices: {},
      buses: [],
      templates_used: {},
    } as unknown as DtmType;
  }

  it("save → publishTopologyChanged called with new version", async () => {
    // Arrange
    const repo = {
      findOne: mock.fn(() => Promise.resolve(null)),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn((row: { dtm: unknown; version: string }) =>
        Promise.resolve({ ...row, id: 1, receivedAt: new Date() }),
      ),
    };
    const publishMock = mock.fn();
    const mqtt = {
      publishTopologyChanged: publishMock,
    } as unknown as MqttClientService;
    const svc = new TopologyService(repo as never, {}, mqtt, stubRenderer);
    // Act
    await svc.save(baseDtm() as never);
    // Assert
    assert.equal(publishMock.mock.callCount(), 1);
    assert.equal(publishMock.mock.calls[0]?.arguments[0], "1.0.0");
  });

  it("subsequent save → publishTopologyChanged with bumped version", async () => {
    // Arrange — prior row sets version to 1.0.5
    const prior = { dtm: baseDtm(), version: "1.0.5" };
    const repo = {
      findOne: mock.fn(() => Promise.resolve(prior)),
      create: mock.fn((arg: { dtm: unknown; version: string }) => arg),
      save: mock.fn((row: { dtm: unknown; version: string }) =>
        Promise.resolve({ ...row, id: 6, receivedAt: new Date() }),
      ),
    };
    const publishMock = mock.fn();
    const mqtt = {
      publishTopologyChanged: publishMock,
    } as unknown as MqttClientService;
    const svc = new TopologyService(repo as never, {}, mqtt, stubRenderer);
    // Act
    await svc.save(baseDtm() as never);
    // Assert
    assert.equal(publishMock.mock.callCount(), 1);
    assert.equal(publishMock.mock.calls[0]?.arguments[0], "1.0.6");
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
    const svc = new TopologyService(repo as never, {}, stubMqtt, stubRenderer);
    // Act
    const row = await svc.getLatestRow();
    // Assert
    assert.equal(row?.version, "1.4.2");
  });

  it("returns null when no rows", async () => {
    // Arrange
    const repo = { findOne: mock.fn(() => Promise.resolve(null)) };
    const svc = new TopologyService(repo as never, {}, stubMqtt, stubRenderer);
    // Act
    const row = await svc.getLatestRow();
    // Assert
    assert.equal(row, null);
  });
});
