/**
 * Unit tests for spec-messages — concrete per-template schemas per ADR-002 §6.
 */

import "reflect-metadata";
import * as assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildConcreteMessages, type ConcreteMessage } from "./spec-messages";
import type { DeviceTemplateType } from "../templates/template.schema";

interface ValueSchema {
  type: string;
  enum?: string[];
  minimum?: number;
  maximum?: number;
}
interface SampleSchema {
  type: string;
  required: string[];
  properties: { ts: unknown; value?: ValueSchema };
}

/**
 * Two templates covering every wire type: an enum (out of register order),
 * floats with and without bounds, a bool, a set command, a trigger command.
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
          // Deliberately out of register order to prove sorting by code.
          values: { "2": "TRIPPED", "0": "OPEN", "1": "CLOSED" },
          publisher: "line_controller",
        },
        grid_frequency: {
          unit: "hertz",
          type: "float",
          bounds: null,
          publisher: "line_controller",
        },
      },
      commands: {},
    },
    {
      template: "bess_module",
      kind: "module",
      description: "fixture",
      measurements: {
        active_power: {
          unit: "watts",
          type: "float",
          bounds: { min: -10000000, max: 10000000, nominal: 0 },
          publisher: "line_controller",
        },
        energize_enabled: {
          unit: "none",
          type: "bool",
          publisher: "line_controller",
        },
      },
      commands: {
        set_active_power: {
          verb: "set",
          target: "active_power",
          unit: "watts",
          payload: "float",
          fanout: "line_controller",
        },
        reset_faults: {
          verb: "reset",
          target: "active_power",
          unit: "none",
          payload: "trigger",
          fanout: "line_controller",
        },
      },
    },
  ] as unknown as DeviceTemplateType[];
}

/**
 * Find one concrete message by name, failing the test if absent.
 * @param msgs Output of buildConcreteMessages
 * @param name Expected `<Template>_<Name>`
 * @returns The matching message
 */
function byName(
  msgs: readonly ConcreteMessage[],
  name: string,
): ConcreteMessage {
  const found = msgs.find((msg) => msg.name === name);
  assert.ok(found, `missing concrete message ${name}`);
  return found;
}

/**
 * View a message's schema through the sample shape for assertions.
 * @param msg A concrete message
 * @returns Its schema typed as a sample
 */
function schemaOf(msg: ConcreteMessage): SampleSchema {
  return msg.schema as unknown as SampleSchema;
}

describe("buildConcreteMessages", () => {
  it("names messages <Template>_<Name> in PascalCase", () => {
    const names = buildConcreteMessages(templates()).map((msg) => msg.name);
    assert.deepEqual(names.sort(), [
      "BessModule_ActivePower",
      "BessModule_EnergizeEnabled",
      "BessModule_ResetFaults",
      "BessModule_SetActivePower",
      "GridModule_GridFrequency",
      "GridModule_InterconnectState",
    ]);
  });

  it("locks enum values to the template labels in register-code order", () => {
    const msg = byName(
      buildConcreteMessages(templates()),
      "GridModule_InterconnectState",
    );
    assert.equal(msg.family, "measurement");
    assert.equal(msg.wireType, "enum");
    assert.deepEqual(schemaOf(msg).properties.value, {
      type: "string",
      enum: ["OPEN", "CLOSED", "TRIPPED"],
    });
  });

  it("carries float bounds as minimum/maximum", () => {
    const msg = byName(
      buildConcreteMessages(templates()),
      "BessModule_ActivePower",
    );
    assert.deepEqual(schemaOf(msg).properties.value, {
      type: "number",
      minimum: -10000000,
      maximum: 10000000,
    });
  });

  it("omits minimum/maximum when the template has no bounds", () => {
    const msg = byName(
      buildConcreteMessages(templates()),
      "GridModule_GridFrequency",
    );
    assert.deepEqual(schemaOf(msg).properties.value, { type: "number" });
  });

  it("types bool measurements as boolean", () => {
    const msg = byName(
      buildConcreteMessages(templates()),
      "BessModule_EnergizeEnabled",
    );
    assert.deepEqual(schemaOf(msg).properties.value, { type: "boolean" });
  });

  it("gives a set command the value schema of its target measurement", () => {
    const msg = byName(
      buildConcreteMessages(templates()),
      "BessModule_SetActivePower",
    );
    assert.equal(msg.family, "command");
    assert.equal(msg.wireType, "float");
    assert.deepEqual(schemaOf(msg).required, ["ts", "value"]);
    assert.deepEqual(schemaOf(msg).properties.value, {
      type: "number",
      minimum: -10000000,
      maximum: 10000000,
    });
  });

  it("gives a trigger command a ts-only schema", () => {
    const msg = byName(
      buildConcreteMessages(templates()),
      "BessModule_ResetFaults",
    );
    assert.equal(msg.wireType, "trigger");
    assert.deepEqual(schemaOf(msg).required, ["ts"]);
    assert.equal(schemaOf(msg).properties.value, undefined);
  });

  it("fails fast when a command target is not a measurement of its template", () => {
    const broken = templates();
    broken[1]!.commands.set_active_power!.target = "does_not_exist";
    assert.throws(() => buildConcreteMessages(broken), /does_not_exist/);
  });
});
