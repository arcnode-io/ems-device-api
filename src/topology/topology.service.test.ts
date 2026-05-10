/**
 * Unit tests for TopologyService.validateAgainstCatalog.
 * The repo is unused by this method; pass an empty object stub.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { TopologyService } from "./topology.service";
import type { DtmType } from "./dtm.schema";
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
        assert.match((err).message, /unknown_template/);
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
        const msg = (err).message;
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
