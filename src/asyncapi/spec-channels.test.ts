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
type ChannelsShape = Record<
  string,
  { parameters: Record<string, ChannelParam> }
>;

/**
 * Generic device with one float measurement + two bool measurements + one
 * bound float command, so both measurement and command example paths get
 * exercised. Deliberately not shaped after any real template — this test
 * only cares that names round-trip into channel `examples`.
 */
function dtmWithExampleDevice(): DtmType {
  return {
    deployment_uuid: "00000000-0000-0000-0000-000000000ccc",
    sizing_params: {
      P_compute_total_kW: 1,
      E_BESS_total_kWh: 1,
      T_coolant_setpoint_C: 1,
    },
    devices: {
      example_device_1: {
        device_id: "example_device_1",
        template: "example_device",
        parent: null,
        display_name: null,
        connection: null,
      },
    },
    buses: [],
    templates_used: {
      example_device: {
        template: "example_device",
        kind: "leaf",
        equipment_id: "EQ-EXAMPLE-001",
        vendor: "ACME",
        model: "Example Leaf",
        description: "fixture",
        contains: [],
        measurements: {
          active_power: {
            unit: "watts",
            type: "float",
            iec_61850_ref: null,
            poll_rate_hz: 1,
            display_name_default: null,
            bounds: null,
            thresholds: null,
            values: null,
            publisher: "local_process",
            binding: null,
          },
          interlock_engaged: {
            unit: "none",
            type: "bool",
            iec_61850_ref: null,
            poll_rate_hz: 1,
            display_name_default: null,
            bounds: null,
            thresholds: null,
            values: null,
            publisher: "local_process",
            binding: null,
          },
          breaker_closed: {
            unit: "none",
            type: "bool",
            iec_61850_ref: null,
            poll_rate_hz: 1,
            display_name_default: null,
            bounds: null,
            thresholds: null,
            values: null,
            publisher: "local_process",
            binding: null,
          },
        },
        commands: {
          set_active_power: {
            verb: "set",
            target: "active_power",
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
    const channels = buildChannels(dtmWithExampleDevice()) as ChannelsShape;
    assert.deepEqual(
      channels.measurementFloat!.parameters.measurement!.examples,
      ["active_power"],
    );
  });

  it("surfaces bool-measurement names, alphabetically, as examples on measurementBool.measurement", () => {
    const channels = buildChannels(dtmWithExampleDevice()) as ChannelsShape;
    assert.deepEqual(
      channels.measurementBool!.parameters.measurement!.examples,
      ["breaker_closed", "interlock_engaged"],
    );
  });

  it("surfaces bound command targets as examples on commandFloat.target", () => {
    const channels = buildChannels(dtmWithExampleDevice()) as ChannelsShape;
    assert.deepEqual(channels.commandFloat!.parameters.target!.examples, [
      "active_power",
    ]);
  });

  it("surfaces device ids as examples on device_id across every channel family", () => {
    const channels = buildChannels(dtmWithExampleDevice()) as ChannelsShape;
    assert.deepEqual(
      channels.measurementFloat!.parameters.device_id!.examples,
      ["example_device_1"],
    );
    assert.deepEqual(channels.commandFloat!.parameters.device_id!.examples, [
      "example_device_1",
    ]);
  });

  it("omits examples when no measurement of that type exists in the deployment", () => {
    const channels = buildChannels(dtmWithExampleDevice()) as ChannelsShape;
    assert.equal(
      channels.measurementEnum!.parameters.measurement!.examples,
      undefined,
    );
    assert.equal(channels.commandBool!.parameters.target!.examples, undefined);
  });

  it("lists the concrete messages of each family × wire-type on its channel, keeping the base sample", () => {
    type Messages = Record<
      string,
      { messages: Record<string, { $ref: string }> }
    >;
    const channels = buildChannels(dtmWithExampleDevice()) as unknown as Messages;
    assert.deepEqual(Object.keys(channels.measurementFloat!.messages).sort(), [
      "ExampleDevice_ActivePower",
      "sample",
    ]);
    assert.equal(
      channels.measurementFloat!.messages.ExampleDevice_ActivePower!.$ref,
      "#/components/messages/ExampleDevice_ActivePowerMsg",
    );
    assert.deepEqual(Object.keys(channels.measurementBool!.messages).sort(), [
      "ExampleDevice_BreakerClosed",
      "ExampleDevice_InterlockEngaged",
      "sample",
    ]);
    assert.deepEqual(Object.keys(channels.commandFloat!.messages).sort(), [
      "ExampleDevice_SetActivePower",
      "sample",
    ]);
    assert.deepEqual(Object.keys(channels.measurementEnum!.messages), [
      "sample",
    ]);
  });

  it("still returns exactly the 8 template-agnostic channels regardless of DTM content", () => {
    const channels = buildChannels(dtmWithExampleDevice());
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
