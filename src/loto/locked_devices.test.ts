import * as assert from "assert";
import { describe, test } from "node:test";
import { lockedDevices } from "./locked_devices";

const DEVICES = {
  bess_001: { parent: null },
  rack_001: { parent: "bess_001" },
  rack_002: { parent: "bess_001" },
  cell_001: { parent: "rack_001" },
  bess_002: { parent: null },
  rack_003: { parent: "bess_002" },
};

describe("lockedDevices", () => {
  test("a locked module takes its whole subtree with it", () => {
    // Act
    const out = lockedDevices(DEVICES, ["bess_001"]);

    // Assert
    assert.deepStrictEqual(out, [
      "bess_001",
      "cell_001",
      "rack_001",
      "rack_002",
    ]);
  });

  test("a locked rack does not lock its module or siblings", () => {
    assert.deepStrictEqual(lockedDevices(DEVICES, ["rack_001"]), [
      "cell_001",
      "rack_001",
    ]);
  });

  test("a locked device that left the DTM is still reported", () => {
    assert.deepStrictEqual(lockedDevices(DEVICES, ["gone_001"]), ["gone_001"]);
  });

  test("nothing locked → nothing reported", () => {
    assert.deepStrictEqual(lockedDevices(DEVICES, []), []);
  });

  test("a parent cycle in a bad manifest does not hang", () => {
    const cyclic = { a_1: { parent: "b_1" }, b_1: { parent: "a_1" } };
    assert.deepStrictEqual(lockedDevices(cyclic, ["zz_1"]), ["zz_1"]);
  });
});
