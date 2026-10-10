/**
 * Shared scaffolding for the LOTO integration tests: a three-level DTM
 * (module → racks, plus an unrelated module), the catalog stub it needs, an
 * app bootstrap against the testcontainers, and operator/viewer tokens.
 */

import { Test } from "@nestjs/testing";
import type { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import * as client from "supertest";
import type { App } from "supertest/types";
import { AppModuleWithDatabase } from "../../src/app.module";
import { TEMPLATE_CATALOG } from "../../src/templates/templates.module";
import { TopologyService } from "../../src/topology/topology.service";
import type { DeviceTemplateType } from "../../src/templates/template.schema";
import type { RoleType } from "../../src/auth/auth.types";

export const JWT_SECRET = "loto-test-secret-bytes-for-hs256-signing";

const TEMPLATE_BESS = {
  template: "bess_module_v1",
  kind: "module" as const,
  description: "BESS module aggregate.",
  contains: [],
  measurements: {
    voltage_dc: {
      unit: "volts",
      type: "float" as const,
      publisher: "local_process" as const,
    },
  },
  commands: {},
};
const TEMPLATE_RACK = {
  template: "bess_rack_v1",
  kind: "leaf" as const,
  description: "One rack.",
  measurements: {
    voltage_dc: {
      unit: "volts",
      type: "float" as const,
      publisher: "local_process" as const,
    },
  },
  commands: {},
};

export const STUB_CATALOG: Record<string, DeviceTemplateType> = {
  bess_module_v1: TEMPLATE_BESS as unknown as DeviceTemplateType,
  bess_rack_v1: TEMPLATE_RACK as unknown as DeviceTemplateType,
};

/** bess_001 contains rack_001 and rack_002; bess_002 stands alone. */
export const LOTO_DTM = {
  deployment_uuid: "123e4567-e89b-12d3-a456-426614174077",
  sizing_ref: null,
  sizing_params: {
    P_compute_total_kW: 100,
    E_BESS_total_kWh: 200,
    T_coolant_setpoint_C: 18,
  },
  devices: {
    bess_001: { device_id: "bess_001", template: "bess_module_v1" },
    rack_001: {
      device_id: "rack_001",
      template: "bess_rack_v1",
      parent: "bess_001",
    },
    rack_002: {
      device_id: "rack_002",
      template: "bess_rack_v1",
      parent: "bess_001",
    },
    bess_002: { device_id: "bess_002", template: "bess_module_v1" },
  },
  buses: [],
  templates_used: {
    bess_module_v1: TEMPLATE_BESS,
    bess_rack_v1: TEMPLATE_RACK,
  },
};

/**
 * Boot the full app against the given broker, with the LOTO catalog stub.
 * Caller sets DOCUMENT_URL and AUTH_JWT_SECRET first.
 * @param brokerUrl mqtt:// URL of the hivemq testcontainer
 * @returns The initialized app
 */
export async function bootLotoApp(
  brokerUrl: string,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModuleWithDatabase],
  })
    .overrideProvider(ConfigService)
    .useValue({
      get: <T>(key: string): T | undefined =>
        key === "mqttBrokerUrl" ? (brokerUrl as unknown as T) : undefined,
    })
    .overrideProvider(TEMPLATE_CATALOG)
    .useValue(STUB_CATALOG)
    .compile();
  return moduleRef.createNestApplication().init();
}

/**
 * Persist LOTO_DTM through the service, bypassing HTTP.
 * @param app A booted app
 */
export async function seedLotoDtm(app: INestApplication): Promise<void> {
  await app.get(TopologyService).save(LOTO_DTM as never);
}

/**
 * Mint a session token exactly as /auth/login would.
 * @param role operator or viewer
 * @returns Bearer header value
 */
export function bearer(role: RoleType): string {
  const token = new JwtService({ secret: JWT_SECRET }).sign(
    { sub: role, role },
    { expiresIn: "1h" },
  );
  return `Bearer ${token}`;
}

/**
 * POST a lock as the given role.
 * @param app Booted app
 * @param deviceId Device to lock
 * @param holder holder_name
 * @param role Token role (operator by default)
 * @returns supertest request
 */
export function lockAs(
  app: INestApplication<App>,
  deviceId: string,
  holder: string,
  role: RoleType = "operator",
): client.Test {
  return client(app.getHttpServer())
    .post(`/devices/${deviceId}/loto`)
    .set("Authorization", bearer(role))
    .send({ holder_name: holder, permit_ref: "WO-1" });
}

/**
 * DELETE a lock as the given role.
 * @param app Booted app
 * @param id Lock id
 * @param role Token role (operator by default)
 * @returns supertest request
 */
export function clearAs(
  app: INestApplication<App>,
  id: number,
  role: RoleType = "operator",
): client.Test {
  return client(app.getHttpServer())
    .delete(`/loto/${id}`)
    .set("Authorization", bearer(role));
}

/**
 * Pause for a publish round-trip.
 * @param ms How long
 * @returns Resolves after ms
 */
export function settle(ms = 1000): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
