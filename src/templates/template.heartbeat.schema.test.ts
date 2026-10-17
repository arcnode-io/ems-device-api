/**
 * Unit tests for template.heartbeat.schema.ts — mirrors edp-api
 * test_template_heartbeat.py. AAA throughout.
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { Heartbeat } from "./template.heartbeat.schema";

const CATL_BEAT = {
  binding: {
    protocol: "modbus_tcp",
    function_code: 6,
    address: 896,
    data_type: "uint16",
  },
  counter_modulo: 256,
  period_s: 1.0,
};

describe("Heartbeat", () => {
  it("accepts CATL's EMS heartbeat register", () => {
    // Arrange + Act
    const beat = Heartbeat.parse(CATL_BEAT);

    // Assert
    assert.equal(beat.binding.address, 896);
    assert.equal(beat.counter_modulo, 256);
    assert.equal(beat.period_s, 1.0);
  });

  it("rejects a counter that can't count, a period that isn't one, and extra keys", () => {
    // Arrange + Act + Assert
    assert.equal(
      Heartbeat.safeParse({ ...CATL_BEAT, counter_modulo: 1 }).success,
      false,
    );
    assert.equal(
      Heartbeat.safeParse({ ...CATL_BEAT, period_s: 0 }).success,
      false,
    );
    assert.equal(
      Heartbeat.safeParse({ ...CATL_BEAT, phase: 1 }).success,
      false,
    );
  });

  it("rejects a non-Modbus binding", () => {
    // Arrange
    const snmp = {
      ...CATL_BEAT,
      binding: { protocol: "snmp", oid: "1.3.6.1" },
    };

    // Act + Assert
    assert.equal(Heartbeat.safeParse(snmp).success, false);
  });
});
