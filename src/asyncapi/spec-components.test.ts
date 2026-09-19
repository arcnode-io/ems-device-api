/**
 * Unit tests for spec-components — base shapes plus the concrete per-template
 * schemas and message wrappers per ADR-002 §6.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildComponents } from "./spec-components";
import type { DeviceTemplateType } from "../templates/template.schema";

interface Components {
  messages: Record<string, { name: string; payload: { $ref: string } }>;
  schemas: Record<string, { properties?: { value?: Record<string, unknown> } }>;
}

/**
 * One template with an enum measurement and a float set command.
 * @returns Fixture templates
 */
function templates(): DeviceTemplateType[] {
  return [
    {
      template: "grid_module",
      kind: "module",
      description: "fixture",
      measurements: {
        interconnect_state: {
          unit: "none",
          type: "enum",
          values: { "0": "OPEN", "1": "CLOSED", "2": "TRIPPED" },
          publisher: "local_process",
        },
        net_active_power: {
          unit: "watts",
          type: "float",
          bounds: { min: -5000000, max: 5000000, nominal: 0 },
          publisher: "local_process",
        },
      },
      commands: {
        set_net_active_power: {
          verb: "set",
          target: "net_active_power",
          unit: "watts",
          payload: "float",
          fanout: "local_process",
        },
      },
    },
  ] as unknown as DeviceTemplateType[];
}

describe("buildComponents concrete schemas", () => {
  it("keeps the base shapes and adds one schema per template measurement and command", () => {
    const components = buildComponents(templates()) as unknown as Components;
    const keys = Object.keys(components.schemas).sort();
    assert.deepEqual(keys, [
      "BooleanSample",
      "CommandSource",
      "EnumSample",
      "FloatSample",
      "GridModule_InterconnectState",
      "GridModule_NetActivePower",
      "GridModule_SetNetActivePower",
      "ProtocolSource",
      "TopologyChanged",
      "TriggerSample",
    ]);
  });

  it("generates ProtocolSource/CommandSource from the real Binding contract, not a hand-written literal", () => {
    const components = buildComponents(templates()) as unknown as Components;
    const protocolSource = JSON.stringify(components.schemas.ProtocolSource);
    const commandSource = JSON.stringify(components.schemas.CommandSource);
    // The old hand-written schema had "dnp3" (wrong) and no synthetic/distribute at all.
    assert.ok(protocolSource.includes('"dnp3_tcp"'));
    assert.ok(protocolSource.includes('"synthetic"'));
    assert.ok(commandSource.includes('"distribute"'));
  });

  it("publishes the enum lock on the concrete schema", () => {
    const components = buildComponents(templates()) as unknown as Components;
    assert.deepEqual(
      components.schemas.GridModule_InterconnectState!.properties!.value,
      { type: "string", enum: ["OPEN", "CLOSED", "TRIPPED"] },
    );
  });

  it("wraps every concrete schema as a <Name>Msg message referencing it", () => {
    const components = buildComponents(templates()) as unknown as Components;
    assert.deepEqual(components.messages.GridModule_InterconnectStateMsg, {
      name: "GridModule_InterconnectStateMsg",
      payload: { $ref: "#/components/schemas/GridModule_InterconnectState" },
    });
    assert.deepEqual(components.messages.GridModule_SetNetActivePowerMsg, {
      name: "GridModule_SetNetActivePowerMsg",
      payload: { $ref: "#/components/schemas/GridModule_SetNetActivePower" },
    });
  });
});
