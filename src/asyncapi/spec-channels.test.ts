/**
 * Unit tests for spec-channels — parameter `examples` derived from the DTM's
 * real measurement/command names and device ids. Channels themselves stay
 * template-agnostic (same 8 always); `examples` is the mechanism that lets
 * a reader actually see what's deployed without enumerating per-device
 * channels (AsyncAPI 3.0 Parameter Object supports `examples: [string]`).
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildChannels } from "./spec-channels";
import type { DtmType } from "../topology/dtm.schema";

interface ChannelParam {
  description?: string;
  examples?: string[];
}
type ChannelsShape = Record<string, { parameters: Record<string, ChannelParam> }>;

/** DTM with a der_dispatch-shaped device (float + 2 bool measurements) plus
 * one bound float command, so both measurement and command example paths
 * get exercised. */
function dtmWithDerDispatch(): DtmType {
  return {
    deployment_uuid: "00000000-0000-0000-0000-000000000ccc",
    sizing_params: {
      P_compute_total_kW: 1,
      E_BESS_total_kWh: 1,
      T_coolant_setpoint_C: 1,
    },
    devices: {
      der_dispatch_1: {
        device_id: "der_dispatch_1",
        template: "der_dispatch",
        parent: null,
        display_name: null,
        connection: null,
      },
    },
    buses: [],
    templates_used: {
      der_dispatch: {
        template: "der_dispatch",
        kind: "leaf",
        equipment_id: "GRD-DER-001",
        vendor: "ARCNODE",
        model: "DER Dispatch Intake",
        description: "fixture",
        contains: [],
        measurements: {
          target_active_power: {
            unit: "watts",
            type: "float",
            iec_61850_ref: null,
            poll_rate_hz: 1,
            display_name_default: null,
            bounds: null,
            thresholds: null,
            values: null,
            publisher: "der_control_api",
            binding: null,
          },
          event_active: {
            unit: "none",
            type: "bool",
            iec_61850_ref: null,
            poll_rate_hz: 1,
            display_name_default: null,
            bounds: null,
            thresholds: null,
            values: null,
            publisher: "der_control_api",
            binding: null,
          },
          energize_enabled: {
            unit: "none",
            type: "bool",
            iec_61850_ref: null,
            poll_rate_hz: 1,
            display_name_default: null,
            bounds: null,
            thresholds: null,
            values: null,
            publisher: "der_control_api",
            binding: null,
          },
        },
        commands: {
          test_setpoint: {
            verb: "set",
            target: "test_setpoint",
            unit: "watts",
            payload: "float",
            display_name_default: null,
            fanout: null,
            binding: {
              protocol: "modbus_tcp",
              function_code: 6,
              address: 10,
              data_type: "int16",
              word_order: "high_low",
              scale: 1.0,
              offset: 0.0,
            },
          },
        },
      },
    },
  } as unknown as DtmType;
}

describe("buildChannels parameter examples", () => {
  it("surfaces float-measurement names as examples on measurementFloat.measurement", () => {
    const channels = buildChannels(dtmWithDerDispatch()) as ChannelsShape;
    assert.deepEqual(channels.measurementFloat!.parameters.measurement!.examples, [
      "target_active_power",
    ]);
  });

  it("surfaces bool-measurement names, alphabetically, as examples on measurementBool.measurement", () => {
    const channels = buildChannels(dtmWithDerDispatch()) as ChannelsShape;
    assert.deepEqual(channels.measurementBool!.parameters.measurement!.examples, [
      "energize_enabled",
      "event_active",
    ]);
  });

  it("surfaces bound command targets as examples on commandFloat.target", () => {
    const channels = buildChannels(dtmWithDerDispatch()) as ChannelsShape;
    assert.deepEqual(channels.commandFloat!.parameters.target!.examples, [
      "test_setpoint",
    ]);
  });

  it("surfaces device ids as examples on device_id across every channel family", () => {
    const channels = buildChannels(dtmWithDerDispatch()) as ChannelsShape;
    assert.deepEqual(channels.measurementFloat!.parameters.device_id!.examples, [
      "der_dispatch_1",
    ]);
    assert.deepEqual(channels.commandFloat!.parameters.device_id!.examples, [
      "der_dispatch_1",
    ]);
  });

  it("omits examples when no measurement of that type exists in the deployment", () => {
    const channels = buildChannels(dtmWithDerDispatch()) as ChannelsShape;
    assert.equal(channels.measurementEnum!.parameters.measurement!.examples, undefined);
    assert.equal(channels.commandBool!.parameters.target!.examples, undefined);
  });

  it("still returns exactly the 8 template-agnostic channels regardless of DTM content", () => {
    const channels = buildChannels(dtmWithDerDispatch());
    assert.deepEqual(Object.keys(channels).sort(), [
      "commandBool",
      "commandEnum",
      "commandFloat",
      "commandTrigger",
      "measurementBool",
      "measurementEnum",
      "measurementFloat",
      "topologyChanged",
    ]);
  });
});
