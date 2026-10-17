/**
 * Unit tests for spec-heartbeat — the template's heartbeat plus the device's
 * connection, as the gateway runs it. AAA throughout.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildHeartbeatSourceMap } from "./spec-heartbeat";
import { buildSpec } from "./spec-generator";
import { Dtm } from "../topology/dtm.schema";
import type { DtmType } from "../topology/dtm.schema";

/**
 * One CATL bank with its EMS heartbeat, parsed so template defaults apply.
 * @param host The bank's commissioned host
 * @returns A validated DTM
 */
function dtmWithCatl(host: string): DtmType {
  return Dtm.parse({
    deployment_uuid: "00000000-0000-0000-0000-00000000bea1",
    sizing_params: {
      P_compute_total_kW: 1,
      E_BESS_total_kWh: 1,
      T_coolant_setpoint_C: 1,
    },
    devices: {
      bess_catl_1: {
        device_id: "bess_catl_1",
        template: "bess_catl",
        parent: null,
        display_name: null,
        connection: { host, port: 502, unit_id: "100" },
      },
    },
    buses: [],
    templates_used: {
      bess_catl: {
        template: "bess_catl",
        kind: "leaf",
        equipment_id: "EXT-BESS-CATL",
        vendor: "CATL",
        model: "EnerOne",
        description: "fixture",
        heartbeat: {
          binding: {
            protocol: "modbus_tcp",
            function_code: 6,
            address: 896,
            data_type: "uint16",
            value_map: null,
          },
          counter_modulo: 256,
          period_s: 1.0,
        },
      },
    },
  });
}

describe("buildHeartbeatSourceMap", () => {
  it("merges the device's connection into the template's heartbeat", () => {
    // Arrange
    const dtm = dtmWithCatl("10.0.0.9");

    // Act
    const map = buildHeartbeatSourceMap(dtm);

    // Assert — a command-shaped Modbus write; value_map is a read concern.
    assert.deepEqual(map, {
      bess_catl_1: {
        protocol: "modbus_tcp",
        function_code: 6,
        address: 896,
        data_type: "uint16",
        word_order: "high_low",
        scale: 1.0,
        offset: 0.0,
        host: "10.0.0.9",
        port: 502,
        unit_id: "100",
        counter_modulo: 256,
        period_s: 1.0,
      },
    });
  });

  it("skips a device still awaiting its address", () => {
    // Arrange
    const dtm = dtmWithCatl("PROVISIONED_AT_COMMISSIONING");

    // Act + Assert
    assert.deepEqual(buildHeartbeatSourceMap(dtm), {});
  });
});

describe("buildSpec x-heartbeat-source", () => {
  it("publishes heartbeats when a template declares one, and omits the key otherwise", () => {
    // Arrange
    const withBeat = dtmWithCatl("10.0.0.9");
    const without = dtmWithCatl("10.0.0.9");
    without.templates_used.bess_catl!.heartbeat = null;

    // Act
    const beating = buildSpec(withBeat, "1.0.0") as unknown as Record<
      string,
      unknown
    >;
    const quiet = buildSpec(without, "1.0.0") as unknown as Record<
      string,
      unknown
    >;

    // Assert
    assert.ok("bess_catl_1" in (beating["x-heartbeat-source"] as object));
    assert.equal("x-heartbeat-source" in quiet, false);
  });
});
